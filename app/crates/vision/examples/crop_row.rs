//! Saves the portrait box the reader uses for one row, scaled up: crop_row <image> <row> <out.png>

use pickgak_vision::{Frame, detect_scoreboard, portrait_box};

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let img = image::open(&a[1]).expect("image").to_rgba8();
    let row: usize = a[2].parse().expect("row");
    let (w, h) = img.dimensions();
    let data = img.clone().into_raw();
    let f = Frame {
        data: &data,
        width: w as usize,
        height: h as usize,
    };
    let l = detect_scoreboard(&f).expect("scoreboard");
    let b = portrait_box(&l, row);
    let pad = b.w * 0.3;
    let (x, y) = ((b.x - pad).max(0.0) as u32, (b.y - pad).max(0.0) as u32);
    let crop = image::imageops::crop_imm(
        &img,
        x,
        y,
        (b.w + 2.0 * pad) as u32,
        (b.h + 2.0 * pad) as u32,
    )
    .to_image();
    let s = 200 / crop.width().max(1) + 1;
    image::imageops::resize(
        &crop,
        crop.width() * s,
        crop.height() * s,
        image::imageops::FilterType::Nearest,
    )
    .save(&a[3])
    .expect("save");
}
