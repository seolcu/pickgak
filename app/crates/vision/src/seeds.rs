//! Built-in hero portraits, so heroes are recognized before the user teaches anything.
//!
//! - `seeds.bin`: one 32x32 RGBA thumbnail per hero, cut from the "2D portrait" art that the TAB
//!   scoreboard shows (built by `app/scripts/make-seeds.py`). The portraits have transparent
//!   backgrounds and the scoreboard draws them over the row color (blue, red, brighter for my row), so
//!   each thumbnail is composited onto the row's own background before comparing features.
//! - `states.bin`: opaque templates for rows that don't show a hero: "?", the skull (dead) and an empty practice-range
//!   row (built by `examples/make_states.rs` from the test fixtures).

use std::sync::OnceLock;

use crate::{FEAT_SIZE, Frame, Layout, Match, dot, feature};

/// Accept a built-in match only when it's clearly the best. Measured on the match and practice-range
/// fixtures: the right hero scores 0.58-0.94 and leads the next by 0.11 or more; "?" and empty rows match
/// their state templates at 0.98+; respawn timers stay under 0.31.
pub const SEED_MIN: f32 = 0.5;
pub const SEED_MARGIN: f32 = 0.1;

pub struct Seed {
    pub label: String,
    rgba: Vec<u8>,
}

pub fn seeds() -> &'static [Seed] {
    static SEEDS: OnceLock<Vec<Seed>> = OnceLock::new();
    SEEDS.get_or_init(|| {
        let mut all = parse(include_bytes!("seeds.bin"));
        all.extend(parse(include_bytes!("states.bin")));
        all
    })
}

pub(crate) fn parse(b: &[u8]) -> Vec<Seed> {
    let px = FEAT_SIZE * FEAT_SIZE * 4;
    let mut out = Vec::new();
    if b.len() < 6 || &b[..4] != b"PGS1" {
        return out;
    }
    let n = u16::from_le_bytes([b[4], b[5]]) as usize;
    let mut i = 6;
    for _ in 0..n {
        let Some(&len) = b.get(i) else { break };
        let (s, e) = (i + 1, i + 1 + len as usize);
        let Some(rgba) = b.get(e..e + px) else { break };
        out.push(Seed {
            label: String::from_utf8_lossy(&b[s..e]).into_owned(),
            rgba: rgba.to_vec(),
        });
        i = e + px;
    }
    out
}

/// Background color of row `i`: the team-color band between the role icon and the portrait (the scan
/// column that found the rows). The portrait's own corners don't work: some art (and my highlighted row)
/// reaches them.
pub fn row_background(f: &Frame, l: &Layout, i: usize) -> [f32; 3] {
    let x = (l.left + (l.right - l.left) * 3 / 100).min(f.width - 1);
    let (mut acc, mut n) = ([0f32; 3], 0f32);
    let (y0, y1) = (l.rows[i].y - 0.3 * l.row_h, l.rows[i].y + 0.3 * l.row_h);
    let mut y = y0.max(0.0) as usize;
    while (y as f32) < y1 && y < f.height {
        for dx in 0..3 {
            let (r, g, b) = f.px((x + dx).min(f.width - 1), y);
            // skip anything that isn't the band (role icon, glow)
            if r.min(g).min(b) < 200 {
                acc[0] += r as f32;
                acc[1] += g as f32;
                acc[2] += b as f32;
                n += 1.0;
            }
        }
        y += 1;
    }
    if n == 0.0 {
        return [128.0; 3];
    }
    acc.map(|v| v / n)
}

impl Seed {
    /// The thumbnail's opaque pixels as RGB.
    pub fn opaque_pixels(&self) -> impl Iterator<Item = [f32; 3]> + '_ {
        self.rgba
            .as_chunks::<4>()
            .0
            .iter()
            .filter(|p| p[3] > 200)
            .map(|p| [p[0] as f32, p[1] as f32, p[2] as f32])
    }

    /// Feature of this thumbnail composited onto `bg`.
    pub fn feature_on(&self, bg: [f32; 3]) -> Vec<f32> {
        seed_feature(self, bg)
    }
}

/// The thumbnail composited onto `bg`, as 32x32 RGB.
pub(crate) fn seed_rgb(s: &Seed, bg: [f32; 3]) -> Vec<f32> {
    s.rgba
        .as_chunks::<4>()
        .0
        .iter()
        .flat_map(|p| {
            let a = p[3] as f32 / 255.0;
            (0..3).map(move |k| p[k] as f32 * a + bg[k] * (1.0 - a))
        })
        .collect()
}

/// Masked matching for dead players: the disc radius and stricter thresholds. Measured on the fixtures and
/// the competitive captures: with less to compare, a wrong hero can reach 0.66 (Echo for a dead Pharah),
/// the right ones that pass score 0.83-0.92 with a lead of 0.15+; the rest stay unread.
pub const DEAD_RADIUS: f32 = 0.45;
pub const DEAD_MIN: f32 = 0.7;
pub const DEAD_MARGIN: f32 = 0.12;

/// Best built-in hero for a dead player's portrait (skull or respawn timer over its darkened middle):
/// compares only the part outside the central disc of radius `r`.
pub fn match_seed_masked(samples: &[Vec<f32>], bg: [f32; 3], r: f32) -> Match {
    let feats: Vec<Vec<f32>> = samples
        .iter()
        .map(|s| feature(&crate::mask_center(s, r)))
        .collect();
    let scores: Vec<(&str, f32)> = seeds()
        .iter()
        .filter(|s| !s.label.starts_with("__"))
        .map(|s| {
            let sf = feature(&crate::mask_center(&seed_rgb(s, bg), r));
            (
                s.label.as_str(),
                feats.iter().map(|f| dot(f, &sf)).fold(f32::MIN, f32::max),
            )
        })
        .collect();
    crate::best_of(scores, DEAD_MIN, DEAD_MARGIN)
}

fn seed_feature(s: &Seed, bg: [f32; 3]) -> Vec<f32> {
    feature(&seed_rgb(s, bg))
}

/// Best built-in hero for a portrait, given its features at a few small shifts (see
/// `portrait_features`) and the row's background `bg`. Each label scores its best shift.
pub fn match_seed(feats: &[Vec<f32>], bg: [f32; 3]) -> Match {
    let mut scores: Vec<(&str, f32)> = Vec::new();
    for s in seeds() {
        let sf = seed_feature(s, bg);
        let v = feats.iter().map(|f| dot(f, &sf)).fold(f32::MIN, f32::max);
        match scores.iter_mut().find(|(l, _)| *l == s.label) {
            Some(e) => e.1 = e.1.max(v),
            None => scores.push((&s.label, v)),
        }
    }
    crate::best_of(scores, SEED_MIN, SEED_MARGIN)
}
