//! Tesseract OCR of the map name and of party name lines. It only ever suggests: map text and names are
//! matched against closed vocabularies (the map list, the Players tab), and a weak or ambiguous reading
//! is no answer at all.
//!
//! Tesseract runs as a child process on an in-memory PNG: no temp files and no user-controlled
//! arguments. One thread, below-normal priority and a short timeout keep it from competing with the game.

use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use pickgak_vision::{Frame, Layout, Team};
use tauri::{AppHandle, Manager};
use wait_timeout::ChildExt;

use crate::live::{MapRef, PlayerRef};

/// A Tesseract run longer than this is killed (a normal one takes 100-300 ms on one thread).
const TIMEOUT: Duration = Duration::from_secs(2);

/// The Tesseract binary and its data directory. `bundled` is only for the debug view: the same command
/// line is used for the host and the bundled runtime.
#[derive(Clone)]
pub struct Runtime {
    bin: PathBuf,
    tessdata: Option<PathBuf>,
    pub bundled: bool,
}

/// Luminance crop, sent to the OCR worker so the capture thread never runs Tesseract.
#[derive(Clone)]
pub struct Band {
    data: Vec<u8>,
    width: usize,
    height: usize,
}

/// The bundled Tesseract lives in the app's resource dir; the host PATH is only a fallback. The env
/// overrides are for tests and for running an unpacked build.
fn path_runtime() -> Runtime {
    Runtime {
        bin: std::env::var_os("PICKGAK_TESSERACT")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("tesseract")),
        tessdata: std::env::var_os("PICKGAK_TESSDATA")
            .map(PathBuf::from)
            .filter(|p| p.is_dir()),
        bundled: false,
    }
}

/// Linux packages can be read-only and the AppImage mount can be noexec. Copy the static binary into
/// the app cache once and execute it from there; the tessdata stays next to the package.
#[cfg(target_os = "linux")]
fn bundled_linux_bin(app: &AppHandle, src: PathBuf) -> PathBuf {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    let Ok(cache) = app.path().app_cache_dir() else {
        return src;
    };
    let dir = cache.join("ocr");
    let dst = dir.join("tesseract");
    let same = fs::metadata(&dst)
        .ok()
        .zip(fs::metadata(&src).ok())
        .is_some_and(|(a, b)| a.len() == b.len());
    if !same
        && fs::create_dir_all(&dir).is_ok()
        && fs::copy(&src, &dst).is_ok()
        && fs::set_permissions(&dst, fs::Permissions::from_mode(0o755)).is_ok()
    {
        return dst;
    }
    if dst.is_file() { dst } else { src }
}

fn resolve(resource_dir: Option<&Path>) -> Option<Runtime> {
    if let Some(dir) = resource_dir {
        #[cfg(target_os = "linux")]
        let bundled = {
            let dir = dir.join("ocr-linux");
            (dir.join("tesseract").is_file()).then(|| Runtime {
                bin: dir.join("tesseract"),
                tessdata: Some(dir.join("tessdata")).filter(|p| p.is_dir()),
                bundled: true,
            })
        };
        #[cfg(target_os = "windows")]
        let bundled = {
            let dir = dir.join("tesseract");
            (dir.join("tesseract.exe").is_file()).then(|| Runtime {
                bin: dir.join("tesseract.exe"),
                tessdata: Some(dir.join("tessdata")).filter(|p| p.is_dir()),
                bundled: true,
            })
        };
        #[cfg(not(any(target_os = "linux", target_os = "windows")))]
        let bundled: Option<Runtime> = None;
        if let Some(rt) = bundled
            && available(&rt)
        {
            return Some(rt);
        }
    }
    let rt = path_runtime();
    available(&rt).then_some(rt)
}

