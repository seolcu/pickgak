//! Banned heroes on the competitive TAB screen: a strip of red-framed hero icons at the top left, next to
//! the "점수판" tab. The icons are the hero thumbnails from Nexon's stats page (`bans.bin`), not the
//! scoreboard portraits.

use crate::{FEAT_SIZE, Frame, Match, Rect, best_of, dot, feature, sample, seeds::Seed};
use std::sync::OnceLock;

/// The right icon scores 0.80-0.89 and leads the next hero by 0.38+ on the fixtures.
pub const BAN_MIN: f32 = 0.6;
pub const BAN_MARGIN: f32 = 0.15;

fn ban_seeds() -> &'static [Seed] {
    static SEEDS: OnceLock<Vec<Seed>> = OnceLock::new();
    SEEDS.get_or_init(|| crate::seeds::parse(include_bytes!("bans.bin")))
}

fn is_red(r: i32, g: i32, b: i32) -> bool {
    r > 150 && g < 70 && b < 70
}

/// The red frames, left to right (outer boxes in pixels).
pub fn ban_boxes(f: &Frame) -> Vec<Rect> {
    let (h_max, w_max) = (
        (0.08 * f.height as f32) as usize,
        // left part, by height (the strip is anchored to the left edge)
        ((0.8 * f.height as f32) as usize).min(f.width),
    );
    let tall = (0.03 * f.height as f32) as usize;
    let reds = |x: usize| -> Vec<usize> {
        (0..h_max)
            .filter(|&y| {
                let (r, g, b) = f.px(x, y);
                is_red(r, g, b)
            })
            .collect()
    };
    // runs of columns with some red (a frame's inner columns have only its top and bottom border)
    let mut out = Vec::new();
    let mut run: Option<(usize, usize, usize, usize, usize)> = None; // start, end, top, bottom, tallest column
    for x in 0..=w_max {
        let ys = if x < w_max { reds(x) } else { Vec::new() };
        if ys.len() >= 3 {
            let (t, b) = (ys[0], ys[ys.len() - 1]);
            run = Some(match run {
                Some((s0, _, t0, b0, m)) => (s0, x, t0.min(t), b0.max(b), m.max(ys.len())),
                None => (x, x, t, b, ys.len()),
            });
        } else if let Some((s0, e0, t0, b0, m)) = run.take() {
            let (w, h) = ((e0 - s0 + 1) as f32, (b0 - t0 + 1) as f32);
            // a square frame with tall side edges (the ⊘ sign before the strip is a thin ring)
            if m >= tall && (0.8..1.25).contains(&(w / h)) {
                out.push(Rect {
                    x: s0 as f32,
                    y: t0 as f32,
                    w,
                    h,
                });
            }
        }
    }
    out
}

/// The icon area inside a red frame.
fn inner(b: Rect) -> Rect {
    let m = 0.07 * b.w;
    Rect {
        x: b.x + m,
        y: b.y + m,
        w: b.w - 2.0 * m,
        h: b.h - 2.0 * m,
    }
}

/// A frame with no hero in it (a ban slot nobody filled): nearly one flat color.
fn is_empty(f: &Frame, b: Rect) -> bool {
    let rgb = sample(f, inner(b));
    let mean = rgb.iter().sum::<f32>() / rgb.len() as f32;
    let sd = (rgb.iter().map(|v| (v - mean).powi(2)).sum::<f32>() / rgb.len() as f32).sqrt();
    sd < 12.0
}

/// Reads each ban icon, skipping empty slots; None where an icon isn't recognized.
pub fn read_bans(f: &Frame) -> Vec<Match> {
    read_bans_in(f, &ban_boxes(f))
}

/// Reads the icons in `boxes` (from `ban_boxes`), so a caller that already has the boxes doesn't scan
/// the frame twice.
pub fn read_bans_in(f: &Frame, boxes: &[Rect]) -> Vec<Match> {
    boxes
        .iter()
        .copied()
        .filter(|&b| !is_empty(f, b))
        .map(|b| {
            let inner = inner(b);
            let step = inner.w / FEAT_SIZE as f32;
            let feats: Vec<Vec<f32>> = (-1i32..=1)
                .flat_map(|dy| (-1i32..=1).map(move |dx| (dx, dy)))
                .map(|(dx, dy)| {
                    feature(&sample(
                        f,
                        Rect {
                            x: inner.x + dx as f32 * step,
                            y: inner.y + dy as f32 * step,
                            ..inner
                        },
                    ))
                })
                .collect();
            let scores = ban_seeds()
                .iter()
                .map(|s| {
                    let sf = s.feature_on([0.0; 3]);
                    (
                        s.label.as_str(),
                        feats.iter().map(|x| dot(x, &sf)).fold(f32::MIN, f32::max),
                    )
                })
                .collect();
            best_of(scores, BAN_MIN, BAN_MARGIN)
        })
        .collect()
}
