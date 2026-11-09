//! TAB capture -> scoreboard reading -> events for the UI. Teach-once hero templates live in the
//! app data dir. Nothing here touches the game process: we observe the keyboard and copy pixels.

use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use pickgak_live::{FocusReason, LiveEvent};
use pickgak_vision::maptext::{MAP_MIN, MapText, map_text, match_map, similarity};
use pickgak_vision::nameplate::{self, Name, SUGGEST_MIN};
use pickgak_vision::{
    Frame, Layout, Team, Template, detect_scoreboard, inner_box, me_row, portrait_box,
    portrait_samples, recognize, sane, seeds,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::ocr;

const KEEP_IN_MEMORY: usize = 20;
const KEEP_ON_DISK: usize = 100;
/// Holding TAB repeats captures; one that reads the same as the last saved one is kept on disk only
/// after this long.
const SAVE_SAME_AFTER_MS: u64 = 20_000;

#[derive(Serialize, Deserialize, Clone)]
struct StoredTemplate {
    label: String,
    feat: Vec<f32>,
}

#[derive(Serialize, Deserialize, Clone)]
struct StoredMap {
    map: String,
    feat: Vec<f32>,
    aspect: f32,
}

/// A confirmed name image for a player (local only).
#[derive(Serialize, Deserialize, Clone)]
struct StoredName {
    id: u64,
    player: i64,
    name: String,
    feat: Vec<f32>,
}

#[derive(Serialize, Deserialize, Default)]
struct NameStore {
    #[serde(default)]
    templates: Vec<StoredName>,
}

/// A registered player, from the Players tab. `me` is the user's own profile, never a party candidate.
#[derive(Serialize, Deserialize, Clone)]
pub struct PlayerRef {
    pub id: i64,
    pub name: String,
    /// Alt account nicknames. One person can show up on the scoreboard under any of them.
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub me: bool,
}

impl PlayerRef {
    /// Every in-game nickname of this player: the name first, then the alts.
    pub fn names(&self) -> impl Iterator<Item = &str> {
        std::iter::once(self.name.as_str()).chain(self.aliases.iter().map(String::as_str))
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct MapRef {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Clone, PartialEq)]
pub struct NameCandidate {
    pub player: i64,
    pub name: String,
    pub score: f32,
}

/// What the name line of a row says. `known` means a confirmed name image matched above the automatic
/// bar; otherwise this is a question (a visual or OCR suggestion) and nothing is assigned yet.
#[derive(Serialize, Clone, PartialEq)]
pub struct NameMatch {
    pub player: i64,
    pub name: String,
    pub score: f32,
    pub known: bool,
    pub candidates: Vec<NameCandidate>,
}

#[derive(Serialize, Clone)]
pub struct Row {
    /// "ally" or "enemy"
    pub team: &'static str,
    /// Hero id, "__unknown__" ("?"), "__dead__" (skull), "__empty__" (practice-range row waiting for a
    /// player), or None when the portrait is new to us.
    pub label: Option<String>,
    pub score: f32,
    /// Small PNG of the portrait (data URL) so the UI can ask "who is this?".
    pub crop: String,
    /// Name-line reading: an automatic match after confirmation, or a question (nothing assigned).
    pub name: Option<NameMatch>,
    /// Small PNG of the name glyphs (data URL) for a party row that is not identified yet.
    pub name_crop: Option<String>,
    /// The name was compared with every registered name, OCR included, and none came close (or OCR is
    /// not available). The overlay then asks "who is this?" with the whole list instead of waiting for a
    /// suggestion that will not come. False while OCR is still pending.
    pub name_tried: bool,
}

#[derive(Serialize, Clone)]
pub struct Capture {
    pub id: u64,
    pub at: u64,
    pub width: usize,
    pub height: usize,
    pub scoreboard: bool,
    /// Map id from the text at the top right, when the user has picked this map before.
    pub map: Option<String>,
    /// Banned heroes from the competitive strip at the top left, in order (None: icon not recognized).
    /// Empty outside competitive.
    pub bans: Vec<Option<String>>,
    /// Tiers of the "match rank range" emblems (lowest first; empty in placements and outside competitive).
    pub ranks: Vec<Option<String>>,
    /// One per scoreboard row, top to bottom (my team first): 5 + 5 in a 5v5 match, 5 + 1 in the
    /// practice range, 6 + 6 in open queue.
    pub rows: Vec<Row>,
    pub me: Option<usize>,
    /// The reading has no duplicate hero inside a team (a mid-animation frame does).
    pub sane: bool,
    /// Per-row numbers [elims, assists, deaths, damage, healing, mitigation]; None for unread cells.
    pub stats: Option<Vec<[Option<u32>; 6]>>,
    pub grab_ms: u64,
    pub thumb: String,
    /// What the reading was based on, for the debug view (pixels of the full capture).
    pub debug: CaptureDebug,
}

#[derive(Serialize, Clone, Default)]
pub struct CaptureDebug {
    /// The game window it came from (class | title).
    pub window: String,
    /// The whole reading (frame scan, portraits, crops, thumbnail), after the grab.
    pub process_ms: u64,
    /// Written to the captures folder (repeats that read the same are skipped for a while).
    pub saved: bool,
    /// OCR worker time for this capture (0 when no OCR was needed; the capture event is not delayed).
    pub ocr_ms: u64,
    /// Table edges and header bar: [left, header_y, right].
    pub table: Option<[usize; 3]>,
    pub row_h: f32,
    /// Portrait boxes, one per row: [x, y, w, h].
    pub portraits: Vec<[f32; 4]>,
    /// Party marker on each row (ally rows only, for the debug view and the party count).
    pub party: Vec<bool>,
    pub bans: Vec<[f32; 4]>,
    pub ranks: Vec<[f32; 4]>,
    pub map_text: Option<[usize; 4]>,
}

/// Why a TAB press didn't count, for the debug view (`reason` is translated there).
#[derive(Serialize, Clone)]
pub struct IgnoredFocus {
    /// "other" (another X window), "wayland" (no X window has focus) or "no-ewmh".
    pub reason: &'static str,
    /// "class | title" of the window that had focus, when it was an X window.
    pub window: Option<String>,
}

/// A capture that didn't happen, for the debug view.
#[derive(Serialize, Clone)]
pub struct CaptureError {
    pub why: String,
    /// The window that had focus, when the game window wasn't found.
    pub focus: Option<String>,
}

#[derive(Serialize, Clone, Default)]
pub struct Status {
    pub listening: bool,
    pub error: Option<String>,
    pub templates: usize,
    pub heroes: usize,
    /// Confirmed player name images (names.json).
    pub names: usize,
    /// A Tesseract with Korean data was found (bundled on Flatpak/Windows/Linux packages, or on PATH).
    pub ocr: bool,
    /// True when the OCR binary came from the app's resources rather than the host PATH.
    pub ocr_bundled: bool,
    /// The overlay window exists and is shown.
    pub overlay_visible: bool,
    /// The overlay is in the topmost band (Windows: WS_EX_TOPMOST).
    pub overlay_topmost: bool,
    /// The game was in Direct3D full-screen at the last TAB press (Windows), where no external window
    /// can be drawn above it.
    pub game_fullscreen: bool,
}

#[derive(Clone)]
enum OcrJob {
    Name {
        row: usize,
        feat: Vec<f32>,
        band: ocr::Band,
    },
    Map {
        text: MapText,
        band: ocr::Band,
    },
}

impl OcrJob {
    fn same_slot(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Name { row, .. }, Self::Name { row: other, .. }) => row == other,
            (Self::Map { .. }, Self::Map { .. }) => true,
            _ => false,
        }
    }
}

