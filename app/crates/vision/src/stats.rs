//! Reads the scoreboard numbers (eliminations, assists, deaths, damage, healing, mitigation).
//!
//! The six number columns sit at fixed distances from the table's *right* edge (the end of the header
//! bar), so they stay put when perk columns appear. Digits are white; glyphs are split by empty
//! columns (and digits that touch are cut at the thinnest column), normalized to 10x14 and matched to
//! shipped templates. Commas are dropped. Cross-checked on two frames: 60/60 cells read correctly.

use crate::digits_data::DIGITS;
use crate::{Frame, Layout};

/// Column centers, measured from the table's right edge, in row heights (the whole table scales with
/// its rows: the practice range has larger rows and wider columns than a match).
const COL_OFF: [f32; 6] = [6.82, 6.05, 5.29, 4.07, 2.67, 1.29];
const COL_HALF: [f32; 6] = [0.32, 0.32, 0.32, 0.81, 0.81, 0.81];
const GW: usize = 10;
const GH: usize = 14;

/// Per-player numbers, one entry per layout row. `None` when a cell couldn't be read.
pub type Stats = Vec<[Option<u32>; 6]>;

pub const COLUMNS: [&str; 6] = [
    "eliminations",
    "assists",
    "deaths",
    "damage",
    "healing",
    "mitigation",
];

struct Mask {
    w: usize,
    h: usize,
    bits: Vec<bool>,
}

impl Mask {
    fn at(&self, x: usize, y: usize) -> bool {
        self.bits[y * self.w + x]
    }
    fn sub(&self, x0: usize, x1: usize) -> Mask {
        // columns x0..x1, cropped to rows that have ink
        let rows: Vec<usize> = (0..self.h)
            .filter(|&y| (x0..x1).any(|x| self.at(x, y)))
            .collect();
        let (y0, y1) = match (rows.first(), rows.last()) {
            (Some(a), Some(b)) => (*a, *b + 1),
            _ => (0, 0),
        };
        let w = x1 - x0;
        let bits = (y0..y1)
            .flat_map(|y| (x0..x1).map(move |x| (x, y)))
            .map(|(x, y)| self.at(x, y))
            .collect();
        Mask {
            w,
            h: y1 - y0,
            bits,
        }
    }
    fn col_count(&self, x: usize) -> usize {
        (0..self.h).filter(|&y| self.at(x, y)).count()
    }
}

fn cell_mask(f: &Frame, cx: f32, half: f32, cy: f32, half_h: f32) -> Mask {
    let (x0, x1) = (
        (cx - half).max(0.0) as usize,
        ((cx + half) as usize).min(f.width),
    );
    let (y0, y1) = (
        (cy - half_h).max(0.0) as usize,
        ((cy + half_h) as usize).min(f.height),
    );
    let bits = (y0..y1)
        .flat_map(|y| (x0..x1).map(move |x| (x, y)))
        .map(|(x, y)| {
            let (r, g, b) = f.px(x, y);
            let (lo, hi) = (r.min(g).min(b), r.max(g).max(b));
            lo > 150 && hi - lo < 60
        })
        .collect();
    Mask {
        w: x1 - x0,
        h: y1 - y0,
        bits,
    }
}

fn glyphs(cell: &Mask) -> Vec<Mask> {
    let mut out = Vec::new();
    let mut x = 0;
    while x < cell.w {
        if cell.col_count(x) == 0 {
            x += 1;
            continue;
        }
        let x0 = x;
        while x < cell.w && cell.col_count(x) > 0 {
            x += 1;
        }
        let g = cell.sub(x0, x);
        if g.h > 0 {
            out.push(g);
        }
    }
    let hmax = out.iter().map(|g| g.h).max().unwrap_or(0);
    let out: Vec<Mask> = out
        .into_iter()
        .filter(|g| g.h as f32 > 0.6 * hmax as f32)
        .collect(); // drop commas
    let mut split = Vec::new();
    for g in out {
        let n = if g.w as f32 > 1.05 * hmax as f32 {
            ((g.w as f32 / (0.75 * hmax as f32)).round() as usize).max(1)
        } else {
            1
        };
        if n == 1 {
            split.push(g);
            continue;
        }
        // digits that touch: cut at the thinnest column near each expected boundary
        let mut cuts = Vec::new();
        let mut prev = 0;
        for k in 1..n {
            let guess = k * g.w / n;
            let span = g.w / (3 * n);
            let (lo, hi) = (
                (prev + 1).max(guess.saturating_sub(span)),
                (g.w - 1).min(guess + span),
            );
            let cut = if hi > lo {
                (lo..=hi).min_by_key(|&c| g.col_count(c)).unwrap()
            } else {
                guess
            };
            cuts.push(cut);
            prev = cut;
        }
        let bounds: Vec<usize> = std::iter::once(0)
            .chain(cuts)
            .chain(std::iter::once(g.w))
            .collect();
        for w in bounds.windows(2) {
            let part = g.sub(w[0], w[1]);
            if part.h > 0 {
                split.push(part);
            }
        }
    }
    split
}

/// Glyph -> 10x14 binary (bilinear sample, threshold), the template format.
fn normalize(g: &Mask) -> [bool; GW * GH] {
    let mut out = [false; GW * GH];
    let val = |x: f32, y: f32| -> f32 {
        let (x, y) = (
            x.clamp(0.0, (g.w - 1) as f32),
            y.clamp(0.0, (g.h - 1) as f32),
        );
        let (x0, y0) = (x.floor() as usize, y.floor() as usize);
        let (x1, y1) = ((x0 + 1).min(g.w - 1), (y0 + 1).min(g.h - 1));
        let (fx, fy) = (x - x0 as f32, y - y0 as f32);
        let v = |xx, yy| if g.at(xx, yy) { 255.0 } else { 0.0 };
        v(x0, y0) * (1.0 - fx) * (1.0 - fy)
            + v(x1, y0) * fx * (1.0 - fy)
            + v(x0, y1) * (1.0 - fx) * fy
            + v(x1, y1) * fx * fy
    };
    for ty in 0..GH {
        for tx in 0..GW {
            let sx = (tx as f32 + 0.5) * g.w as f32 / GW as f32 - 0.5;
            let sy = (ty as f32 + 0.5) * g.h as f32 / GH as f32 - 0.5;
            out[ty * GW + tx] = val(sx, sy) > 100.0;
        }
    }
    out
}

fn classify(n: &[bool; GW * GH]) -> u8 {
    DIGITS
        .iter()
        .min_by_key(|(_, t)| {
            t.bytes()
                .zip(n.iter())
                .filter(|(c, b)| (*c == b'1') != **b)
                .count()
        })
        .map(|(d, _)| *d)
        .unwrap_or(b'?')
}

/// Reads the six number cells of every row in the layout.
pub fn read_stats(f: &Frame, l: &Layout) -> Stats {
    l.rows
        .iter()
        .map(|row| {
            let mut out = [None; 6];
            for c in 0..6 {
                let cx = l.right as f32 - COL_OFF[c] * l.row_h;
                let cell = cell_mask(f, cx, COL_HALF[c] * l.row_h, row.y, 0.23 * l.row_h);
                let digits: String = glyphs(&cell)
                    .iter()
                    .map(|g| classify(&normalize(g)) as char)
                    .collect();
                out[c] = if digits.is_empty() || digits.len() > 6 {
                    None
                } else {
                    digits.parse().ok()
                };
            }
            out
        })
        .collect()
}
