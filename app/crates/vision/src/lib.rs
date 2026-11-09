//! Reads the Overwatch TAB scoreboard from a screenshot. Pixels only: nothing here talks to the game.
//!
//! Calibrated on a 2560x1440 recording (all coordinates are ratios of the frame size):
//! - Ally rows are blue, enemy rows red, with a light-gray header bar (E/A/D/damage/...) above them.
//! - Mid-match, perk icon columns appear and the whole table shifts left, so the table's left edge is
//!   found each time, from the start of the header bar (ult-ready rows glow blue to the left of the
//!   table, so team colors would mislead).
//! - Portrait: a square of 3.3% of the width, starting 1.56% right of the table's left edge.

pub mod bans;
mod digits_data;
pub mod maptext;
pub mod nameplate;
pub mod rank;
pub mod seeds;
pub mod stats;

/// A party member's row has a bright green marker just left of the portrait. Measured on a 2560x1440
/// capture: the two party rows had 0.53 and 0.55 of this strip green, every other row 0.00-0.01.
pub const PARTY_MIN: f32 = 0.25;

/// Party rows (ally team only). The marker sits 0.15-0.5 row heights right of the table edge and spans
/// the row; the enemy team never has one.
pub fn party_rows(f: &Frame, l: &Layout) -> Vec<bool> {
    let x0 = l.left + (0.15 * l.row_h) as usize;
    let x1 = (l.left + (0.50 * l.row_h) as usize).min(f.width);
    let half = (0.35 * l.row_h) as usize;
    l.rows
        .iter()
        .map(|r| {
            if r.team != Team::Ally {
                return false;
            }
            let y0 = (r.y as usize).saturating_sub(half);
            let y1 = (r.y as usize + half).min(f.height);
            let mut green = 0;
            let mut total = 0;
            for y in y0..y1 {
                for x in x0..x1 {
                    total += 1;
                    let (rr, g, b) = f.px(x, y);
                    if g > 140 && g - rr > 50 && g - b > 50 {
                        green += 1;
                    }
                }
            }
            total > 0 && green as f32 / total as f32 >= PARTY_MIN
        })
        .collect()
}

/// An RGBA frame (row-major, 4 bytes per pixel).
#[derive(Clone, Copy)]
pub struct Frame<'a> {
    pub data: &'a [u8],
    pub width: usize,
    pub height: usize,
}

impl Frame<'_> {
    #[inline]
    pub(crate) fn px(&self, x: usize, y: usize) -> (i32, i32, i32) {
        let i = (y * self.width + x) * 4;
        (
            self.data[i] as i32,
            self.data[i + 1] as i32,
            self.data[i + 2] as i32,
        )
    }
}

