//! The player name written on a scoreboard row, as a glyph mask.
//!
//! OCR of the game font is not reliable (a 2560x1440 capture read a five-syllable Korean name as five wrong syllables), so a
//! name is compared to the name images we have already confirmed for the registered players. Both sides
//! go through this same extraction, so only consistency matters.
//!
//! Only the bright name glyphs are kept: the colored nameplate behind a name, the level emblem and the
//! small title line below (which is dimmer) are not part of the fingerprint. Measured on a 2560x1440
//! capture, every channel of the name glyphs is above 200, the title text stays below 190 and the plate
//! outline is colored (one channel much lower), so the band below plus the bright threshold separates
//! them. The component width limit drops a bright plate edge; a glyph part is never wider than the text
//! is tall.
//!
//! Same name: 0.80-1.00 across 0.5x-2x scales. Different names: at most 0.25 on that capture, but two
//! nicknames one syllable apart reached 0.77. The automatic bar (`NAME_MIN`, `NAME_MARGIN`) sits above
//! that; anything between `SUGGEST_MIN` and it is only a question for the user.

use crate::{Frame, Layout, Team};

/// Feature grid (width x height). Names of every length are squashed onto it, so only the same name has
/// the same glyph pattern.
pub const W: usize = 64;
pub const H: usize = 16;

/// An automatic match against a confirmed name image. The same name at the same resolution scores 1.00.
/// A 1440p template read from a 1080p frame scored 0.59-0.99; that is still the right player, but below
/// this bar, so a resolution change asks once more instead of guessing. Nicknames that differ by one
/// syllable scored 0.77, so this bar also keeps them apart when only one of the two is registered.
pub const NAME_MIN: f32 = 0.90;
/// The best player must lead the runner-up by this much (one-syllable-different nicknames).
pub const NAME_MARGIN: f32 = 0.10;
/// A name image below the automatic bar is still a useful question for the overlay ("is this X?").
/// Random names scored at most 0.25 against these fingerprints.
pub const SUGGEST_MIN: f32 = 0.55;

/// The soft glyph mask below this brightness is background; the feature keeps the gradient above it.
const TEXT_LO: f32 = 185.0;
/// A pixel belongs to a glyph for the bounding box and component filter above about 210 brightness. The
/// small title line below the name stays below it, so it is not part of the fingerprint.
const GLYPH_ON: f32 = 91.0;

/// Glyph parts starting left of this many row heights from the ally band's edge are the ult circle.
const NAME_X: f32 = 0.21;
/// Brightest glyph pixel of a settled name: settled frames reach 255. A frame caught while the
/// scoreboard fades in peaked at 228-231 and its fingerprint dropped to 0.55-0.88 against the same name;
/// one near the end of the fade (243-245) still scored 0.87-0.96, like a settled frame.
const FADE_BRIGHT: f32 = 240.0;
const FADE_PEAK: f32 = (FADE_BRIGHT - TEXT_LO) / (255.0 - TEXT_LO);

#[derive(Clone, Debug, PartialEq)]
pub struct Name {
    /// `W * H` values, mean subtracted and unit length.
    pub feat: Vec<f32>,
    /// Tight box of the glyphs in frame pixels: [x, y, width, height].
    pub rect: [usize; 4],
}

