//! X11 / XWayland backend: XInput2 raw TAB events and `GetImage` of the game window.
//!
//! - Keyboard: XInput2 *raw* key events on the root window. This only observes; the key still reaches
//!   the game (unlike a global shortcut grab). Only TAB is acted on: every other key event is dropped
//!   immediately and never stored.
//! - Capture: `GetImage` of the game's own window when TAB has been held for `HOLD`, then every `REPEAT`
//!   while it stays held. Nothing runs between TAB presses.

use std::sync::mpsc::{Receiver, channel};
use std::thread;
use std::time::{Duration, Instant};

use x11rb::connection::Connection;
use x11rb::protocol::Event;
use x11rb::protocol::xinput::{self, ConnectionExt as _};
use x11rb::protocol::xproto::{AtomEnum, ConnectionExt as _, ImageFormat, Window};
use x11rb::rust_connection::RustConnection;

use super::{Error, FocusReason, HOLD, LiveEvent, MAX_HOLD, REPEAT};

const XK_TAB: u32 = 0xff09;

/// Window that is the game: a Steam/Proton window class (`steam_app_<id>`), or a title that is exactly
/// the game's name. A title that merely *contains* "Overwatch" (a browser tab, a wiki page) doesn't count.
pub fn is_game_window(class: &str, title: &str) -> bool {
    let t = title.trim().to_lowercase();
    class.to_lowercase().contains("steam_app_") || t == "overwatch" || t == "오버워치"
}

fn text_prop(
    conn: &RustConnection,
    win: Window,
    prop: impl Into<u32>,
    kind: impl Into<u32>,
) -> String {
    conn.get_property(false, win, prop, kind, 0, 1024)
        .ok()
        .and_then(|c| c.reply().ok())
        .map(|r| {
            String::from_utf8_lossy(&r.value)
                .replace('\0', " ")
                .trim()
                .to_string()
        })
        .unwrap_or_default()
}

/// The largest top-level window that looks like the game: (window, description, width, height).
pub fn find_game_window(conn: &RustConnection, root: Window) -> Option<(Window, String, u16, u16)> {
    let utf8 = conn
        .intern_atom(false, b"UTF8_STRING")
        .ok()?
        .reply()
        .ok()?
        .atom;
    let net_name = conn
        .intern_atom(false, b"_NET_WM_NAME")
        .ok()?
        .reply()
        .ok()?
        .atom;
    let tree = conn.query_tree(root).ok()?.reply().ok()?;
    let mut best: Option<(Window, String, u16, u16)> = None;
    for w in tree.children {
        let class = text_prop(conn, w, AtomEnum::WM_CLASS, AtomEnum::STRING);
        let mut title = text_prop(conn, w, net_name, utf8);
        if title.is_empty() {
            title = text_prop(conn, w, AtomEnum::WM_NAME, AtomEnum::STRING);
        }
        if !is_game_window(&class, &title) {
            continue;
        }
        let Some(geo) = conn.get_geometry(w).ok().and_then(|c| c.reply().ok()) else {
            continue;
        };
        if best
            .as_ref()
            .is_none_or(|b| geo.width as u32 * geo.height as u32 > b.2 as u32 * b.3 as u32)
        {
            best = Some((w, format!("{class} | {title}"), geo.width, geo.height));
        }
    }
    best
}

/// What the window manager says has focus (`_NET_ACTIVE_WINDOW`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Focus {
    Game,
    /// Another window, or a Wayland-native one (the property is then 0).
    Other,
    /// No such property (a window manager without EWMH): don't block on it.
    Unknown,
}

/// TAB counts only while the game has focus: TAB in a browser or a chat must not capture the game or
/// pop the overlay.
pub fn counts(focus: Focus) -> bool {
    focus != Focus::Other
}