/// The Tesseract to use, or None when no Tesseract with Korean and English data exists.
pub fn runtime(app: &AppHandle) -> Option<Runtime> {
    // an explicit test/runtime override wins over the bundle
    if std::env::var_os("PICKGAK_TESSERACT").is_some() {
        let rt = path_runtime();
        if available(&rt) {
            return Some(rt);
        }
    }
    #[allow(unused_mut)]
    let mut rt = resolve(app.path().resource_dir().ok().as_deref())?;
    #[cfg(target_os = "linux")]
    if rt.bundled {
        rt.bin = bundled_linux_bin(app, rt.bin);
    }
    Some(rt)
}

fn command(rt: &Runtime) -> Command {
    let mut cmd = Command::new(&rt.bin);
    cmd.env("OMP_THREAD_LIMIT", "1").env("OMP_NUM_THREADS", "1");
    if let Some(d) = &rt.tessdata {
        cmd.env("TESSDATA_PREFIX", d);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS
        cmd.creation_flags(0x0800_0000 | 0x0000_4000);
    }
    cmd
}

/// Is this Tesseract usable with Korean + English data?
fn available(rt: &Runtime) -> bool {
    command(rt)
        .arg("--list-langs")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| {
            let s = String::from_utf8_lossy(&o.stdout);
            s.lines().any(|l| l.trim() == "kor") && s.lines().any(|l| l.trim() == "eng")
        })
        .unwrap_or(false)
}