/// Bright name glyphs of row `row`, or None when the band has no text.
pub fn name_of(f: &Frame, l: &Layout, row: usize) -> Option<Name> {
    let r = l.rows.get(row)?;
    let rh = l.row_h;
    // The name column starts after the ult circle on ally rows and after the portrait on enemy rows
    // (enemy rows have no ult circle). The perk icons start 5 row heights right of the table edge.
    let x0f = match r.team {
        Team::Ally => l.left as f32 + 1.9 * rh,
        Team::Enemy => l.left as f32 + 1.5 * rh,
    };
    let x1f = l.left as f32 + 5.0 * rh;
    // Generous band around the name line: the line sits a little differently between captures (measured
    // -0.21 to +0.12 row heights on two recordings), and the bright threshold above excludes the title.
    let y0f = r.y - 0.42 * rh;
    let y1f = r.y + 0.22 * rh;
    let (x0, x1) = (x0f.max(0.0) as usize, (x1f as usize).min(f.width));
    let (y0, y1) = (y0f.max(0.0) as usize, (y1f as usize).min(f.height));
    let (bw, bh) = (x1.saturating_sub(x0), y1.saturating_sub(y0));
    if bw < 8 || bh < 6 {
        return None;
    }
    let mut soft = vec![0f32; bw * bh];
    for y in 0..bh {
        for x in 0..bw {
            let (r, g, b) = f.px(x0 + x, y0 + y);
            let m = r.min(g).min(b) as f32;
            soft[y * bw + x] = ((m - TEXT_LO) / (255.0 - TEXT_LO)).clamp(0.0, 1.0);
        }
    }
    // A nameplate edge is a wide, thin bar (its height fails min_h); syllables that touch can form a
    // component up to about three glyphs wide, so the width limit is only a guard against a big plate.
    let max_w = (3.0 * bh as f32) as usize;
    let min_h = (0.15 * bh as f32) as usize;
    let mut seen = vec![false; bw * bh];
    let mut stack: Vec<usize> = Vec::new();
    let (mut bx0, mut by0, mut bx1, mut by1) = (usize::MAX, usize::MAX, 0, 0);
    // On ally rows the ult circle sits just left of the name; its ring, check mark and percentage digits
    // are as bright as the glyphs and reach into this band (35 of 274 party rows on three recordings).
    // There it scored 0.32 against the same name. A name starts 0.27-0.32 row heights right of the band's
    // left edge (0.62 on one smaller layout); the circle parts start at the edge and reach 0.07-0.25.
    let skip_x = match r.team {
        Team::Ally => (NAME_X * rh) as usize,
        Team::Enemy => 0,
    };
    let mut kept = false;
    let mut peak = 0f32;
    for start in 0..bw * bh {
        if seen[start] || soft[start] * 255.0 <= GLYPH_ON {
            continue;
        }
        seen[start] = true;
        stack.push(start);
        let (mut cx0, mut cy0, mut cx1, mut cy1, mut area) = (usize::MAX, usize::MAX, 0, 0, 0);
        let mut cpeak = 0f32;
        while let Some(i) = stack.pop() {
            let (x, y) = (i % bw, i / bw);
            cpeak = cpeak.max(soft[i]);
            cx0 = cx0.min(x);
            cy0 = cy0.min(y);
            cx1 = cx1.max(x);
            cy1 = cy1.max(y);
            area += 1;
            for dy in -1i32..=1 {
                for dx in -1i32..=1 {
                    if dx == 0 && dy == 0 {
                        continue;
                    }
                    let (nx, ny) = (x as i32 + dx, y as i32 + dy);
                    if nx < 0 || ny < 0 || nx >= bw as i32 || ny >= bh as i32 {
                        continue;
                    }
                    let j = ny as usize * bw + nx as usize;
                    if !seen[j] && soft[j] * 255.0 > GLYPH_ON {
                        seen[j] = true;
                        stack.push(j);
                    }
                }
            }
        }
        let (cw, ch) = (cx1 - cx0 + 1, cy1 - cy0 + 1);
        // A wide bright plate edge is not a letter; a thin speck is not one either.
        if cw > max_w || ch < min_h || area < 4 || cx0 < skip_x {
            continue;
        }
        kept = true;
        peak = peak.max(cpeak);
        bx0 = bx0.min(cx0);
        by0 = by0.min(cy0);
        bx1 = bx1.max(cx1);
        by1 = by1.max(cy1);
    }
    // A scoreboard that is still fading in has dimmer glyphs, and the soft mask of a dim name is a
    // different fingerprint. Leave the name unread on such a frame; the next capture has it.
    if !kept || peak < FADE_PEAK {
        return None;
    }
    let (w, h) = (bx1 - bx0 + 1, by1 - by0 + 1);
    if w < 2 || h < 3 {
        return None;
    }
    // Area-average the soft mask onto W x H. Both a 720p and a 4K name land on the same grid.
    let mut v = vec![0f32; W * H];
    for (k, cell) in v.iter_mut().enumerate() {
        let (cx, cy) = (k % W, k / W);
        let ax = bx0 + cx * w / W;
        let bx = (bx0 + (cx + 1) * w / W).max(ax + 1);
        let ay = by0 + cy * h / H;
        let by = (by0 + (cy + 1) * h / H).max(ay + 1);
        let mut sum = 0f32;
        let mut n = 0f32;
        for y in ay..by.min(by1 + 1) {
            for x in ax..bx.min(bx1 + 1) {
                sum += soft[y * bw + x];
                n += 1.0;
            }
        }
        *cell = sum / n.max(1.0);
    }
    let mean = v.iter().sum::<f32>() / v.len() as f32;
    v.iter_mut().for_each(|x| *x -= mean);
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-9);
    v.iter_mut().for_each(|x| *x /= norm);
    Some(Name {
        feat: v,
        rect: [x0 + bx0, y0 + by0, w, h],
    })
}

/// Cosine similarity of two name features (both unit length).
pub fn similarity(a: &[f32], b: &[f32]) -> f32 {
    crate::dot(a, b)
}