fn is_ally(r: i32, g: i32, b: i32) -> bool {
    b - r > 50 && b > 70 && g < b
}
fn is_enemy(r: i32, g: i32, b: i32) -> bool {
    r - g > 50 && r > 60 && b < r
}
fn is_header(r: i32, g: i32, b: i32) -> bool {
    let (lo, hi) = (r.min(g).min(b), r.max(g).max(b));
    lo > 180 && hi < 240 && hi - lo < 20
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Team {
    Ally,
    Enemy,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RowPos {
    pub team: Team,
    /// Vertical center in pixels.
    pub y: f32,
}

/// Where the scoreboard is on this screen. Inferred every time, because the layout differs by mode:
/// a 5v5 match, open queue 6v6 and the practice range (5 + 1 rows, larger rows) all place it differently.
#[derive(Debug, Clone, PartialEq)]
pub struct Layout {
    /// Table edges (the header bar's extent), in pixels.
    pub left: usize,
    pub right: usize,
    pub header_y: usize,
    /// Row height in pixels; positions inside a row scale with it.
    pub row_h: f32,
    pub rows: Vec<RowPos>,
}

impl Layout {
    pub fn team_rows(&self, team: Team) -> Vec<usize> {
        (0..self.rows.len())
            .filter(|&i| self.rows[i].team == team)
            .collect()
    }
}

/// The header bar: the first row from the top with a light-gray run over 25% of the width.
/// Its extent is the table's: the label text (처치, 도움, ...) breaks the gray, so runs separated by
/// small gaps (up to 3% of the width) are joined. Ult-ready rows glow blue to the left of the table and
/// perk columns shift it, so the bar is the anchor, not the team colors.
fn header(f: &Frame) -> Option<(usize, usize, usize)> {
    // sizes by height: the HUD scales with the height, so this holds for 16:10 and 21:9 too
    let hf = f.height as f32;
    let need = (0.4 * hf) as usize;
    let max_gap = (0.053 * hf) as usize;
    // widest header-colored span on row y, joined across small gaps
    let span = |y: usize| -> Option<(usize, usize)> {
        let mut segs: Vec<(usize, usize, usize)> = Vec::new(); // (start, end, longest plain run)
        let mut run = 0;
        for x in 0..f.width {
            let (r, g, b) = f.px(x, y);
            if is_header(r, g, b) {
                run += 1;
                match segs.last_mut() {
                    Some(seg) if x - seg.1 <= max_gap => {
                        seg.1 = x;
                        seg.2 = seg.2.max(run);
                    }
                    _ => segs.push((x, x, run)),
                }
            } else {
                run = 0;
            }
        }
        segs.iter()
            .filter(|s| s.1 - s.0 > need && s.2 > (0.089 * hf) as usize)
            .max_by_key(|s| s.1 - s.0)
            .map(|s| (s.0, s.1))
    };
    for y in (f.height / 20)..(f.height * 6 / 10) {
        if span(y).is_none() {
            continue;
        }
        // The bar's first pixel row is an anti-aliased edge that can be partly missing: use the first
        // row that reaches (within 2 px) the leftmost edge seen over the next few rows.
        let depth = (f.height / 200).max(4);
        let rows: Vec<(usize, (usize, usize))> = (y..(y + depth).min(f.height))
            .filter_map(|yy| span(yy).map(|s| (yy, s)))
            .collect();
        let min_left = rows.iter().map(|r| r.1.0).min()?;
        let (hy, (l, r)) = *rows.iter().find(|r| r.1.0 <= min_left + 2)?;
        return Some((hy, l, r));
    }
    None
}

/// Infers the scoreboard layout, or None when the frame isn't the TAB scoreboard (killcam, play of the
/// game, gameplay...).
///
/// Below the header bar, a vertical scan finds the blue (ally) and red (enemy) bands. The row height is
/// twice the distance from a band's top to the first role icon in it; each band holds
/// round(length / row height) rows.
pub fn detect_scoreboard(f: &Frame) -> Option<Layout> {
    let (header_y, left, right) = header(f)?;
    let h = f.height as f32;
    // three scan columns; a pixel row counts for a team when at least two of them agree
    // (names and digits cross any single column)
    let xs = [3, 55, 75].map(|pct| left + (right - left) * pct / 100);
    let gap = (0.012 * h) as usize;
    let mut bands: Vec<(Team, usize, usize)> = Vec::new();
    let mut y = header_y;
    while y < f.height {
        let (mut a, mut e) = (0, 0);
        for &x in &xs {
            let (r, g, b) = f.px(x, y);
            a += is_ally(r, g, b) as u8;
            e += is_enemy(r, g, b) as u8;
        }
        let team = if a >= 2 {
            Some(Team::Ally)
        } else if e >= 2 {
            Some(Team::Enemy)
        } else {
            None
        };
        match (team, bands.last_mut()) {
            (Some(t), Some(last)) if last.0 == t && y - last.2 <= gap => last.2 = y,
            (Some(t), _) => bands.push((t, y, y)),
            (None, Some(last)) if (y - last.2) as f32 > 0.15 * h => break,
            _ => {}
        }
        y += 1;
    }
    bands.retain(|b| (b.2 - b.1) as f32 > 0.03 * h);
    let first = *bands.first()?;
    if first.0 != Team::Ally {
        return None;
    }
    // role icon column: white glyphs just inside the table's left edge
    let ix = left + (0.0107 * f.height as f32) as usize;
    let icon: Vec<usize> = (first.1..first.2)
        .filter(|&yy| {
            let (r, g, b) = f.px(ix, yy);
            r.min(g).min(b) > 200
        })
        .collect();
    let top = *icon.first()?;
    let first_icon: Vec<usize> = icon
        .into_iter()
        .take_while(|&yy| (yy - top) as f32 <= 0.05 * h)
        .collect();
    let center = first_icon.iter().sum::<usize>() as f32 / first_icon.len() as f32;
    let pitch = 2.0 * (center - first.1 as f32);
    if pitch < 0.03 * h {
        return None;
    }
    let mut rows = Vec::new();
    let mut row_h = 0.0;
    for (i, (team, y0, y1)) in bands.iter().enumerate() {
        let len = (y1 - y0 + 1) as f32;
        let n = (len / pitch).round().max(1.0);
        let hh = len / n;
        if i == 0 {
            row_h = hh;
        }
        for k in 0..n as usize {
            rows.push(RowPos {
                team: *team,
                y: *y0 as f32 + (k as f32 + 0.5) * hh,
            });
        }
    }
    // a team board has at most 6 rows a side; more (deathmatch, custom lobbies) isn't one we can map
    if [Team::Ally, Team::Enemy]
        .iter()
        .any(|&t| rows.iter().filter(|r| r.team == t).count() > 6)
    {
        return None;
    }
    Some(Layout {
        left,
        right,
        header_y,
        row_h,
        rows,
    })
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

/// Portrait square of row `i` (pixels): starts 0.457 row heights right of the table edge, 0.965 rows wide.
pub fn portrait_box(l: &Layout, i: usize) -> Rect {
    let size = 0.965 * l.row_h;
    Rect {
        x: l.left as f32 + 0.457 * l.row_h,
        y: l.rows[i].y - size / 2.0,
        w: size,
        h: size,
    }
}

/// The part of a portrait used for features (center 76%, no border or background).
pub fn inner_box(b: Rect) -> Rect {
    let m = 0.12;
    Rect {
        x: b.x + b.w * m,
        y: b.y + b.h * m,
        w: b.w * (1.0 - 2.0 * m),
        h: b.h * (1.0 - 2.0 * m),
    }
}

pub const FEAT_SIZE: usize = 32;

/// Area-average downsample of `r` into FEAT_SIZE x FEAT_SIZE RGB.
pub fn sample(f: &Frame, r: Rect) -> Vec<f32> {
    let mut out = vec![0f32; FEAT_SIZE * FEAT_SIZE * 3];
    for y in 0..FEAT_SIZE {
        for x in 0..FEAT_SIZE {
            let sx0 = r.x + x as f32 * r.w / FEAT_SIZE as f32;
            let sx1 = r.x + (x + 1) as f32 * r.w / FEAT_SIZE as f32;
            let sy0 = r.y + y as f32 * r.h / FEAT_SIZE as f32;
            let sy1 = r.y + (y + 1) as f32 * r.h / FEAT_SIZE as f32;
            let mut acc = [0f32; 3];
            let mut n = 0f32;
            for yy in sy0.floor() as usize..(sy1.ceil() as usize).min(f.height) {
                for xx in sx0.floor() as usize..(sx1.ceil() as usize).min(f.width) {
                    let (pr, pg, pb) = f.px(xx, yy);
                    acc[0] += pr as f32;
                    acc[1] += pg as f32;
                    acc[2] += pb as f32;
                    n += 1.0;
                }
            }
            for k in 0..3 {
                out[(y * FEAT_SIZE + x) * 3 + k] = acc[k] / n.max(1.0);
            }
        }
    }
    out
}

/// Feature vector from FEAT_SIZE^2 RGB samples: normalized color plus brightness gradients, unit length.
/// The same TAB portrait art scores 0.94-0.98 cosine against itself and about 0 against other heroes.
pub fn feature(rgb: &[f32]) -> Vec<f32> {
    let n = FEAT_SIZE * FEAT_SIZE;
    let mean = rgb.iter().sum::<f32>() / rgb.len() as f32;
    let sd = (rgb.iter().map(|v| (v - mean).powi(2)).sum::<f32>() / rgb.len() as f32).sqrt() + 1e-6;
    let c: Vec<f32> = rgb.iter().map(|v| (v - mean) / sd).collect();
    let gray: Vec<f32> = (0..n)
        .map(|i| (c[i * 3] + c[i * 3 + 1] + c[i * 3 + 2]) / 3.0)
        .collect();
    let at = |x: usize, y: usize| gray[y * FEAT_SIZE + x];
    let mut out = Vec::with_capacity(n * 5);
    out.extend_from_slice(&c);
    let last = FEAT_SIZE - 1;
    let mut gx = Vec::with_capacity(n);
    let mut gy = Vec::with_capacity(n);
    for y in 0..FEAT_SIZE {
        for x in 0..FEAT_SIZE {
            let (x0, x1) = (x.saturating_sub(1), (x + 1).min(last));
            let (y0, y1) = (y.saturating_sub(1), (y + 1).min(last));
            gx.push(2.0 * (at(x1, y) - at(x0, y)) / (x1 - x0).max(1) as f32);
            gy.push(2.0 * (at(x, y1) - at(x, y0)) / (y1 - y0).max(1) as f32);
        }
    }
    out.extend(gx);
    out.extend(gy);
    let norm = out.iter().map(|v| v * v).sum::<f32>().sqrt().max(1e-9);
    out.iter_mut().for_each(|v| *v /= norm);
    out
}

/// Feature of portrait row `i`.
pub fn portrait_feature(f: &Frame, l: &Layout, i: usize) -> Vec<f32> {
    feature(&sample(f, inner_box(portrait_box(l, i))))
}

/// Features of portrait row `i` with the box shifted by up to 2 steps (1/44 of a row, about a pixel at
/// 1280x720) each way. One-pixel misplacement moves a score by as much as 0.3, so matching takes the
/// best shift. The unshifted feature comes first.
pub fn portrait_features(f: &Frame, l: &Layout, i: usize) -> Vec<Vec<f32>> {
    portrait_samples(f, l, i)
        .iter()
        .map(|s| feature(s))
        .collect()
}

/// Raw 32x32 RGB samples behind `portrait_features` (same shifts, same order).
pub fn portrait_samples(f: &Frame, l: &Layout, i: usize) -> Vec<Vec<f32>> {
    let b = inner_box(portrait_box(l, i));
    let step = l.row_h / 44.0;
    let mut out = vec![sample(f, b)];
    for dy in -2i32..=2 {
        for dx in -2i32..=2 {
            if dx != 0 || dy != 0 {
                let r = Rect {
                    x: b.x + dx as f32 * step,
                    y: b.y + dy as f32 * step,
                    ..b
                };
                out.push(sample(f, r));
            }
        }
    }
    out
}

/// Fills the central disc (radius `r` of the side) with the mean color of the rest, so a feature only
/// compares the outer part: a dead player's portrait stays visible (darkened) around the skull or the
/// respawn timer drawn over its middle.
pub fn mask_center(rgb: &[f32], r: f32) -> Vec<f32> {
    let n = FEAT_SIZE as f32;
    let inside = |k: usize| {
        let (x, y) = (
            (k % FEAT_SIZE) as f32 + 0.5 - n / 2.0,
            (k / FEAT_SIZE) as f32 + 0.5 - n / 2.0,
        );
        x * x + y * y < (r * n) * (r * n)
    };
    let (mut acc, mut cnt) = ([0f32; 3], 0f32);
    for k in 0..FEAT_SIZE * FEAT_SIZE {
        if !inside(k) {
            for c in 0..3 {
                acc[c] += rgb[k * 3 + c];
            }
            cnt += 1.0;
        }
    }
    let mean = acc.map(|v| v / cnt.max(1.0));
    let mut out = rgb.to_vec();
    for k in 0..FEAT_SIZE * FEAT_SIZE {
        if inside(k) {
            out[k * 3..k * 3 + 3].copy_from_slice(&mean);
        }
    }
    out
}

/// Picks the best label when it clears `min` and leads the next label by `margin`.
pub(crate) fn best_of(mut scores: Vec<(&str, f32)>, min: f32, margin: f32) -> Match {
    scores.sort_by(|a, b| b.1.total_cmp(&a.1));
    match scores.as_slice() {
        [] => Match {
            label: None,
            score: 0.0,
        },
        [(l, s), rest @ ..] => {
            let ok = *s >= min && rest.first().is_none_or(|(_, s2)| s - s2 >= margin);
            Match {
                label: ok.then(|| l.to_string()),
                score: *s,
            }
        }
    }
}

pub struct Template {
    /// A hero id, or "__unknown__" (the "?" placeholder) / "__dead__" (skull).
    pub label: String,
    pub feat: Vec<f32>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Match {
    pub label: Option<String>,
    pub score: f32,
}

pub const MATCH_MIN: f32 = 0.8;
const MARGIN_MIN: f32 = 0.08;

pub(crate) fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

/// Best template by label. `label: None` when nothing is close enough or the runner-up is too close.
pub fn classify(feat: &[f32], templates: &[Template]) -> Match {
    let mut best: Vec<(&str, f32)> = Vec::new();
    for t in templates {
        let s = dot(feat, &t.feat);
        match best.iter_mut().find(|(l, _)| *l == t.label) {
            Some(e) => e.1 = e.1.max(s),
            None => best.push((&t.label, s)),
        }
    }
    best.sort_by(|a, b| b.1.total_cmp(&a.1));
    match best.as_slice() {
        [] => Match {
            label: None,
            score: 0.0,
        },
        [(l, s), rest @ ..] => {
            let ok = *s >= MATCH_MIN && rest.first().is_none_or(|(_, s2)| s - s2 >= MARGIN_MIN);
            Match {
                label: ok.then(|| l.to_string()),
                score: *s,
            }
        }
    }
}

/// My row: the ally row whose name cells are clearly brighter (the scoreboard highlights it).
pub fn me_row(f: &Frame, l: &Layout) -> Option<usize> {
    let allies = l.team_rows(Team::Ally);
    if allies.len() < 2 {
        return allies.first().copied();
    }
    // Median background brightness below the name/title. Sampling the name line itself was fooled by a
    // bright nameplate or level badge (a party member could look like "me"); the bottom strip is the
    // row background and only the highlighted row is brighter.
    let means: Vec<f32> = allies
        .iter()
        .map(|&i| {
            let mut v: Vec<i32> = Vec::new();
            for dy in [0.32f32, 0.40] {
                let yy = ((l.rows[i].y + dy * l.row_h) as usize).min(f.height - 1);
                let mut x = (l.left as f32 + 2.3 * l.row_h) as usize;
                while (x as f32) < l.left as f32 + 5.8 * l.row_h {
                    let (r, g, b) = f.px(x.min(f.width - 1), yy);
                    v.push(r + g + b);
                    x += 2;
                }
            }
            v.sort_unstable();
            v.get(v.len() / 2).copied().unwrap_or(0) as f32
        })
        .collect();
    let mut sorted = means.clone();
    sorted.sort_by(|a, b| b.total_cmp(a));
    (sorted[0] > sorted[1] * 1.15)
        .then(|| allies[means.iter().position(|m| *m == sorted[0]).unwrap()])
}

#[derive(Debug, Clone, PartialEq)]
pub struct Reading {
    pub layout: Layout,
    /// One match per layout row (same order).
    pub rows: Vec<Match>,
    pub me: Option<usize>,
}

/// A team can't have the same hero twice; such frames are mid-animation and get dropped.
pub fn sane(r: &Reading) -> bool {
    [Team::Ally, Team::Enemy].iter().all(|&team| {
        let mut heroes: Vec<&str> = r
            .layout
            .team_rows(team)
            .into_iter()
            .filter_map(|i| r.rows[i].label.as_deref())
            .filter(|l| !l.starts_with("__"))
            .collect();
        let n = heroes.len();
        heroes.sort();
        heroes.dedup();
        heroes.len() == n
    })
}

/// Recognizes row `i`: the user's taught portraits first (they also cover "?", skull and timer states),
/// then the built-in hero portraits.
pub fn recognize(samples: &[Vec<f32>], bg: [f32; 3], templates: &[Template]) -> Match {
    let feats: Vec<Vec<f32>> = samples.iter().map(|s| feature(s)).collect();
    // taught portraits: best shift per label
    let mut scores: Vec<(&str, f32)> = Vec::new();
    for t in templates {
        let v = feats
            .iter()
            .map(|f| dot(f, &t.feat))
            .fold(f32::MIN, f32::max);
        match scores.iter_mut().find(|(l, _)| *l == t.label) {
            Some(e) => e.1 = e.1.max(v),
            None => scores.push((&t.label, v)),
        }
    }
    let taught = best_of(scores, MATCH_MIN, MARGIN_MIN);
    let found = if taught.label.is_some() {
        taught
    } else {
        let seed = seeds::match_seed(&feats, bg);
        if seed.label.is_some() { seed } else { taught }
    };
    // a dead player (skull or respawn timer) or an unread portrait: try the hero around the middle
    if found.label.is_none() || found.label.as_deref() == Some("__dead__") {
        let hero = seeds::match_seed_masked(samples, bg, seeds::DEAD_RADIUS);
        if hero.label.is_some() {
            return hero;
        }
    }
    found
}

/// Reads every row (None if the frame isn't a scoreboard).
pub fn read(f: &Frame, templates: &[Template]) -> Option<Reading> {
    let layout = detect_scoreboard(f)?;
    let rows = (0..layout.rows.len())
        .map(|i| {
            recognize(
                &portrait_samples(f, &layout, i),
                seeds::row_background(f, &layout, i),
                templates,
            )
        })
        .collect();
    let me = me_row(f, &layout);
    Some(Reading { layout, rows, me })
}