#[derive(Clone)]
struct OcrRequest {
    capture_id: u64,
    job: OcrJob,
}

/// One OCR worker, latest capture only. A new capture drops the older capture's pending rows so held
/// TAB does not queue a pile of work.
#[derive(Default)]
struct OcrQueue {
    queue: Mutex<VecDeque<OcrRequest>>,
    ready: Condvar,
}

impl OcrQueue {
    fn push(&self, req: OcrRequest) {
        let mut q = self.queue.lock().unwrap();
        q.retain(|r| r.capture_id == req.capture_id);
        if !q
            .iter()
            .any(|r| r.capture_id == req.capture_id && r.job.same_slot(&req.job))
        {
            q.push_back(req);
        }
        while q.len() > 4 {
            q.pop_front();
        }
        self.ready.notify_one();
    }

    fn pop(&self) -> OcrRequest {
        let mut q = self.queue.lock().unwrap();
        loop {
            if let Some(req) = q.pop_front() {
                return req;
            }
            q = self.ready.wait(q).unwrap();
        }
    }
}

struct Kept {
    capture: Capture,
    layout: Option<Layout>,
    /// Per row: portrait samples (32x32 RGB) at small shifts (the first is unshifted).
    feats: Vec<Vec<Vec<f32>>>,
    map_text: Option<MapText>,
    /// Row background colors, for the built-in portraits.
    bgs: Vec<[f32; 3]>,
    /// Per row: the name glyph fingerprint (ally rows only).
    names: Vec<Option<Name>>,
    /// Per row: the name-line suggestion before confirmation (kept so undo can restore it).
    name_suggest: Vec<Option<NameMatch>>,
    /// Per row: the name crop data URL (party rows only).
    name_crops: Vec<Option<String>>,
    /// Map OCR result: None = not read yet (or no OCR), Some(None) = read but no map, Some(Some(id)).
    map_ocr: Option<Option<String>>,
}

#[derive(Default)]
pub struct LiveState {
    /// What the last capture saved to disk read, and when (see SAVE_SAME_AFTER_MS).
    last_saved: Option<(String, u64)>,
    templates: Vec<Template>,
    /// Map texts the user has named by picking the map on the reading bar, stored in MAPS_FILE. They
    /// win over OCR: an explicit correction must stick.
    maps: Vec<(String, MapText)>,
    /// Confirmed player name images, stored in names.json.
    names: Vec<StoredName>,
    /// Name images the user said are not a registered player. Session only: adding a player clears it.
    rejected: Vec<Vec<f32>>,
    /// Players tab (id, name, is_me), sent by the frontend.
    players: Vec<PlayerRef>,
    /// Map id -> localized name, sent by the frontend for map-name OCR.
    maps_vocab: Vec<MapRef>,
    /// OCR map results (including "no map") by map text, matched by similarity: the same map text
    /// differs by a few pixels between captures, so an exact key would OCR every repeat capture again.
    map_ocr_cache: VecDeque<(MapText, Option<String>)>,
    /// OCR text per name fingerprint, so holding TAB does not run Tesseract every 1.5 s.
    ocr_cache: HashMap<u64, Vec<String>>,
    /// Near-identical fingerprints (a one-pixel shift) reuse the OCR text too.
    ocr_recent: Vec<(Vec<f32>, Vec<String>)>,
    /// Tesseract runtime, and the low-priority worker that uses it.
    ocr: Option<ocr::Runtime>,
    ocr_queue: Arc<OcrQueue>,
    next_name_id: u64,
    recent: VecDeque<Kept>,
    status: Status,
    dir: PathBuf,
}

pub type Shared = Arc<Mutex<LiveState>>;

fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

fn encode_jpeg(img: &image::RgbaImage, quality: u8) -> Vec<u8> {
    let rgb = image::DynamicImage::ImageRgba8(img.clone()).to_rgb8();
    let mut out = Vec::new();
    let _ =
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality).encode_image(&rgb);
    out
}

fn crop_png(f: &Frame, layout: &Layout, row: usize) -> String {
    let b = inner_box(portrait_box(layout, row));
    let (x, y, w, h) = (
        b.x as u32,
        b.y as u32,
        b.w.max(1.0) as u32,
        b.h.max(1.0) as u32,
    );
    let mut img = image::RgbaImage::new(w, h);
    for yy in 0..h {
        for xx in 0..w {
            let (sx, sy) = ((x + xx) as usize, (y + yy) as usize);
            if sx < f.width && sy < f.height {
                let i = (sy * f.width + sx) * 4;
                img.put_pixel(
                    xx,
                    yy,
                    image::Rgba([f.data[i], f.data[i + 1], f.data[i + 2], 255]),
                );
            }
        }
    }
    let img = image::imageops::resize(&img, 64, 64, image::imageops::FilterType::Triangle);
    let mut out = Cursor::new(Vec::new());
    let _ = img.write_to(&mut out, image::ImageFormat::Png);
    data_url("image/png", &out.into_inner())
}

/// FNV-1a of a name fingerprint, the OCR cache key.
fn feat_key(feat: &[f32]) -> u64 {
    let mut h = 1469598103934665603u64;
    for v in feat {
        for b in v.to_bits().to_le_bytes() {
            h ^= b as u64;
            h = h.wrapping_mul(1099511628211);
        }
    }
    h
}

/// Taught map texts. 2.9.0 kept them in maps.json, but its stats map filter also wrote there, and many
/// maps got stored as Grimsvotn or Junkertown. Those entries are left behind on purpose.
const MAPS_FILE: &str = "maps-taught.json";