/// Best template score per player, highest first.
pub fn name_scores<'a>(
    feat: &[f32],
    templates: impl IntoIterator<Item = (i64, &'a [f32])>,
) -> Vec<(i64, f32)> {
    let mut scores: Vec<(i64, f32)> = Vec::new();
    for (player, t) in templates {
        let s = similarity(feat, t);
        match scores.iter_mut().find(|(p, _)| *p == player) {
            Some(e) => e.1 = e.1.max(s),
            None => scores.push((player, s)),
        }
    }
    scores.sort_by(|a, b| b.1.total_cmp(&a.1));
    scores
}

/// Automatic match: clears NAME_MIN and leads the runner-up by NAME_MARGIN.
pub fn best_name(scores: &[(i64, f32)]) -> Option<(i64, f32)> {
    match scores {
        [] => None,
        [(p, s), rest @ ..] => {
            let ok = *s >= NAME_MIN && rest.first().is_none_or(|(_, s2)| *s - *s2 >= NAME_MARGIN);
            ok.then_some((*p, *s))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Frame, Layout, RowPos};

    type Rects = Vec<(usize, usize, usize, usize, [u8; 3])>;

    fn frame_with(rows: &[(f32, Rects)], row_h: f32) -> (Vec<u8>, usize, usize, Layout) {
        let (w, h) = (400, 400);
        let mut data = vec![0u8; w * h * 4];
        for y in 0..h {
            for x in 0..w {
                let i = (y * w + x) * 4;
                data[i..i + 3].copy_from_slice(&[20, 60, 90]);
                data[i + 3] = 255;
            }
        }
        for (_, rects) in rows {
            for &(x, y, rw, rh, c) in rects {
                for yy in y..(y + rh).min(h) {
                    for xx in x..(x + rw).min(w) {
                        let i = (yy * w + xx) * 4;
                        data[i..i + 3].copy_from_slice(&c);
                    }
                }
            }
        }
        let layout = Layout {
            left: 20,
            right: 380,
            header_y: 0,
            row_h,
            rows: rows
                .iter()
                .map(|(y, _)| RowPos {
                    team: Team::Ally,
                    y: *y,
                })
                .collect(),
        };
        (data, w, h, layout)
    }

    #[test]
    fn keeps_glyphs_and_drops_the_plate_and_title() {
        // row at y=100, row_h=50: name band y 82..104, name column x 115..270
        let letters = vec![
            (130, 86, 8, 16, [255, 255, 255]),
            (145, 86, 8, 16, [255, 255, 255]),
            (160, 86, 8, 16, [255, 255, 255]),
            // a wide bright plate edge (drops by width) and a dim title line below (drops by threshold)
            (115, 82, 120, 3, [255, 255, 255]),
            (130, 105, 60, 4, [150, 150, 160]),
        ];
        let (data, w, h, l) = frame_with(&[(100.0, letters)], 50.0);
        let n = name_of(
            &Frame {
                data: &data,
                width: w,
                height: h,
            },
            &l,
            0,
        )
        .expect("name");
        // x starts at the first letter, not at the plate edge
        assert_eq!(n.rect[0], 130, "rect {:?}", n.rect);
        assert!(n.rect[2] <= 38 && n.rect[3] <= 20, "rect {:?}", n.rect);
        assert!((n.feat.iter().map(|v| v * v).sum::<f32>() - 1.0).abs() < 1e-4);
    }

    #[test]
    fn no_text_means_no_name() {
        let (data, w, h, l) = frame_with(&[(100.0, vec![])], 50.0);
        assert!(
            name_of(
                &Frame {
                    data: &data,
                    width: w,
                    height: h
                },
                &l,
                0
            )
            .is_none()
        );
    }

    #[test]
    fn a_different_name_scores_lower() {
        let a = vec![
            (130, 86, 8, 16, [255, 255, 255]),
            (145, 86, 8, 16, [255, 255, 255]),
            (160, 86, 8, 16, [255, 255, 255]),
        ];
        let b = vec![
            (130, 86, 4, 16, [255, 255, 255]),
            (150, 86, 12, 16, [255, 255, 255]),
        ];
        let (d1, w1, h1, l1) = frame_with(&[(100.0, a)], 50.0);
        let (d2, w2, h2, l2) = frame_with(&[(100.0, b)], 50.0);
        let n1 = name_of(
            &Frame {
                data: &d1,
                width: w1,
                height: h1,
            },
            &l1,
            0,
        )
        .unwrap();
        let n2 = name_of(
            &Frame {
                data: &d2,
                width: w2,
                height: h2,
            },
            &l2,
            0,
        )
        .unwrap();
        assert!(similarity(&n1.feat, &n1.feat) > 0.99);
        assert!(similarity(&n1.feat, &n2.feat) < NAME_MIN);
    }
}