/// Runs Tesseract on an in-memory PNG. The child inherits the worker's nice value on Linux. The PNG is
/// written from its own thread: a child that stops reading would otherwise block the write forever,
/// before the timeout could start.
fn run(rt: &Runtime, png: Vec<u8>) -> Option<String> {
    let mut child = command(rt)
        .args(["stdin", "stdout", "-l", "kor+eng", "--psm", "7"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdin = child.stdin.take()?;
    let writer = std::thread::spawn(move || stdin.write_all(&png).is_ok());
    let status = match child.wait_timeout(TIMEOUT).ok()? {
        Some(status) => status,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = writer.join();
            return None;
        }
    };
    if !writer.join().unwrap_or(false) {
        return None;
    }
    let mut out = String::new();
    child.stdout.take()?.read_to_string(&mut out).ok()?;
    status.success().then_some(out)
}

/// Luminance of the frame inside [x0, x1) x [y0, y1), clamped to the frame.
fn luma_band(f: &Frame, x0: usize, y0: usize, x1: usize, y1: usize) -> Option<Band> {
    let (x1, y1) = (x1.min(f.width), y1.min(f.height));
    let (width, height) = (x1.saturating_sub(x0), y1.saturating_sub(y0));
    let mut data = Vec::with_capacity(width * height);
    for y in y0..y1 {
        for x in x0..x1 {
            let i = (y * f.width + x) * 4;
            let (r, g, b) = (f.data[i] as u32, f.data[i + 1] as u32, f.data[i + 2] as u32);
            data.push(((299 * r + 587 * g + 114 * b) / 1000) as u8);
        }
    }
    Some(Band {
        data,
        width,
        height,
    })
}

/// The "mode | map" block at the top right (`MapText::full`), for the OCR worker.
pub fn map_band(f: &Frame, rect: [usize; 4]) -> Option<Band> {
    let pad = 2;
    let band = luma_band(
        f,
        rect[0].saturating_sub(pad),
        rect[1].saturating_sub(pad),
        rect[0] + rect[2] + pad,
        rect[1] + rect[3] + pad,
    )?;
    (band.width >= 6 && band.height >= 4).then_some(band)
}

/// The name line of a scoreboard row, for the OCR worker.
pub fn name_band(f: &Frame, l: &Layout, row: usize) -> Option<Band> {
    let r = l.rows.get(row)?;
    let rh = l.row_h;
    let xoff = match r.team {
        Team::Ally => 1.9,
        Team::Enemy => 1.5,
    };
    let top = (r.y - 0.36 * rh).max(0.0) as usize;
    let band = luma_band(
        f,
        (l.left as f32 + xoff * rh).max(0.0) as usize,
        top,
        (l.left as f32 + 5.0 * rh) as usize,
        (r.y + NAME_MAX_BELOW * rh) as usize,
    )?;
    // The bottom follows the glyphs: a name with a title sits high and ends near r.y + 0.08 rh, a name
    // without one is centred and reaches about r.y + 0.12 rh (names_untitled_2560.jpg).
    let min_rows = ((r.y + 0.08 * rh) as usize)
        .saturating_sub(top)
        .min(band.height);
    let mut height = min_rows;
    while height < band.height && name_line_row(&band, height) {
        height += 1;
    }
    let band = Band {
        data: band.data[..height * band.width].to_vec(),
        width: band.width,
        height,
    };
    (band.width >= 8 && band.height >= 6).then_some(band)
}

/// How far below the row centre a name line may reach (a centred name ends near 0.12 rh).
const NAME_MAX_BELOW: f32 = 0.30;
/// A band row belongs to the name line while it has this many pure white pixels (luma >= 200).
/// Measured at 2560x1440 (names_2560.jpg, names_untitled_2560.jpg): name glyph rows have 21 to 167
/// such pixels down to their last line; the title line under a name and the level ring left of it
/// have 0 to 1 (they peak at luma 186 to 201).
const NAME_LINE_MIN_WHITE: usize = 5;

fn name_line_row(band: &Band, y: usize) -> bool {
    let row = &band.data[y * band.width..(y + 1) * band.width];
    row.iter().filter(|&&v| v >= 200).count() >= NAME_LINE_MIN_WHITE
}

/// Nearest upscale and a hard white strip on the left, then PNG. The strip is not decoration:
/// Tesseract's line finder needs this margin on a white-on-black image. Without it the same name crop
/// read as Latin gibberish.
fn to_png(img: &image::GrayImage, scale: u32) -> Option<Vec<u8>> {
    const MARGIN: u32 = 5;
    let big = image::imageops::resize(
        img,
        img.width() * scale,
        img.height() * scale,
        image::imageops::FilterType::Nearest,
    );
    let mut padded =
        image::GrayImage::from_pixel(big.width() + MARGIN, big.height(), image::Luma([0]));
    image::imageops::replace(&mut padded, &big, MARGIN as i64, 0);
    for y in 0..padded.height() {
        for x in 0..MARGIN {
            padded.put_pixel(x, y, image::Luma([255]));
        }
    }
    let mut png = Cursor::new(Vec::new());
    padded.write_to(&mut png, image::ImageFormat::Png).ok()?;
    Some(png.into_inner())
}

/// Map text: no italic shear, a plain threshold and an 8x upscale.
fn map_image(band: &Band, threshold: u8) -> Option<Vec<u8>> {
    let img = image::GrayImage::from_fn(band.width as u32, band.height as u32, |x, y| {
        let v = band.data[y as usize * band.width + x as usize];
        image::Luma([if v >= threshold { 255 } else { 0 }])
    });
    to_png(&img, 8)
}

/// Name line: threshold, then counter-shear with cubic sampling. The game font leans right; sampling a
/// little to the left at the bottom straightens it. Tesseract read the bright glyphs as white on black
/// on the real capture; the opposite produced garbage.
fn name_image(band: &Band, shear: f32) -> Option<Vec<u8>> {
    let (w, h) = (band.width, band.height);
    let glyph = |x: i32, y: usize| -> f32 {
        if x < 0 || x >= w as i32 || band.data[y * w + x as usize] < 150 {
            0.0
        } else {
            255.0
        }
    };
    let cubic = |p0: f32, p1: f32, p2: f32, p3: f32, t: f32| -> f32 {
        0.5 * (2.0 * p1
            + (-p0 + p2) * t
            + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t * t
            + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t * t * t)
    };
    let img = image::GrayImage::from_fn(w as u32, h as u32, |x, y| {
        let sx = x as f32 - shear * y as f32;
        let x0 = sx.floor() as i32;
        let y = y as usize;
        let v = cubic(
            glyph(x0 - 1, y),
            glyph(x0, y),
            glyph(x0 + 1, y),
            glyph(x0 + 2, y),
            sx - x0 as f32,
        );
        image::Luma([v.clamp(0.0, 255.0) as u8])
    });
    to_png(&img, 5)
}

/// Runs each image through Tesseract until `enough` says stop. Returns the distinct cleaned texts and
/// the time spent.
fn texts_of(
    rt: &Runtime,
    images: impl Iterator<Item = Option<Vec<u8>>>,
    enough: impl Fn(&[String]) -> bool,
) -> (Vec<String>, u64) {
    let t0 = Instant::now();
    let mut out: Vec<String> = Vec::new();
    for png in images {
        if let Some(text) = png.and_then(|png| run(rt, png)) {
            let t = clean(&text);
            if !t.is_empty() && !out.contains(&t) {
                out.push(t);
            }
        }
        if enough(&out) {
            break;
        }
    }
    (out, t0.elapsed().as_millis() as u64)
}

/// Map text at two thresholds. The full mode|map block gives Tesseract context that the map name alone
/// lacks (Colosseo read as 콜로세오 from the full block, as 골로세오 from the map name alone).
pub fn map_texts(rt: &Runtime, band: &Band) -> (Vec<String>, u64) {
    texts_of(rt, [110u8, 130].iter().map(|&t| map_image(band, t)), |_| {
        false
    })
}

/// Name line at two shears. The stronger one only runs when the first reading does not clearly name one
/// registered player, which keeps the common case to one Tesseract process.
pub fn name_texts(rt: &Runtime, band: &Band, players: &[PlayerRef]) -> (Vec<String>, u64) {
    texts_of(
        rt,
        [0.10f32, 0.20].iter().map(|&s| name_image(band, s)),
        |out| {
            let scores = name_scores(out, players);
            !players.is_empty()
                && scores.first().is_some_and(|(_, s)| {
                    *s >= 0.80 && scores.get(1).is_none_or(|(_, s2)| *s - *s2 >= 0.15)
                })
        },
    )
}

/// Letters and digits only (lowercase ASCII, Hangul syllables), at most 40.
fn clean(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_ascii_alphanumeric() || ('\u{ac00}'..='\u{d7a3}').contains(c))
        .map(|c| c.to_ascii_lowercase())
        .take(40)
        .collect()
}

