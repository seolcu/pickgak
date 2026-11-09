//! The "match rank range" emblems at the top right of the competitive TAB screen ("경기 등급 범위: [low] -
//! [high]"), under the timer. Missing during placement matches and outside competitive.
//!
//! Emblems of the same shape differ only in color (silver and gold are both a "Y"), so the score is the
//! shape similarity minus the distance between the emblems' mean chromaticity.

use crate::{Frame, Match, Rect, best_of, dot, feature, sample, seeds::Seed};
use std::sync::OnceLock;

/// The right tier scores 0.78-0.86 on the captures; the next one (same shape, other color) at most 0.0.
pub const RANK_MIN: f32 = 0.5;
pub const RANK_MARGIN: f32 = 0.15;
const CHROMA_WEIGHT: f32 = 4.0;

fn rank_seeds() -> &'static [Seed] {
    static SEEDS: OnceLock<Vec<Seed>> = OnceLock::new();
    SEEDS.get_or_init(|| crate::seeds::parse(include_bytes!("ranks.bin")))
}

/// Mean r/g/b share of the bright (emblem) pixels.
fn chroma(px: impl Iterator<Item = [f32; 3]>) -> [f32; 3] {
    let (mut acc, mut n) = ([0f32; 3], 0f32);
    for p in px {
        if p[0].max(p[1]).max(p[2]) > 110.0 {
            let s = p[0] + p[1] + p[2] + 1e-6;
            for c in 0..3 {
                acc[c] += p[c] / s;
            }
            n += 1.0;
        }
    }
    acc.map(|v| v / n.max(1.0))
}

/// Emblem boxes, left to right: bright blobs in the band under the timer, at least 2.2% of the height
/// tall (the "경기 등급 범위:" text and the dash between the emblems are shorter). Gaps up to 0.53% of the
/// height are joined (the silver "Y" has one in the middle).
pub fn rank_boxes(f: &Frame) -> Vec<Rect> {
    let (y0, y1) = (
        (0.075 * f.height as f32) as usize,
        (0.125 * f.height as f32) as usize,
    );
    // anchored to the right edge; sizes by height
    let x0 = f.width.saturating_sub((0.25 * f.height as f32) as usize);
    let bright = |x: usize, y: usize| {
        let (r, g, b) = f.px(x, y);
        r.max(g).max(b) > 110
    };
    let mut runs: Vec<(usize, usize)> = Vec::new();
    let gap = (0.0053 * f.height as f32) as usize;
    for x in x0..f.width {
        if (y0..y1).filter(|&y| bright(x, y)).count() >= 2 {
            match runs.last_mut() {
                Some(r) if x - r.1 <= gap + 1 => r.1 = x,
                _ => runs.push((x, x)),
            }
        }
    }
    let min = 0.022 * f.height as f32;
    runs.into_iter()
        .filter_map(|(s, e)| {
            let ys: Vec<usize> = (y0..y1)
                .filter(|&y| (s..=e).any(|x| bright(x, y)))
                .collect();
            let (t, b) = (*ys.first()?, *ys.last()?);
            let (w, h) = ((e - s + 1) as f32, (b - t + 1) as f32);
            (h >= min && w >= min).then(|| {
                let side = w.max(h);
                Rect {
                    x: s as f32 + w / 2.0 - side / 2.0,
                    y: t as f32 + h / 2.0 - side / 2.0,
                    w: side,
                    h: side,
                }
            })
        })
        .collect()
}

/// Tiers of the emblems shown (one or two), lowest first. Empty when there are none.
pub fn read_rank_range(f: &Frame) -> Vec<Match> {
    read_rank_range_in(f, &rank_boxes(f))
}

/// Reads the emblems in `boxes` (from `rank_boxes`), so a caller that already has the boxes doesn't
/// scan the frame twice.
pub fn read_rank_range_in(f: &Frame, boxes: &[Rect]) -> Vec<Match> {
    boxes
        .iter()
        .copied()
        .map(|b| {
            let rgb = sample(f, b);
            let feat = feature(&rgb);
            let bg = [rgb[0], rgb[1], rgb[2]];
            let screen = chroma(rgb.as_chunks::<3>().0.iter().copied());
            let scores = rank_seeds()
                .iter()
                .map(|s| {
                    let shape = dot(&feat, &s.feature_on(bg));
                    let c = chroma(s.opaque_pixels());
                    let dist = (0..3)
                        .map(|k| (c[k] - screen[k]).powi(2))
                        .sum::<f32>()
                        .sqrt();
                    (s.label.as_str(), shape - CHROMA_WEIGHT * dist)
                })
                .collect();
            best_of(scores, RANK_MIN, RANK_MARGIN)
        })
        .collect()
}
