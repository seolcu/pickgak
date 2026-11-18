//! For dead-player rows with a known hero, prints the masked match per method and disc radius:
//! method, radius, truth, top label, top score, lead over the second.
//!
//! cargo run --release -p pickgak-vision --example dead_probe -- <cases file: image row truth> <image dir>

use pickgak_vision::{Frame, detect_scoreboard, portrait_samples, seeds};

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let cases = std::fs::read_to_string(&a[1]).expect("cases");
    for line in cases.lines() {
        let p: Vec<&str> = line.split_whitespace().collect();
        let (file, row, truth) = (p[0], p[1].parse::<usize>().unwrap(), p[2]);
        let path = format!("{}/{file}.jpg", a[2]);
        let Ok(img) = image::open(&path) else {
            continue;
        };
        let img = img.to_rgba8();
        let (w, h) = img.dimensions();
        let data = img.into_raw();
        let f = Frame {
            data: &data,
            width: w as usize,
            height: h as usize,
        };
        let Some(l) = detect_scoreboard(&f) else {
            continue;
        };
        if row >= l.rows.len() {
            continue;
        }
        let samples = portrait_samples(&f, &l, row);
        let bg = seeds::row_background(&f, &l, row);
        for outer in [false, true] {
            for r in [0.35f32, 0.40, 0.45, 0.50] {
                let mut s = seeds::masked_scores_with(&samples, bg, r, outer);
                s.sort_by(|a, b| b.1.total_cmp(&a.1));
                println!(
                    "{file} {row} {} {r:.2} {truth} {} {:.3} {:.3}",
                    if outer { "outer" } else { "fill" },
                    s[0].0,
                    s[0].1,
                    s[0].1 - s[1].1
                );
            }
        }
    }
}