const CHO: [char; 19] = [
    'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ',
    'ㅌ', 'ㅍ', 'ㅎ',
];
const JUNG: [char; 21] = [
    'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ',
    'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ',
];
const JONG: [char; 28] = [
    '\0', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ',
    'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];

/// Hangul syllables as jamo, so an OCR miss on one stroke still compares to the right name.
fn jamo(s: &str) -> Vec<char> {
    let mut out = Vec::new();
    for c in s.chars() {
        let o = c as u32;
        if (0xAC00..=0xD7A3).contains(&o) {
            let i = (o - 0xAC00) as usize;
            out.push(CHO[i / 588]);
            out.push(JUNG[(i % 588) / 28]);
            let jong = JONG[i % 28];
            if jong != '\0' {
                out.push(jong);
            }
        } else {
            out.push(c.to_ascii_lowercase());
        }
    }
    out
}

fn lev(a: &[char], b: &[char]) -> usize {
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut cur = Vec::with_capacity(b.len() + 1);
        cur.push(i + 1);
        for (j, cb) in b.iter().enumerate() {
            let sub = prev[j] + usize::from(ca != cb);
            cur.push(sub.min(prev[j + 1] + 1).min(cur[j] + 1));
        }
        prev = cur;
    }
    prev[b.len()]
}

/// 1 - normalized edit distance over jamo, of the cleaned texts.
fn text_ratio(a: &str, b: &str) -> f32 {
    let a = jamo(&clean(a));
    let b = jamo(&clean(b));
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    1.0 - lev(&a, &b) as f32 / a.len().max(b.len()) as f32
}