fn load_json<T: serde::de::DeserializeOwned + Default>(path: &Path) -> T {
    fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

/// Write to a temporary file, then rename over the old one: a crash never leaves half a file.
fn save_json(path: &Path, value: &impl Serialize) {
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let tmp = path.with_extension("tmp");
    if fs::write(&tmp, serde_json::to_vec(value).unwrap_or_default()).is_ok() {
        let _ = fs::rename(tmp, path);
    }
}

/// Small PNG of the name glyphs for the overlay question, as a data URL.
fn name_crop(f: &Frame, rect: [usize; 4]) -> String {
    let pad = 2;
    let x0 = rect[0].saturating_sub(pad);
    let y0 = rect[1].saturating_sub(pad);
    let x1 = (rect[0] + rect[2] + pad).min(f.width);
    let y1 = (rect[1] + rect[3] + pad).min(f.height);
    let (w, h) = (x1.saturating_sub(x0).max(1), y1.saturating_sub(y0).max(1));
    let mut img = image::RgbaImage::new(w as u32, h as u32);
    for y in 0..h {
        for x in 0..w {
            let i = ((y0 + y) * f.width + (x0 + x)) * 4;
            img.put_pixel(
                x as u32,
                y as u32,
                image::Rgba([f.data[i], f.data[i + 1], f.data[i + 2], 255]),
            );
        }
    }
    let big = image::imageops::resize(
        &img,
        (w * 3) as u32,
        (h * 3) as u32,
        image::imageops::FilterType::Lanczos3,
    );
    let mut out = Cursor::new(Vec::new());
    let _ = big.write_to(&mut out, image::ImageFormat::Png);
    data_url("image/png", &out.into_inner())
}

impl LiveState {
    fn load_maps(&mut self) {
        let stored: Vec<StoredMap> = load_json(&self.dir.join(MAPS_FILE));
        self.maps = stored
            .into_iter()
            .map(|m| {
                (
                    m.map,
                    MapText {
                        feat: m.feat,
                        aspect: m.aspect,
                        rect: [0; 4],
                        full: [0; 4],
                    },
                )
            })
            .collect();
    }

    fn save_maps(&self) {
        let stored: Vec<StoredMap> = self
            .maps
            .iter()
            .map(|(map, t)| StoredMap {
                map: map.clone(),
                feat: t.feat.clone(),
                aspect: t.aspect,
            })
            .collect();
        save_json(&self.dir.join(MAPS_FILE), &stored);
    }

    fn load_templates(&mut self) {
        let stored: Vec<StoredTemplate> = load_json(&self.dir.join("templates.json"));
        self.templates = stored
            .into_iter()
            .map(|t| Template {
                label: t.label,
                feat: t.feat,
            })
            .collect();
        self.refresh_counts();
    }

    fn save_templates(&self) {
        let stored: Vec<StoredTemplate> = self
            .templates
            .iter()
            .map(|t| StoredTemplate {
                label: t.label.clone(),
                feat: t.feat.clone(),
            })
            .collect();
        save_json(&self.dir.join("templates.json"), &stored);
    }

    fn refresh_counts(&mut self) {
        self.status.templates = self.templates.len();
        self.status.names = self.names.len();
        let mut heroes: Vec<&str> = self
            .templates
            .iter()
            .map(|t| t.label.as_str())
            .filter(|l| !l.starts_with("__"))
            .collect();
        heroes.sort();
        heroes.dedup();
        self.status.heroes = heroes.len();
    }

    fn valid_name_feat(f: &[f32]) -> bool {
        f.len() == nameplate::W * nameplate::H && f.iter().all(|v| v.is_finite())
    }

    fn load_names(&mut self) {
        let stored: NameStore = load_json(&self.dir.join("names.json"));
        self.names = stored
            .templates
            .into_iter()
            .filter(|t| {
                t.player != 0
                    && !t.name.is_empty()
                    && t.name.chars().count() <= 40
                    && Self::valid_name_feat(&t.feat)
            })
            .collect();
        self.next_name_id = self.names.iter().map(|t| t.id).max().unwrap_or(0) + 1;
        self.refresh_counts();
    }

    fn save_names(&self) {
        let stored = NameStore {
            templates: self.names.clone(),
        };
        save_json(&self.dir.join("names.json"), &stored);
    }

    fn player(&self, id: i64) -> Option<&PlayerRef> {
        self.players.iter().find(|p| p.id == id)
    }

    fn candidate(&self, player: i64, score: f32) -> NameCandidate {
        NameCandidate {
            player,
            name: self
                .player(player)
                .map(|p| p.name.clone())
                .unwrap_or_else(|| format!("player {player}")),
            score,
        }
    }

    fn known_match(&self, player: i64, score: f32) -> NameMatch {
        let name = self
            .player(player)
            .map(|p| p.name.clone())
            .unwrap_or_else(|| format!("player {player}"));
        NameMatch {
            player,
            name,
            score,
            known: true,
            candidates: Vec::new(),
        }
    }

    /// Scores of the confirmed name images for every registered, non-me player.
    fn visual_scores(&self, feat: &[f32]) -> Vec<(i64, f32)> {
        nameplate::name_scores(
            feat,
            self.names
                .iter()
                .filter(|t| self.player(t.player).is_some_and(|p| !p.me))
                .map(|t| (t.player, t.feat.as_slice())),
        )
    }

    /// The automatic answer for a glyph fingerprint, when one confirmed image clears the bar.
    fn known_for(&self, feat: &[f32]) -> Option<(i64, f32)> {
        nameplate::best_name(&self.visual_scores(feat))
    }

    /// True when the user already said this glyphs are not a registered player.
    fn is_rejected(&self, feat: &[f32]) -> bool {
        self.rejected
            .iter()
            .any(|r| nameplate::similarity(feat, r) >= SUGGEST_MIN)
    }

    /// Cached OCR text for this fingerprint, including a cached empty result (do not retry every capture).
    fn cached_texts(&self, feat: &[f32]) -> Option<Vec<String>> {
        if let Some(t) = self.ocr_cache.get(&feat_key(feat)) {
            return Some(t.clone());
        }
        self.ocr_recent
            .iter()
            .find(|(f, _)| nameplate::similarity(f, feat) >= 0.995)
            .map(|(_, t)| t.clone())
    }

    /// Fills each party row's name from confirmed images, or from a visual question. Rows that need
    /// OCR are returned to the caller; the caller enqueues them after emitting the capture, so the
    /// capture path never waits for Tesseract.
    #[allow(clippy::needless_range_loop)]
    fn read_names(&mut self, f: &Frame, kept: &mut Kept) -> Vec<OcrRequest> {
        let rows = kept.capture.rows.len();
        let party = kept.capture.debug.party.clone();
        let me = kept.capture.me;
        let mut readings: Vec<Option<NameMatch>> = vec![None; rows];
        let mut tried = vec![false; rows];
        let mut pending = Vec::new();
        for i in 0..rows {
            let Some(name) = kept.names.get(i).cloned().flatten() else {
                continue;
            };
            if kept.capture.rows[i].team != "ally" || !party.get(i).copied().unwrap_or(false) {
                continue;
            }
            if me == Some(i) {
                continue;
            }
            let scores = self.visual_scores(&name.feat);
            if let Some((player, score)) = nameplate::best_name(&scores) {
                readings[i] = Some(self.known_match(player, score));
                continue;
            }
            if self.is_rejected(&name.feat) {
                continue;
            }
            // A confirmed image that is a little too far (another resolution) still makes a good question.
            let mut cands: Vec<NameCandidate> = scores
                .iter()
                .filter(|(_, s)| *s >= SUGGEST_MIN)
                .take(2)
                .map(|(p, s)| self.candidate(*p, *s))
                .collect();
            // Visual first: a close confirmed image is enough for the question. OCR only fills the
            // empty case, and the answer is cached so held TAB does not run Tesseract again.
            let mut ocr_pending = false;
            if cands.is_empty() && self.ocr.is_some() {
                if let Some(texts) = self.cached_texts(&name.feat) {
                    cands = self.ocr_candidates(&texts);
                } else if let Some(layout) = &kept.layout
                    && let Some(band) = ocr::name_band(f, layout, i)
                {
                    pending.push(OcrRequest {
                        capture_id: kept.capture.id,
                        job: OcrJob::Name {
                            row: i,
                            feat: name.feat.clone(),
                            band,
                        },
                    });
                    ocr_pending = true;
                }
            }
            if cands.is_empty() {
                tried[i] = !ocr_pending;
                continue;
            }
            cands.sort_by(|a, b| b.score.total_cmp(&a.score));
            cands.truncate(3);
            readings[i] = Some(NameMatch {
                player: cands[0].player,
                name: cands[0].name.clone(),
                score: cands[0].score,
                known: false,
                candidates: cands,
            });
        }
        if self.ocr_cache.len() > 512 {
            self.ocr_cache.clear();
        }
        for i in 0..rows {
            let party_unknown = party.get(i).copied().unwrap_or(false) && me != Some(i);
            let crop = if party_unknown {
                kept.names[i].as_ref().map(|n| name_crop(f, n.rect))
            } else {
                None
            };
            // Only an unanswered question is worth restoring after an undo/reject. A known match must
            // not come back when its remembered image is removed.
            kept.name_suggest[i] = readings[i].clone().filter(|m| !m.known);
            kept.name_crops[i] = crop.clone();
            kept.capture.rows[i].name = readings[i].clone();
            kept.capture.rows[i].name_tried = tried[i];
            kept.capture.rows[i].name_crop = if readings[i].as_ref().is_none_or(|m| !m.known) {
                crop
            } else {
                None
            };
        }
        pending
    }

    fn ocr_candidates(&self, texts: &[String]) -> Vec<NameCandidate> {
        let mut out: Vec<NameCandidate> = ocr::name_scores(texts, &self.players)
            .into_iter()
            .filter(|(_, score)| *score >= 0.55)
            .map(|(player, score)| self.candidate(player, score))
            .collect();
        out.sort_by(|a, b| b.score.total_cmp(&a.score));
        out.truncate(3);
        out
    }

    /// Re-applies confirmed name images to kept captures after a name is learned, undone or rejected.
    #[allow(clippy::needless_range_loop)]
    fn refresh_names(&mut self, kept: &mut Kept) {
        let party = kept.capture.debug.party.clone();
        let me = kept.capture.me;
        for i in 0..kept.names.len() {
            let Some(name) = kept.names[i].clone() else {
                continue;
            };
            if kept.capture.rows[i].team != "ally" {
                continue;
            }
            let row = &mut kept.capture.rows[i];
            if let Some((player, score)) = self.known_for(&name.feat) {
                row.name = Some(self.known_match(player, score));
                row.name_crop = None;
                row.name_tried = false;
            } else if self.is_rejected(&name.feat) {
                row.name = None;
                row.name_tried = false;
            } else {
                row.name = kept.name_suggest[i].clone();
                row.name_crop = if party.get(i).copied().unwrap_or(false) && me != Some(i) {
                    kept.name_crops[i].clone()
                } else {
                    None
                };
            }
        }
    }

    /// Re-reads every kept capture after something learned changed (a hero, a map, a name), and shows
    /// the newest one again.
    fn reread_all(&mut self, app: &AppHandle) {
        let mut recent = std::mem::take(&mut self.recent);
        for k in recent.iter_mut() {
            self.reread(k);
            self.refresh_names(k);
        }
        self.recent = recent;
        if let Some(latest) = self.recent.back() {
            let _ = app.emit("live://capture", latest.capture.clone());
        }
    }

    /// The map for a map text: a map the user picked for this text wins, then the OCR result. None
    /// while OCR is still reading it, so the previous match's map is never shown for a new one.
    fn map_of(&self, kept: &Kept) -> Option<String> {
        kept.map_text
            .as_ref()
            .and_then(|t| match_map(t, &self.maps))
            .map(str::to_string)
            .or_else(|| kept.map_ocr.clone().flatten())
    }

    /// A cached OCR answer for this map text (Some(None): read before, no map).
    fn cached_map(&self, text: &MapText) -> Option<Option<String>> {
        self.map_ocr_cache
            .iter()
            .find(|(t, _)| similarity(t, text) >= MAP_MIN)
            .map(|(_, m)| m.clone())
    }

    fn cache_map(&mut self, text: MapText, map: Option<String>) {
        self.map_ocr_cache
            .retain(|(t, _)| similarity(t, &text) < MAP_MIN);
        self.map_ocr_cache.push_back((text, map));
        while self.map_ocr_cache.len() > 64 {
            self.map_ocr_cache.pop_front();
        }
    }

    fn reread(&self, kept: &mut Kept) {
        kept.capture.map = self.map_of(kept);
        let Some(layout) = kept.layout.clone() else {
            return;
        };
        for (i, feat) in kept.feats.iter().enumerate() {
            let m = recognize(feat, kept.bgs[i], &self.templates);
            kept.capture.rows[i].label = m.label;
            kept.capture.rows[i].score = m.score;
        }
        kept.capture.sane = sane(&reading_of(&kept.capture, layout));
    }
}

fn reading_of(c: &Capture, layout: Layout) -> pickgak_vision::Reading {
    pickgak_vision::Reading {
        layout,
        rows: c
            .rows
            .iter()
            .map(|r| pickgak_vision::Match {
                label: r.label.clone(),
                score: r.score,
            })
            .collect(),
        me: c.me,
    }
}

/// What a capture read, for telling repeats apart.
fn signature(c: &Capture) -> String {
    let rows: Vec<&str> = c
        .rows
        .iter()
        .map(|r| r.label.as_deref().unwrap_or("?"))
        .collect();
    let opt = |v: &[Option<String>]| {
        v.iter()
            .map(|x| x.as_deref().unwrap_or("?"))
            .collect::<Vec<_>>()
            .join(",")
    };
    format!(
        "{}|{}|{:?}|{}|{}|{:?}",
        c.scoreboard,
        rows.join(","),
        c.me,
        opt(&c.bans),
        opt(&c.ranks),
        c.map
    )
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Turns a raw capture into a Capture (reading + crops + thumbnail) and keeps it. The returned OCR
/// requests must be enqueued only after the capture event is emitted, so the worker cannot overtake it.
fn process(
    state: &Shared,
    rgba: Vec<u8>,
    width: usize,
    height: usize,
    grab_ms: u64,
    window: String,
) -> (Capture, Vec<OcrRequest>) {
    let t0 = std::time::Instant::now();
    let f = Frame {
        data: &rgba,
        width,
        height,
    };
    let layout = detect_scoreboard(&f);
    let map_txt = layout.as_ref().and_then(|_| map_text(&f));
    let labels = |v: Vec<pickgak_vision::Match>| v.into_iter().map(|m| m.label).collect::<Vec<_>>();
    let rects =
        |v: Vec<pickgak_vision::Rect>| v.iter().map(|b| [b.x, b.y, b.w, b.h]).collect::<Vec<_>>();
    // the boxes are needed for the debug view anyway, so hand them to the readers instead of scanning
    // the frame twice
    let (ban_boxes, rank_boxes) = if layout.is_some() {
        (
            pickgak_vision::bans::ban_boxes(&f),
            pickgak_vision::rank::rank_boxes(&f),
        )
    } else {
        (Vec::new(), Vec::new())
    };
    let (ban_rects, rank_rects) = (rects(ban_boxes.clone()), rects(rank_boxes.clone()));
    let (bans, ranks) = if layout.is_some() {
        (
            labels(pickgak_vision::bans::read_bans_in(&f, &ban_boxes)),
            labels(pickgak_vision::rank::read_rank_range_in(&f, &rank_boxes)),
        )
    } else {
        (Vec::new(), Vec::new())
    };
    let bgs: Vec<[f32; 3]> = layout
        .as_ref()
        .map(|l| {
            (0..l.rows.len())
                .map(|i| seeds::row_background(&f, l, i))
                .collect()
        })
        .unwrap_or_default();
    let (feats, me, stats, rows) = match &layout {
        Some(l) => (
            (0..l.rows.len())
                .map(|i| portrait_samples(&f, l, i))
                .collect::<Vec<_>>(),
            me_row(&f, l),
            Some(pickgak_vision::stats::read_stats(&f, l)),
            (0..l.rows.len())
                .map(|i| Row {
                    team: if l.rows[i].team == Team::Ally {
                        "ally"
                    } else {
                        "enemy"
                    },
                    label: None,
                    score: 0.0,
                    crop: crop_png(&f, l, i),
                    name: None,
                    name_crop: None,
                    name_tried: false,
                })
                .collect::<Vec<_>>(),
        ),
        None => (Vec::new(), None, None, Vec::new()),
    };
    let party = layout
        .as_ref()
        .map(|l| pickgak_vision::party_rows(&f, l))
        .unwrap_or_default();
    // Name glyphs: ally rows only. A party row's name is what can identify a player; the enemy names
    // are not used for party matching.
    let names = layout
        .as_ref()
        .map(|l| {
            (0..l.rows.len())
                .map(|i| {
                    if l.rows[i].team == Team::Ally && party.get(i).copied().unwrap_or(false) {
                        nameplate::name_of(&f, l, i)
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let at = now_ms();
    let capture = Capture {
        id: at,
        at,
        width,
        height,
        scoreboard: layout.is_some(),
        map: None,
        bans,
        ranks,
        rows,
        me,
        sane: true,
        stats,
        grab_ms,
        // filled in after the name pass, before this capture leaves
        thumb: String::new(),
        debug: CaptureDebug {
            window,
            // filled in once the reading is done, just before the capture leaves (see below)
            process_ms: 0,
            saved: false,
            ocr_ms: 0,
            table: layout.as_ref().map(|l| [l.left, l.header_y, l.right]),
            row_h: layout.as_ref().map_or(0.0, |l| l.row_h),
            portraits: layout
                .as_ref()
                .map(|l| {
                    (0..l.rows.len())
                        .map(|i| {
                            let b = inner_box(portrait_box(l, i));
                            [b.x, b.y, b.w, b.h]
                        })
                        .collect()
                })
                .unwrap_or_default(),
            party: party.clone(),
            bans: ban_rects,
            ranks: rank_rects,
            map_text: map_txt.as_ref().map(|t| t.rect),
        },
    };
    let row_count = capture.rows.len();
    let mut kept = Kept {
        capture,
        layout,
        feats,
        map_text: map_txt,
        bgs,
        names,
        name_suggest: vec![None; row_count],
        name_crops: vec![None; row_count],
        map_ocr: None,
    };
    let mut pending = Vec::new();
    {
        let mut st = state.lock().unwrap();
        // The map: a taught map text, else a cached OCR answer for the same text, else ask the worker
        // (the capture leaves without a map, never with the previous one).
        if let Some(mt) = &kept.map_text
            && st.ocr.is_some()
            && !st.maps_vocab.is_empty()
            && match_map(mt, &st.maps).is_none()
        {
            kept.map_ocr = st.cached_map(mt);
            if kept.map_ocr.is_none()
                && let Some(band) = ocr::map_band(&f, mt.full)
            {
                pending.push(OcrRequest {
                    capture_id: kept.capture.id,
                    job: OcrJob::Map {
                        text: mt.clone(),
                        band,
                    },
                });
            }
        }
        st.reread(&mut kept);
        // name masks are compared to the confirmed images; an unconfirmed party row may get an OCR
        // question
        let names = st.read_names(&f, &mut kept);
        pending.splice(0..0, names);
    }
    // Images are made outside the lock: the OCR worker and the UI's commands need it meanwhile.
    let img = image::RgbaImage::from_raw(width as u32, height as u32, rgba).unwrap_or_default();
    let small = image::imageops::resize(
        &img,
        640,
        (640 * height / width.max(1)) as u32,
        image::imageops::FilterType::Triangle,
    );
    kept.capture.thumb = data_url("image/jpeg", &encode_jpeg(&small, 80));
    // the whole reading, not just the frame scan: what a slow capture actually costs
    kept.capture.debug.process_ms = t0.elapsed().as_millis() as u64;
    let mut st = state.lock().unwrap();
    // full-resolution copy on disk (local only), pruned to the newest KEEP_ON_DISK; repeats that read
    // the same as the last saved capture are skipped for a while
    let sig = signature(&kept.capture);
    let at = kept.capture.at;
    let skip = st
        .last_saved
        .as_ref()
        .is_some_and(|(s, saved)| *s == sig && at.saturating_sub(*saved) < SAVE_SAME_AFTER_MS);
    if !skip {
        st.last_saved = Some((sig, at));
        let dir = st.dir.join("captures");
        let path = dir.join(format!("{}.jpg", kept.capture.id));
        // encoding a 1440p JPEG takes tens of milliseconds: off this thread, and only when it is kept
        std::thread::spawn(move || {
            let _ = fs::create_dir_all(&dir);
            let _ = fs::write(&path, encode_jpeg(&img, 85));
            if let Ok(rd) = fs::read_dir(&dir) {
                let mut files: Vec<PathBuf> = rd.filter_map(|e| e.ok().map(|e| e.path())).collect();
                files.sort();
                let extra = files.len().saturating_sub(KEEP_ON_DISK);
                for p in files.into_iter().take(extra) {
                    let _ = fs::remove_file(p);
                }
            }
        });
    }
    kept.capture.debug.saved = !skip;
    let out = kept.capture.clone();
    st.recent.push_back(kept);
    while st.recent.len() > KEEP_IN_MEMORY {
        st.recent.pop_front();
    }
    (out, pending)
}

/// Lower the *calling* thread. Linux nice values are per thread and inherited at creation, but Windows
/// thread priorities are not: the worker must lower itself, not the thread that spawns it (that is the
/// setup/UI thread). The Tesseract child also gets an explicit below-normal class on Windows.
fn lower_worker_priority() {
    #[cfg(unix)]
    unsafe {
        libc::setpriority(libc::PRIO_PROCESS, 0, 10);
    }
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::System::Threading::{
            GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_BELOW_NORMAL,
        };
        SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_BELOW_NORMAL);
    }
}

fn spawn_ocr_worker(app: AppHandle, state: Shared, queue: Arc<OcrQueue>, rt: ocr::Runtime) {
    std::thread::spawn(move || {
        lower_worker_priority();
        loop {
            let req = queue.pop();
            // A newer capture already arrived: its own rows are queued, this one is stale.
            if state.lock().unwrap().recent.back().map(|k| k.capture.id) != Some(req.capture_id) {
                continue;
            }
            match req.job {
                OcrJob::Name { row, feat, band } => {
                    let cached = state.lock().unwrap().cached_texts(&feat);
                    let (texts, ocr_ms) = match cached {
                        Some(t) => (t, 0),
                        None => {
                            let players = state.lock().unwrap().players.clone();
                            let (t, ms) = ocr::name_texts(&rt, &band, &players);
                            let mut st = state.lock().unwrap();
                            st.ocr_cache.insert(feat_key(&feat), t.clone());
                            st.ocr_recent.push((feat.clone(), t.clone()));
                            if st.ocr_recent.len() > 64 {
                                st.ocr_recent.remove(0);
                            }
                            (t, ms)
                        }
                    };
                    if texts.is_empty() {
                        continue;
                    }
                    let mut st = state.lock().unwrap();
                    if st.recent.back().map(|k| k.capture.id) != Some(req.capture_id) {
                        continue;
                    }
                    let feat = {
                        let Some(k) = st.recent.iter().find(|k| k.capture.id == req.capture_id)
                        else {
                            continue;
                        };
                        let Some(name) = k.names.get(row).cloned().flatten() else {
                            continue;
                        };
                        name.feat
                    };
                    if st.known_for(&feat).is_some() || st.is_rejected(&feat) {
                        continue;
                    }
                    let cands = st.ocr_candidates(&texts);
                    if cands.is_empty() {
                        // tell the overlay that no suggestion is coming, so it can ask with the list
                        let Some(k) = st
                            .recent
                            .iter_mut()
                            .find(|k| k.capture.id == req.capture_id)
                        else {
                            continue;
                        };
                        k.capture.rows[row].name_tried = true;
                        let capture = k.capture.clone();
                        drop(st);
                        let _ = app.emit("live://capture", capture);
                        continue;
                    }
                    let m = NameMatch {
                        player: cands[0].player,
                        name: cands[0].name.clone(),
                        score: cands[0].score,
                        known: false,
                        candidates: cands,
                    };
                    let Some(k) = st
                        .recent
                        .iter_mut()
                        .find(|k| k.capture.id == req.capture_id)
                    else {
                        continue;
                    };
                    k.name_suggest[row] = Some(m.clone());
                    k.capture.rows[row].name = Some(m);
                    k.capture.debug.ocr_ms = ocr_ms;
                    let capture = k.capture.clone();
                    drop(st);
                    let _ = app.emit("live://capture", capture);
                }
                OcrJob::Map { text, band } => {
                    let (texts, ocr_ms) = ocr::map_texts(&rt, &band);
                    let mut st = state.lock().unwrap();
                    let map = ocr::best_map(&texts, &st.maps_vocab);
                    st.cache_map(text, map.clone());
                    let Some(i) = st
                        .recent
                        .iter()
                        .position(|k| k.capture.id == req.capture_id)
                    else {
                        continue;
                    };
                    st.recent[i].map_ocr = Some(map);
                    let now = st.map_of(&st.recent[i]);
                    let latest = i + 1 == st.recent.len();
                    let k = &mut st.recent[i];
                    if k.capture.map == now {
                        continue;
                    }
                    k.capture.map = now;
                    k.capture.debug.ocr_ms = ocr_ms;
                    let capture = k.capture.clone();
                    drop(st);
                    if latest {
                        let _ = app.emit("live://capture", capture);
                    }
                }
            }
        }
    });
}

pub fn start(app: &AppHandle) -> Shared {
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let runtime = ocr::runtime(app);
    let state: Shared = Arc::new(Mutex::new(LiveState {
        dir,
        ocr: runtime.clone(),
        ..Default::default()
    }));
    let queue = state.lock().unwrap().ocr_queue.clone();
    state.lock().unwrap().load_templates();
    state.lock().unwrap().load_maps();
    state.lock().unwrap().load_names();
    {
        let mut st = state.lock().unwrap();
        st.status.ocr = runtime.is_some();
        st.status.ocr_bundled = runtime.as_ref().is_some_and(|r| r.bundled);
    }
    if let Some(rt) = runtime {
        spawn_ocr_worker(app.clone(), state.clone(), queue.clone(), rt);
    }
    match pickgak_live::start() {
        Ok(rx) => {
            state.lock().unwrap().status.listening = true;
            let (app, state) = (app.clone(), state.clone());
            std::thread::spawn(move || {
                while let Ok(first) = rx.recv() {
                    // if captures piled up while we were busy, read only the newest (other events in order)
                    let batch: Vec<LiveEvent> =
                        std::iter::once(first).chain(rx.try_iter()).collect();
                    let newest = batch
                        .iter()
                        .rposition(|e| matches!(e, LiveEvent::Capture { .. }));
                    for (i, ev) in batch.into_iter().enumerate() {
                        match ev {
                            LiveEvent::Capture { .. } if Some(i) != newest => {}
                            LiveEvent::Capture {
                                rgba,
                                width,
                                height,
                                grab,
                                window,
                            } => {
                                let (c, pending) = process(
                                    &state,
                                    rgba,
                                    width,
                                    height,
                                    grab.as_millis() as u64,
                                    window,
                                );
                                // Emit before queueing OCR: the worker must not overtake the capture
                                // that the frontend has not seen yet.
                                if let Some([left, _, _]) = c.debug.table {
                                    crate::fit_overlay_to_scoreboard(&app, width, height, left);
                                }
                                let _ = app.emit("live://capture", c);
                                // A capture means the game is foreground and the scoreboard is up.
                                // Windows can drop the overlay out of the topmost band when the game
                                // changes display mode; put it back on every capture too, not only on
                                // the TAB press.
                                #[cfg(windows)]
                                crate::raise_overlay(&app);
                                for req in pending {
                                    queue.push(req);
                                }
                            }
                            LiveEvent::CaptureFailed { why, focus } => {
                                let _ = app.emit("live://error", CaptureError { why, focus });
                            }
                            LiveEvent::Tab(down) => {
                                if down {
                                    // Sample it while the game is foreground; the debug view is looked
                                    // at after alt-tabbing, when this would read "normal".
                                    #[cfg(windows)]
                                    {
                                        state.lock().unwrap().status.game_fullscreen =
                                            crate::fullscreen_game();
                                    }
                                    crate::raise_overlay(&app);
                                }
                                let _ = app.emit("live://tab", down);
                            }
                            LiveEvent::TabIgnored { reason, window } => {
                                let reason = match reason {
                                    FocusReason::Other => "other",
                                    FocusReason::Wayland => "wayland",
                                    FocusReason::NoEwmh => "no-ewmh",
                                };
                                let _ = app.emit("live://ignored", IgnoredFocus { reason, window });
                            }
                        }
                    }
                }
            });
        }
        Err(e) => state.lock().unwrap().status.error = Some(e.to_string()),
    }
    state
}

#[tauri::command]
pub fn live_status(app: AppHandle, state: tauri::State<Shared>) -> Status {
    let mut status = state.lock().unwrap().status.clone();
    (status.overlay_visible, status.overlay_topmost) = crate::overlay_state(&app);
    status
}

#[tauri::command]
pub fn live_recent(state: tauri::State<Shared>) -> Vec<Capture> {
    state
        .lock()
        .unwrap()
        .recent
        .iter()
        .rev()
        .map(|k| k.capture.clone())
        .collect()
}

/// "This portrait is <hero>": learn it, then re-read every kept capture with the new template.
#[tauri::command]
pub fn live_teach(
    state: tauri::State<Shared>,
    app: AppHandle,
    capture_id: u64,
    row: usize,
    hero: String,
) -> Result<(), String> {
    if hero.is_empty() || hero.len() > 40 || row >= 16 {
        return Err("bad input".into());
    }
    let mut st = state.lock().unwrap();
    let feat = st
        .recent
        .iter()
        .find(|k| k.capture.id == capture_id)
        .and_then(|k| {
            k.feats
                .get(row)
                .and_then(|v| v.first())
                .map(|s| pickgak_vision::feature(s))
        })
        .ok_or("capture not kept")?;
    st.templates.push(Template { label: hero, feat });
    st.refresh_counts();
    st.save_templates();
    st.reread_all(&app);
    Ok(())
}

/// The Players tab, so a name question can name its candidates. Party identity is green marker plus a
/// name; this list is only the vocabulary, never a guess from preferred heroes.
#[tauri::command]
pub fn live_set_players(state: tauri::State<Shared>, players: Vec<PlayerRef>) {
    let mut st = state.lock().unwrap();
    let mut out: Vec<PlayerRef> = Vec::new();
    for p in players.into_iter().take(64) {
        let name = p.name.trim();
        // friends (other accounts) come with negative ids: -(their user id)
        if p.id == 0 || name.is_empty() || name.chars().count() > 40 {
            continue;
        }
        if out.iter().any(|q| q.id == p.id) {
            continue;
        }
        let mut aliases: Vec<String> = Vec::new();
        for a in p.aliases.iter().take(10) {
            let a = a.trim();
            if !a.is_empty()
                && a.chars().count() <= 40
                && a != name
                && !aliases.iter().any(|b| b == a)
            {
                aliases.push(a.to_string());
            }
        }
        out.push(PlayerRef {
            id: p.id,
            name: name.to_string(),
            aliases,
            me: p.me,
        });
    }
    let changed = out.len() != st.players.len()
        || out.iter().zip(&st.players).any(|(a, b)| {
            a.id != b.id || a.name != b.name || a.aliases != b.aliases || a.me != b.me
        });
    st.players = out;
    // a name the user rejected may belong to a player registered since then
    if changed {
        st.rejected.clear();
    }
}

/// Map id -> localized name, for map-name OCR. The map list follows the UI language, so the cache is
/// cleared when the vocabulary changes.
#[tauri::command]
pub fn live_set_maps(state: tauri::State<Shared>, maps: Vec<MapRef>) {
    let mut st = state.lock().unwrap();
    let mut out: Vec<MapRef> = Vec::new();
    for m in maps.into_iter().take(100) {
        let id = m.id.trim();
        let name = m.name.trim();
        if id.is_empty()
            || id.len() > 60
            || !id
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            || name.is_empty()
            || name.chars().count() > 40
            || out.iter().any(|q| q.id == id)
        {
            continue;
        }
        out.push(MapRef {
            id: id.to_string(),
            name: name.to_string(),
        });
    }
    let changed = out.len() != st.maps_vocab.len()
        || out
            .iter()
            .zip(&st.maps_vocab)
            .any(|(a, b)| a.id != b.id || a.name != b.name);
    st.maps_vocab = out;
    if changed {
        st.map_ocr_cache.clear();
    }
}

/// "This party row is <player>": remember this exact name image, then re-read the kept captures so the
/// row is automatic from now on. Other players' images that match this row are dropped (a correction).
#[tauri::command]
pub fn live_confirm_name(
    state: tauri::State<Shared>,
    app: AppHandle,
    capture_id: u64,
    row: usize,
    player_id: i64,
) -> Result<u64, String> {
    if row >= 16 {
        return Err("bad input".into());
    }
    let mut st = state.lock().unwrap();
    let player = st.player(player_id).cloned().ok_or("unknown player")?;
    if player.me {
        return Err("unknown player".into());
    }
    let feat = st
        .recent
        .iter()
        .find(|k| k.capture.id == capture_id)
        .and_then(|k| k.names.get(row).cloned().flatten())
        .map(|n| n.feat)
        .ok_or("no name in this capture")?;
    // the user says this row is not the player the image matched before
    st.names.retain(|t| {
        !(t.player != player_id && nameplate::similarity(&feat, &t.feat) >= nameplate::NAME_MIN)
    });
    let existing = st
        .names
        .iter()
        .find(|t| t.player == player_id && nameplate::similarity(&feat, &t.feat) >= 0.98)
        .map(|t| t.id);
    let id = match existing {
        Some(id) => id,
        None => {
            let id = st.next_name_id;
            st.next_name_id += 1;
            st.names.push(StoredName {
                id,
                player: player_id,
                name: player.name.clone(),
                feat: feat.clone(),
            });
            // several resolutions/variants per player are useful, but not forever
            let mut ids: Vec<u64> = st
                .names
                .iter()
                .filter(|t| t.player == player_id)
                .map(|t| t.id)
                .collect();
            if ids.len() > 6 {
                ids.sort_unstable();
                let oldest = ids[0];
                st.names.retain(|t| t.id != oldest);
            }
            id
        }
    };
    // this name was not unknown after the confirmation
    st.rejected
        .retain(|r| nameplate::similarity(&feat, r) < 0.90);
    st.refresh_counts();
    st.save_names();
    st.reread_all(&app);
    Ok(id)
}

/// "This is not a registered player": stop asking about this glyph fingerprint for the rest of the
/// session. The main window's party card still allows a manual pick.
#[tauri::command]
pub fn live_reject_name(
    state: tauri::State<Shared>,
    app: AppHandle,
    capture_id: u64,
    row: usize,
) -> Result<(), String> {
    if row >= 16 {
        return Err("bad input".into());
    }
    let mut st = state.lock().unwrap();
    let feat = st
        .recent
        .iter()
        .find(|k| k.capture.id == capture_id)
        .and_then(|k| k.names.get(row).cloned().flatten())
        .map(|n| n.feat)
        .ok_or("no name in this capture")?;
    if st.rejected.len() >= 64 {
        st.rejected.remove(0);
    }
    st.rejected.push(feat);
    st.reread_all(&app);
    Ok(())
}

/// Forget one confirmed name image (undo right after a confirmation).
#[tauri::command]
pub fn live_forget_name_template(state: tauri::State<Shared>, app: AppHandle, template_id: u64) {
    let mut st = state.lock().unwrap();
    st.names.retain(|t| t.id != template_id);
    st.refresh_counts();
    st.save_names();
    st.reread_all(&app);
}

/// Forget every name image of one player (a wrong confirmation from an earlier match).
#[tauri::command]
pub fn live_forget_name(state: tauri::State<Shared>, app: AppHandle, player_id: i64) {
    let mut st = state.lock().unwrap();
    st.names.retain(|t| t.player != player_id);
    st.refresh_counts();
    st.save_names();
    st.reread_all(&app);
}

/// Remembers the map text of a kept capture as `map` (the user picked this map for the match).
#[tauri::command]
pub fn live_teach_map(
    state: tauri::State<Shared>,
    app: AppHandle,
    capture_id: u64,
    map: String,
) -> Result<(), String> {
    if map.is_empty()
        || map.len() > 60
        || !map
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    {
        return Err("bad input".into());
    }
    let mut st = state.lock().unwrap();
    let text = st
        .recent
        .iter()
        .find(|k| k.capture.id == capture_id)
        .and_then(|k| k.map_text.clone())
        .ok_or("no map text in this capture")?;
    // explicit correction: this screen is this map from now on, over OCR and over a wrong earlier
    // entry. Only the reading bar's map picker teaches; the stats map filter never does.
    st.maps.retain(|(_, t)| similarity(t, &text) < MAP_MIN);
    st.maps.push((map, text));
    st.save_maps();
    st.reread_all(&app);
    Ok(())
}

#[tauri::command]
pub fn live_forget(state: tauri::State<Shared>, hero: String) {
    let mut st = state.lock().unwrap();
    st.templates.retain(|t| !hero.is_empty() && t.label != hero);
    st.refresh_counts();
    st.save_templates();
}

/// Forget every map the user picked for a map text; OCR reads them again.
#[tauri::command]
pub fn live_forget_maps(state: tauri::State<Shared>, app: AppHandle) {
    let mut st = state.lock().unwrap();
    st.maps.clear();
    st.save_maps();
    st.reread_all(&app);
}

/// Delete kept captures (memory and disk).
#[tauri::command]
pub fn live_clear(state: tauri::State<Shared>) {
    let mut st = state.lock().unwrap();
    st.recent.clear();
    let _ = fs::remove_dir_all(st.dir.join("captures"));
}

/// Opens the captures folder in the file manager (debug view).
#[tauri::command]
pub fn live_open_captures(state: tauri::State<Shared>) -> Result<(), String> {
    let dir = state.lock().unwrap().dir.join("captures");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    let opener = "explorer";
    #[cfg(not(windows))]
    let opener = "xdg-open";
    std::process::Command::new(opener)
        .arg(&dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
