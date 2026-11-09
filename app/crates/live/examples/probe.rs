//! Diagnostic: run while the game is open, press and hold TAB a few times, Ctrl+C to stop.
//! Prints whether TAB was seen, how long the window grab took, and whether the frame is a scoreboard.
//! Saves each capture as probe_NNN.png next to where it runs.
use pickgak_vision::{Frame, detect_scoreboard, me_row};
use std::time::Instant;

fn main() {
    let rx = pickgak_live::start().expect("X11 connection (run inside the desktop session)");
    println!(
        "watching TAB (hold it for {} ms)",
        pickgak_live::HOLD.as_millis()
    );
    let mut n = 0;
    for ev in rx {
        match ev {
            pickgak_live::LiveEvent::Capture {
                rgba,
                width,
                height,
                grab,
                window,
            } => {
                n += 1;
                let t0 = Instant::now();
                let f = Frame {
                    data: &rgba,
                    width,
                    height,
                };
                let layout = detect_scoreboard(&f);
                let me = layout.as_ref().and_then(|l| me_row(&f, l));
                let left = layout.as_ref().map(|l| (l.rows.len(), l.row_h as u32));
                let detect = t0.elapsed();
                let mean: u64 = rgba.iter().step_by(4 * 97).map(|v| *v as u64).sum::<u64>()
                    / (rgba.len() / (4 * 97)).max(1) as u64;
                let path = format!("probe_{n:03}.png");
                image::save_buffer(
                    &path,
                    &rgba,
                    width as u32,
                    height as u32,
                    image::ColorType::Rgba8,
                )
                .ok();
                println!(
                    "capture {width}x{height} from [{window}] grab={}ms detect={}ms scoreboard(rows,row_h)={:?} me={:?} mean_red={mean} -> {path}",
                    grab.as_millis(),
                    detect.as_millis(),
                    left,
                    me
                );
            }
            pickgak_live::LiveEvent::CaptureFailed { why, focus } => match focus {
                Some(window) => println!("capture failed: {why} (focus: {window})"),
                None => println!("capture failed: {why}"),
            },
            pickgak_live::LiveEvent::Tab(down) => {
                println!("tab {}", if down { "down" } else { "up" })
            }
            pickgak_live::LiveEvent::TabIgnored { reason, window } => match window {
                Some(window) => println!("tab ignored ({reason:?}: {window})"),
                None => println!("tab ignored ({reason:?})"),
            },
        }
    }
}