/// The focused X window per `_NET_ACTIVE_WINDOW`, as (class, title). `Ok(None)`: no X window has focus
/// (0, or deleted while advertised: a Wayland window). `Err(())`: no EWMH information at all.
#[allow(clippy::result_unit_err)]
pub fn active_window(conn: &RustConnection, root: Window) -> Result<Option<(String, String)>, ()> {
    let atom = |name: &[u8]| {
        conn.intern_atom(true, name)
            .ok()
            .and_then(|c| c.reply().ok())
            .map(|r| r.atom)
            .filter(|&a| a != 0)
    };
    let Some(active) = atom(b"_NET_ACTIVE_WINDOW") else {
        return Err(());
    };
    // GNOME (mutter) advertises _NET_ACTIVE_WINDOW but deletes it while a Wayland-native window has
    // focus: with support advertised, a missing value means "not an X window", so not the game
    let supported = atom(b"_NET_SUPPORTED")
        .and_then(|a| {
            conn.get_property(false, root, a, AtomEnum::ANY, 0, 1024)
                .ok()
        })
        .and_then(|c| c.reply().ok())
        .and_then(|r| r.value32().map(|mut v| v.any(|x| x == active)))
        .unwrap_or(false);
    let missing = if supported { Ok(None) } else { Err(()) };
    let Some(reply) = conn
        // any type: window managers store it as WINDOW, but don't rely on it
        .get_property(false, root, active, AtomEnum::ANY, 0, 1)
        .ok()
        .and_then(|c| c.reply().ok())
    else {
        return missing;
    };
    let Some(win) = reply.value32().and_then(|mut v| v.next()) else {
        return missing;
    };
    if win == 0 {
        return Ok(None);
    }
    let utf8 = conn
        .intern_atom(false, b"UTF8_STRING")
        .ok()
        .and_then(|c| c.reply().ok())
        .map(|r| r.atom);
    let net_name = conn
        .intern_atom(false, b"_NET_WM_NAME")
        .ok()
        .and_then(|c| c.reply().ok())
        .map(|r| r.atom);
    let class = text_prop(conn, win, AtomEnum::WM_CLASS, AtomEnum::STRING);
    let mut title = match (net_name, utf8) {
        (Some(n), Some(u)) => text_prop(conn, win, n, u),
        _ => String::new(),
    };
    if title.is_empty() {
        title = text_prop(conn, win, AtomEnum::WM_NAME, AtomEnum::STRING);
    }
    Ok(Some((class, title)))
}

pub fn game_focus(conn: &RustConnection, root: Window) -> Focus {
    match active_window(conn, root) {
        Err(()) => Focus::Unknown,
        Ok(None) => Focus::Other,
        Ok(Some((class, title))) if is_game_window(&class, &title) => Focus::Game,
        Ok(Some(_)) => Focus::Other,
    }
}

/// The focus for the debug log: why it isn't the game, and the focused window ("class | title") when
/// there was one to name.
pub fn focus_of(conn: &RustConnection, root: Window) -> (FocusReason, Option<String>) {
    match active_window(conn, root) {
        Err(()) => (FocusReason::NoEwmh, None),
        Ok(None) => (FocusReason::Wayland, None),
        Ok(Some((class, title))) => (FocusReason::Other, Some(format!("{class} | {title}"))),
    }
}

/// Whether any of `codes` is down right now (the core keymap), to catch a release we never saw (the key
/// went up while another window had focus). Errors count as down so a flaky query never stops capture.
pub fn key_down(conn: &RustConnection, codes: &[u8]) -> bool {
    match conn.query_keymap().ok().and_then(|c| c.reply().ok()) {
        Some(k) => codes
            .iter()
            .any(|&c| k.keys[c as usize / 8] & (1 << (c % 8)) != 0),
        None => true,
    }
}

/// Copies a window's pixels as RGBA.
pub fn capture_window(
    conn: &RustConnection,
    win: Window,
    width: u16,
    height: u16,
) -> Result<Vec<u8>, Error> {
    let img = conn
        .get_image(ImageFormat::Z_PIXMAP, win, 0, 0, width, height, !0)?
        .reply()?;
    if img.depth != 24 && img.depth != 32 {
        return Err(format!("unsupported depth {}", img.depth).into());
    }
    // 32 bits per pixel, little-endian BGRX
    let mut rgba = Vec::with_capacity(width as usize * height as usize * 4);
    for px in img.data.as_chunks::<4>().0 {
        rgba.extend_from_slice(&[px[2], px[1], px[0], 255]);
    }
    Ok(rgba)
}

fn tab_keycodes(conn: &RustConnection) -> Result<Vec<u8>, Error> {
    let setup = conn.setup();
    let (min, max) = (setup.min_keycode, setup.max_keycode);
    let map = conn.get_keyboard_mapping(min, max - min + 1)?.reply()?;
    let per = map.keysyms_per_keycode as usize;
    Ok(map
        .keysyms
        .chunks(per.max(1))
        .enumerate()
        .filter(|(_, syms)| syms.contains(&XK_TAB))
        .map(|(i, _)| min + i as u8)
        .collect())
}

