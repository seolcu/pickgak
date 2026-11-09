//! The mode and map name at the top right of the TAB screen ("밀기 | 콜로세오"), as a feature.
//!
//! There's no OCR: the game's font doesn't match any font we could ship closely enough (rendered names
//! led the right map by only 0.06-0.16 on the recording). Instead the app remembers the text's feature
//! when the user picks the map once, and recognizes the same map from then on. Both sides go through this
//! same extraction, so only consistency matters, not reading the letters.

use crate::Frame;

const W: usize = 64;
const H: usize = 12;
/// Same map text: cosine similarity and width/height ratio agreement. The same map scores 0.99+ at the
/// same resolution and about 0.92 across resolutions (a new resolution needs picking the map once more).
/// A wrong match between two similar names reached 0.95 on a real capture, so require 0.98.
pub const MAP_MIN: f32 = 0.98;
const ASPECT_TOL: f32 = 0.08;

#[derive(Debug, Clone, PartialEq)]
pub struct MapText {
    pub feat: Vec<f32>,
    /// Width / height of the text block.
    pub aspect: f32,
    /// The map name block (x, y, width, height) in pixels, for debugging views.
    pub rect: [usize; 4],
    /// The whole "mode | map" text block. OCR reads this wider block better than the map name alone
    /// (the mode gives Tesseract context); the map name is its suffix.
    pub full: [usize; 4],
}

fn is_text(r: i32, g: i32, b: i32) -> bool {
    let (lo, hi) = (r.min(g).min(b), r.max(g).max(b));
    lo > 120 && hi - lo < 60
}

/// Mode icon + "mode | map": the light-gray block just left of the white "시간:" (the timer itself is
/// orange and isn't text here). None when the area doesn't look like that.
pub fn map_text(f: &Frame) -> Option<MapText> {
    let (y0, y1) = (
        (0.025 * f.height as f32) as usize,
        (0.06 * f.height as f32) as usize,
    );
    // the HUD is laid out by height and anchored to the right edge (16:9: 0.55 of the width)
    let x0 = f.width.saturating_sub((0.8 * f.height as f32) as usize);
    // Empty columns that split the "mode | map" block from "시간:" (measured at 1440p over 150 user
    // captures): inside the block at most 11 (the word space in "왕의 길"), before "시간:" 14-17.
    // The old cut at 15 merged the two on 14 ("서킷 로얄" and some "일리오스" frames), so the map
    // went unread. The mode icon sits 9-19 columns before the text and may fall on either side.
    let gap = 0.0087 * f.height as f32;
    let on = |x: usize, y: usize| {
        let (r, g, b) = f.px(x, y);
        is_text(r, g, b)
    };
    // runs of text columns, split by gaps of at least `gap` empty columns
    let mut segs: Vec<(usize, usize)> = Vec::new();
    for x in x0..f.width {
        if (y0..y1).any(|y| on(x, y)) {
            match segs.last_mut() {
                Some(s) if ((x - s.1 - 1) as f32) < gap => s.1 = x,
                _ => segs.push((x, x)),
            }
        }
    }
    if segs.len() < 2 {
        return None;
    }
    let (mut sx, ex) = segs[segs.len() - 2];
    let rows: Vec<usize> = (y0..y1).filter(|&y| (sx..=ex).any(|x| on(x, y))).collect();
    let (sy, ey) = (*rows.first()?, *rows.last()?);
    let full = [sx, sy, ex - sx + 1, ey - sy + 1];
    // keep only the map name, right of the "|" separator: the mode before it differs between quick
    // play and competitive ("쟁탈 | 리장 타워" vs "쟁탈 - 경쟁전 | 리장 타워")
    if let Some(after) = separator(&on, sx, ex, sy, ey, f.height) {
        sx = after;
    }
    let rows: Vec<usize> = (sy..=ey).filter(|&y| (sx..=ex).any(|x| on(x, y))).collect();
    let (sy, ey) = (*rows.first()?, *rows.last()?);
    let (w, h) = (ex - sx + 1, ey - sy + 1);
    if h < 5 || w < 2 * h {
        return None;
    }
    // area-average the mask onto W x H
    let mut v = vec![0f32; W * H];
    for (k, cell) in v.iter_mut().enumerate() {
        let (cx, cy) = (k % W, k / W);
        let (ax, bx) = (
            sx + cx * w / W,
            (sx + (cx + 1) * w / W).max(sx + cx * w / W + 1),
        );
        let (ay, by) = (
            sy + cy * h / H,
            (sy + (cy + 1) * h / H).max(sy + cy * h / H + 1),
        );
        // soft value (anti-aliased edges count partly), so 1280 and 2560 frames agree
        let mut n = 0f32;
        for y in ay..by.min(ey + 1) {
            for x in ax..bx.min(ex + 1) {
                let (r, g, b) = f.px(x, y);
                let (lo, hi) = (r.min(g).min(b), r.max(g).max(b));
                if hi - lo < 60 {
                    n += ((lo - 60) as f32 / 120.0).clamp(0.0, 1.0);
                }
            }
        }
        *cell = n / ((bx - ax) * (by - ay)) as f32;
    }
    let mean = v.iter().sum::<f32>() / v.len() as f32;
    v.iter_mut().for_each(|x| *x -= mean);
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-9);
    v.iter_mut().for_each(|x| *x /= norm);
    Some(MapText {
        feat: v,
        aspect: w as f32 / h as f32,
        rect: [sx, sy, w, h],
        full,
    })
}

