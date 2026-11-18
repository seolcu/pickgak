//! Reads raw RGBA frames from stdin (e.g. `ffmpeg -f rawvideo -pix_fmt rgba -`) and prints what the
//! app would read from every frame that is a scoreboard. For scanning a screen recording.
//!
//! ffmpeg ... -vf fps=2 -f rawvideo -pix_fmt rgba - | scan_raw <width> <height> <fps>

use pickgak_vision::{Frame, bans, rank, read, sane};
use std::io::Read;

fn labels(v: &[pickgak_vision::Match]) -> String {
    v.iter()
        .map(|m| m.label.as_deref().unwrap_or("-"))
        .collect::<Vec<_>>()
        .join(",")
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let (w, h): (usize, usize) = (a[1].parse().unwrap(), a[2].parse().unwrap());
    let fps: f64 = a[3].parse().unwrap();
    let mut buf = vec![0u8; w * h * 4];
    let mut stdin = std::io::stdin().lock();
    let mut i = 0u64;
    while stdin.read_exact(&mut buf).is_ok() {
        let t = i as f64 / fps;
        i += 1;
        let f = Frame {
            data: &buf,
            width: w,
            height: h,
        };
        if let Some(r) = read(&f, &[]) {
            println!(
                "{t:.1} rows={} n={} me={:?} sane={} bans={} ranks={}",
                labels(&r.rows),
                r.layout.rows.len(),
                r.me,
                sane(&r),
                labels(&bans::read_bans(&f)),
                labels(&rank::read_rank_range(&f)),
            );
        }
    }
    eprintln!("frames={i}");
}