/// OCR text of a full "mode | map" block -> map name similarity. The map name is the suffix after the
/// mode; the mode is only context for Tesseract.
fn map_ratio(text: &str, name: &str) -> f32 {
    let (t, n) = (clean(text), clean(name));
    if t.is_empty() || n.is_empty() {
        return 0.0;
    }
    if t.ends_with(&n) {
        return 1.0;
    }
    let tail: String = t
        .chars()
        .skip(t.chars().count().saturating_sub(n.chars().count()))
        .collect();
    text_ratio(&tail, &n)
}

/// OCR texts -> map id. A high bar and a clear lead over the runner-up: a wrong map is worse than none.
/// The whole name read exactly is enough on its own, unless another name is read exactly too.
pub fn best_map(texts: &[String], maps: &[MapRef]) -> Option<String> {
    let mut scores: Vec<(&str, f32)> = maps
        .iter()
        .map(|m| {
            let best = texts
                .iter()
                .map(|t| map_ratio(t, &m.name))
                .fold(0.0f32, f32::max);
            (m.id.as_str(), best)
        })
        .collect();
    scores.sort_by(|a, b| b.1.total_cmp(&a.1));
    match scores.as_slice() {
        [(id, score), rest @ ..]
            if *score >= 0.60
                && rest
                    .first()
                    .is_none_or(|(_, s2)| *score - *s2 >= 0.15 || (*score >= 1.0 && *s2 < 1.0)) =>
        {
            Some(id.to_string())
        }
        _ => None,
    }
}