/// First text column after the "|" separator: a thin, tall column group with clear space on both sides
/// (measured at 1440p: the bar is 2-3 px wide, 24-26 px tall, with 7-10 px gaps). The thin "ㅣ" strokes
/// inside Hangul syllables are as tall but sit 0-4 px from the rest of their syllable.
fn separator(
    on: &impl Fn(usize, usize) -> bool,
    sx: usize,
    ex: usize,
    sy: usize,
    ey: usize,
    height: usize,
) -> Option<usize> {
    let hf = height as f32;
    let col = |x: usize| (sy..=ey).filter(|&y| on(x, y)).count();
    let mut groups: Vec<(usize, usize)> = Vec::new();
    for x in sx..=ex {
        if col(x) > 0 {
            match groups.last_mut() {
                Some(g) if g.1 + 1 == x => g.1 = x,
                _ => groups.push((x, x)),
            }
        }
    }
    let (thin, tall, gap) = ((0.004 * hf).max(2.0), 0.014 * hf, 0.0042 * hf);
    for (i, &(a, b)) in groups.iter().enumerate() {
        let is_thin = (b - a + 1) as f32 <= thin;
        let is_tall = (a..=b).map(col).max().unwrap_or(0) as f32 >= tall;
        let left = i == 0 || (a - groups[i - 1].1 - 1) as f32 >= gap;
        let right = groups
            .get(i + 1)
            .is_some_and(|n| (n.0 - b - 1) as f32 >= gap);
        if is_thin && is_tall && left && right {
            return groups.get(i + 1).map(|n| n.0);
        }
    }
    None
}

/// Similarity of two map texts; 0 when their shapes differ.
pub fn similarity(a: &MapText, b: &MapText) -> f32 {
    if (a.aspect / b.aspect - 1.0).abs() > ASPECT_TOL {
        return 0.0;
    }
    crate::dot(&a.feat, &b.feat)
}

/// Best remembered map for this text (`known`: map id and text), when similar enough.
pub fn match_map<'a>(t: &MapText, known: &'a [(String, MapText)]) -> Option<&'a str> {
    known
        .iter()
        .map(|(id, k)| (id.as_str(), similarity(t, k)))
        .filter(|(_, s)| *s >= MAP_MIN)
        .max_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(id, _)| id)
}