/// Starts watching TAB on the default display. Events arrive on the returned channel.
/// Runs on its own threads; idle (blocked on the X socket) between key events.
pub fn start() -> Result<Receiver<LiveEvent>, Error> {
    let (conn, screen) = x11rb::connect(None)?;
    let root = conn.setup().roots[screen].root;
    conn.xinput_xi_query_version(2, 2)?.reply()?;
    let tabs = tab_keycodes(&conn)?;
    conn.xinput_xi_select_events(
        root,
        &[xinput::EventMask {
            deviceid: xinput::Device::ALL.into(),
            mask: vec![xinput::XIEventMask::RAW_KEY_PRESS | xinput::XIEventMask::RAW_KEY_RELEASE],
        }],
    )?;
    conn.flush()?;

    let (tx, rx) = channel();
    thread::spawn(move || {
        // a second connection for captures so the key thread never blocks on image transfers
        let Ok((cap, _)) = x11rb::connect(None) else {
            return;
        };
        let (press_tx, press_rx) = channel::<Instant>();
        let held = std::sync::Arc::new(std::sync::Mutex::new(None::<Instant>));
        let held_cap = held.clone();
        let tx_cap = tx.clone();
        let tabs_cap = tabs.clone();
        let tx_key = tx;
        thread::spawn(move || {
            for token in press_rx {
                thread::sleep(HOLD);
                let mut failed = false;
                // one capture after HOLD, then every REPEAT while the same press lasts
                while *held_cap.lock().unwrap() == Some(token) {
                    // stop when TAB is actually up (a release we missed), the game lost focus, or the
                    // press is implausibly long
                    if !key_down(&cap, &tabs_cap)
                        || !counts(game_focus(&cap, root))
                        || token.elapsed() > MAX_HOLD
                    {
                        let mut h = held_cap.lock().unwrap();
                        if *h == Some(token) {
                            *h = None;
                            let _ = tx_cap.send(LiveEvent::Tab(false));
                        }
                        break;
                    }
                    let ev = match find_game_window(&cap, root) {
                        None => LiveEvent::CaptureFailed {
                            why: "game window not found".into(),
                            focus: focus_of(&cap, root).1,
                        },
                        Some((win, desc, w, h)) => {
                            let t0 = Instant::now();
                            match capture_window(&cap, win, w, h) {
                                Ok(rgba) => LiveEvent::Capture {
                                    rgba,
                                    width: w as usize,
                                    height: h as usize,
                                    grab: t0.elapsed(),
                                    window: desc,
                                },
                                Err(e) => LiveEvent::CaptureFailed {
                                    why: e.to_string(),
                                    focus: None,
                                },
                            }
                        }
                    };
                    // a failure (game minimized...) is reported once per press, not every REPEAT
                    let is_failure = matches!(ev, LiveEvent::CaptureFailed { .. });
                    if !(is_failure && failed) && tx_cap.send(ev).is_err() {
                        return;
                    }
                    failed |= is_failure;
                    // wait for the next capture, but stop right away on release (a new press must not
                    // wait behind this one)
                    let until = Instant::now() + REPEAT;
                    while Instant::now() < until && *held_cap.lock().unwrap() == Some(token) {
                        thread::sleep(Duration::from_millis(50));
                    }
                }
            }
        });
        while let Ok(event) = conn.wait_for_event() {
            match event {
                Event::XinputRawKeyPress(e) if tabs.contains(&(e.detail as u8)) => {
                    let mut h = held.lock().unwrap();
                    if h.is_none() {
                        if counts(game_focus(&conn, root)) {
                            let now = Instant::now();
                            *h = Some(now);
                            let _ = press_tx.send(now);
                            let _ = tx_key.send(LiveEvent::Tab(true));
                        } else {
                            let (reason, window) = focus_of(&conn, root);
                            let _ = tx_key.send(LiveEvent::TabIgnored { reason, window });
                        }
                    }
                }
                Event::XinputRawKeyRelease(e) if tabs.contains(&(e.detail as u8)) => {
                    // only a press we acted on gets a release (no overlay flicker from other apps)
                    let was_held = held.lock().unwrap().take().is_some();
                    if was_held {
                        let _ = tx_key.send(LiveEvent::Tab(false));
                    }
                }
                _ => {} // any other key: ignored, not stored
            }
        }
    });
    Ok(rx)
}

#[cfg(test)]
mod tests {
    use super::is_game_window;

    #[test]
    fn tab_counts_only_when_the_game_has_focus() {
        use super::{Focus, counts};
        assert!(counts(Focus::Game));
        assert!(!counts(Focus::Other));
        // no EWMH information: don't block
        assert!(counts(Focus::Unknown));
    }

    #[test]
    fn recognizes_the_game_window() {
        assert!(is_game_window("steam_app_2357570 steam_app_2357570", ""));
        assert!(is_game_window("", "Overwatch"));
        assert!(is_game_window("", "오버워치"));
        assert!(!is_game_window(
            "firefox Firefox",
            "Overwatch hero stats - Mozilla Firefox"
        ));
        assert!(!is_game_window("pickgak Pickgak", "PickGak overlay"));
        assert!(!is_game_window("org.gnome.Nautilus", "Downloads"));
    }
}