/// Best OCR similarity per registered, non-me player over all of their nicknames (alts included),
/// highest first (0.40 and up).
pub fn name_scores(texts: &[String], players: &[PlayerRef]) -> Vec<(i64, f32)> {
    let mut out: Vec<(i64, f32)> = players
        .iter()
        .filter(|p| !p.me)
        .map(|p| {
            let best = texts
                .iter()
                .flat_map(|t| p.names().map(move |n| text_ratio(t, n)))
                .fold(0.0f32, f32::max);
            (p.id, best)
        })
        .filter(|(_, s)| *s >= 0.40)
        .collect();
    out.sort_by(|a, b| b.1.total_cmp(&a.1));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use pickgak_vision::detect_scoreboard;
    use pickgak_vision::maptext::map_text;

    fn tesseract() -> Option<Runtime> {
        let rt = path_runtime();
        if available(&rt) {
            Some(rt)
        } else {
            eprintln!("skipped: tesseract with kor+eng is not installed");
            None
        }
    }

    /// The captures are real matches with players' names on them, so they live in the private
    /// `pickgak-fixtures` submodule; without it the tests that need them pass as skipped.
    fn fixture(name: &str) -> Option<image::RgbaImage> {
        let path = format!(
            "{}/../crates/vision/tests/fixtures/{name}",
            env!("CARGO_MANIFEST_DIR")
        );
        if !std::path::Path::new(&path).exists() {
            eprintln!("skipped: {name} is not checked out (private submodule)");
            return None;
        }
        Some(image::open(path).expect("fixture").to_rgba8())
    }

    fn maps(list: &[(&str, &str)]) -> Vec<MapRef> {
        list.iter()
            .map(|(id, name)| MapRef {
                id: id.to_string(),
                name: name.to_string(),
            })
            .collect()
    }

    /// The Korean map list as the UI sends it (GET /api/maps?lang=ko, 2026-10-28). Every OCR test matches against all of it, not against a
    /// hand-picked pair, so a near name elsewhere in the list would show up here.
    const KO_MAPS: &[(&str, &str)] = &[
        ("antarctic-peninsula", "남극 반도"),
        ("nepal", "네팔"),
        ("lijiang-tower", "리장 타워"),
        ("busan", "부산"),
        ("samoa", "사모아"),
        ("oasis", "오아시스"),
        ("ilios", "일리오스"),
        ("route-66", "66번 국도"),
        ("watchpoint-gibraltar", "감시 기지: 지브롤터"),
        ("grimsvotn", "그림스뵈튼"),
        ("dorado", "도라도"),
        ("rialto", "리알토"),
        ("shambali-monastery", "샴발리 수도원"),
        ("circuit-royal", "서킷 로얄"),
        ("junkertown", "쓰레기촌"),
        ("havana", "하바나"),
        ("new-junk-city", "뉴 정크 시티"),
        ("suravasa", "수라바사"),
        ("aatlis", "아틀리스"),
        ("neon-junction", "네온 교차로"),
        ("numbani", "눔바니"),
        ("midtown", "미드타운"),
        ("blizzard-world", "블리자드 월드"),
        ("eichenwalde", "아이헨발데"),
        ("kings-row", "왕의 길"),
        ("paraiso", "파라이수"),
        ("hollywood", "할리우드"),
        ("new-queen-street", "뉴 퀸 스트리트"),
        ("runasapi", "루나사피"),
        ("esperanca", "이스페란사"),
        ("colosseo", "콜로세오"),
    ];

    #[test]
    fn map_ratio_reads_the_suffix_after_the_mode() {
        assert_eq!(map_ratio("밀기콜로세오", "콜로세오"), 1.0);
        assert!(map_ratio("밀기골로세오", "콜로세오") >= 0.85);
        assert!(map_ratio("밀기콜로세오", "쓰레기촌") < 0.4);
    }

    #[test]
    fn a_close_runner_up_is_no_answer() {
        let list = maps(&[("a", "가나다라"), ("b", "가나다마")]);
        assert_eq!(best_map(&["가나다바".into()], &list), None);
        assert_eq!(best_map(&["가나다라".into()], &list).as_deref(), Some("a"));
    }

    #[test]
    fn an_alt_nickname_names_the_same_player() {
        let players = [
            PlayerRef {
                id: 1,
                name: "본계닉네임".into(),
                aliases: vec!["SMURFKING".into()],
                me: false,
            },
            PlayerRef {
                id: 2,
                name: "다른사람".into(),
                aliases: Vec::new(),
                me: false,
            },
        ];
        let top = |t: &str| name_scores(&[t.into()], &players).first().copied();
        assert_eq!(top("SMURFKING"), Some((1, 1.0)));
        assert_eq!(top("본계닉네임"), Some((1, 1.0)));
        assert_eq!(top("다른사람").map(|t| t.0), Some(2));
    }

    fn read_map(img: &image::RgbaImage, rect: Option<[usize; 4]>) -> Option<String> {
        let rt = tesseract()?;
        let (w, h) = img.dimensions();
        let f = Frame {
            data: img.as_raw(),
            width: w as usize,
            height: h as usize,
        };
        let rect = rect.unwrap_or([0, 0, w as usize, h as usize]);
        let (texts, _) = map_texts(&rt, &map_band(&f, rect).expect("map band"));
        let best = best_map(&texts, &maps(KO_MAPS));
        eprintln!("OCR {texts:?} -> {best:?}");
        Some(best.unwrap_or_default())
    }

    #[test]
    fn reads_colosseo_not_junkertown() {
        let Some(img) = fixture("map_colosseo.png") else {
            return;
        };
        if let Some(id) = read_map(&img, None) {
            assert_eq!(id, "colosseo");
        }
    }

    #[test]
    fn reads_kings_row_not_grimsvotn() {
        let Some(img) = fixture("map_kings_row.png") else {
            return;
        };
        if let Some(id) = read_map(&img, None) {
            assert_eq!(id, "kings-row");
        }
    }

    /// The whole pipeline on a real capture: find the text, crop the full block, OCR, match.
    #[test]
    fn reads_the_map_from_a_full_capture() {
        let Some(img) = fixture("names_2560.jpg") else {
            return;
        };
        let (w, h) = img.dimensions();
        let f = Frame {
            data: img.as_raw(),
            width: w as usize,
            height: h as usize,
        };
        let text = map_text(&f).expect("map text");
        if let Some(id) = read_map(&img, Some(text.full)) {
            assert_eq!(id, "samoa");
        }
    }

    /// Real 2560x1440 capture (Dorado, 2026-10-30). A name without a title is centred in its row, lower
    /// than a titled one; the band must still hold the whole glyph line. Row 2's bottom half was cut
    /// before. (Tesseract still cannot read this Latin font, so that row is identified by teaching it
    /// once.)
    #[test]
    fn name_band_holds_an_untitled_name() {
        let Some(img) = fixture("names_untitled_2560.jpg") else {
            return;
        };
        let (w, h) = img.dimensions();
        let f = Frame {
            data: img.as_raw(),
            width: w as usize,
            height: h as usize,
        };
        let l = detect_scoreboard(&f).expect("scoreboard");
        let titled = name_band(&f, &l, 1).expect("titled band");
        let untitled = name_band(&f, &l, 2).expect("untitled band");
        // the band stops right after the glyph line, before the cap
        let cap = ((0.36 + NAME_MAX_BELOW) * l.row_h) as usize;
        for band in [&titled, &untitled] {
            assert!(band.height < cap, "{}", band.height);
        }
        // the untitled name reaches lower, to about r.y + 0.12 rh
        assert!(
            untitled.height as f32 >= (0.36 + 0.11) * l.row_h,
            "untitled {} titled {}",
            untitled.height,
            titled.height
        );
        assert!(untitled.height > titled.height);
    }

    /// Real 2560x1440 app capture. The OCR is only a suggestion, but it should at least rank the right
    /// registered name first; the user still confirms.
    #[test]
    fn suggests_the_right_registered_name() {
        let Some(rt) = tesseract() else { return };
        let Some(img) = fixture("names_2560.jpg") else {
            return;
        };
        let (w, h) = img.dimensions();
        let f = Frame {
            data: img.as_raw(),
            width: w as usize,
            height: h as usize,
        };
        let l = detect_scoreboard(&f).expect("scoreboard");
        // The players' names on that capture, one per row, top to bottom; kept next to it in the private
        // submodule.
        let list = std::fs::read_to_string(format!(
            "{}/../crates/vision/tests/fixtures/names_2560.txt",
            env!("CARGO_MANIFEST_DIR")
        ))
        .expect("names_2560.txt");
        let names: Vec<&str> = list.lines().collect();
        let players: Vec<PlayerRef> = names
            .iter()
            .enumerate()
            .map(|(i, name)| PlayerRef {
                id: i as i64 + 1,
                name: name.to_string(),
                aliases: Vec::new(),
                me: false,
            })
            .collect();
        for (i, want) in names.iter().enumerate() {
            let band = name_band(&f, &l, i).expect("name band");
            let (texts, _) = name_texts(&rt, &band, &[]);
            let top = name_scores(&texts, &players)
                .first()
                .map(|&(id, score)| (names[id as usize - 1], score));
            assert_eq!(
                top.map(|t| t.0),
                Some(*want),
                "row {i}: OCR {texts:?} ranked {top:?}"
            );
            // Row 5 is a decorated enemy nameplate; it ranks first but its score is low. Party
            // rows (and normal names) clear the question bar.
            if i != 5 {
                assert!(
                    top.is_some_and(|t| t.1 >= 0.55),
                    "row {i}: weak OCR {top:?}"
                );
            }
        }
    }
}
