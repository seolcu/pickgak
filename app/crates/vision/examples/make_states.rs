//! Writes src/states.bin: built-in templates for portrait states that aren't heroes, cut from the test
//! fixtures with the same pipeline the app uses: "?" (hero not seen yet) and the skull (dead) on an ally and an enemy row, and
//! an empty practice-range row waiting for a player.
//!
//! cargo run -p pickgak-vision --example make_states

use pickgak_vision::{Frame, detect_scoreboard, inner_box, portrait_box, sample};

fn main() {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures");
    let states = [
        ("__unknown__", "f_313.jpg", 3),
        ("__unknown__", "f_313.jpg", 5),
        ("__empty__", "range_2560.jpg", 1),
        ("__dead__", "comp_dead_2560.jpg", 1),
        ("__dead__", "comp_dead_2560.jpg", 7),
    ];
    let mut out = b"PGS1".to_vec();
    out.extend((states.len() as u16).to_le_bytes());
    for (label, file, row) in states {
        let img = image::open(format!("{dir}/{file}")).expect(file).to_rgba8();
        let (w, h) = img.dimensions();
        let data = img.into_raw();
        let f = Frame {
            data: &data,
            width: w as usize,
            height: h as usize,
        };
        let l = detect_scoreboard(&f).expect("scoreboard");
        let rgb = sample(&f, inner_box(portrait_box(&l, row)));
        out.push(label.len() as u8);
        out.extend(label.as_bytes());
        for p in rgb.as_chunks::<3>().0 {
            out.extend([
                p[0].round() as u8,
                p[1].round() as u8,
                p[2].round() as u8,
                255,
            ]);
        }
    }
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/src/states.bin");
    std::fs::write(path, &out).expect("write");
    println!("{} states -> {path}", states.len());
}
