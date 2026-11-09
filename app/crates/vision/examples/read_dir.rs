//! Reads every image in a folder of TAB captures and prints what the app would see: scoreboard rows,
//! my row, bans, rank range and the map text size. For regression checks against real captures.
//!
//! cargo run --release -p pickgak-vision --example read_dir -- <dir>

use pickgak_vision::{Frame, bans, maptext, rank, read};

fn labels(v: &[pickgak_vision::Match]) -> String {
    v.iter()
        .map(|m| m.label.as_deref().unwrap_or("-"))
        .collect::<Vec<_>>()
        .join(",")
}

fn main() {
    let dir = std::env::args().nth(1).expect("usage: read_dir <dir>");
    let mut paths: Vec<_> = std::fs::read_dir(&dir)
        .expect("dir")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .collect();
    paths.sort();
    for p in paths {
        let Ok(img) = image::open(&p) else { continue };
        let img = img.to_rgba8();
        let (w, h) = img.dimensions();
        let data = img.into_raw();
        let f = Frame {
            data: &data,
            width: w as usize,
            height: h as usize,
        };
        let name = p.file_stem().unwrap_or_default().to_string_lossy();
        match read(&f, &[]) {
            None => println!("{name} -"),
            Some(r) => println!(
                "{name} rows={} me={:?} bans={} ranks={} map={}",
                labels(&r.rows),
                r.me,
                labels(&bans::read_bans(&f)),
                labels(&rank::read_rank_range(&f)),
                maptext::map_text(&f)
                    .map(|t| format!("{:.1}", t.aspect))
                    .unwrap_or("-".into()),
            ),
        }
    }
}
