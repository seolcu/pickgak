//! Windows backend: a low-level keyboard hook for TAB (observe only, the key still reaches the game) and
//! Windows Graphics Capture of the game window (through `xcap`).
//!
//! Only TAB is looked at: every other key is dropped inside the hook and never stored. Nothing runs
//! between TAB presses.

use std::sync::mpsc::{Receiver, Sender, channel};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use pickgak_vision::{Frame, detect_scoreboard};
use windows_sys::Win32::Foundation::{CloseHandle, HWND};
use windows_sys::Win32::System::Threading::{
    OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::VK_TAB;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetForegroundWindow, GetMessageW, GetWindowTextW,
    GetWindowThreadProcessId, KBDLLHOOKSTRUCT, SetWindowsHookExW, TranslateMessage,
    UnhookWindowsHookEx, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
};
use xcap::Window;

use super::{
    BoardWait, Error, FocusReason, FrameVerdict, HOLD, LiveEvent, MAX_HOLD, REPEAT, WHY_RELEASED,
};

/// TAB down/up from the hook. Only TAB is ever sent.
static HOOK_TX: OnceLock<Mutex<Sender<bool>>> = OnceLock::new();

unsafe extern "system" fn hook_proc(code: i32, wparam: usize, lparam: isize) -> isize {
    if code >= 0 {
        // SAFETY: WH_KEYBOARD_LL always hands over a KBDLLHOOKSTRUCT.
        let kb = unsafe { &*(lparam as *const KBDLLHOOKSTRUCT) };
        if kb.vkCode == VK_TAB as u32 {
            let msg = wparam as u32;
            let key = match msg {
                WM_KEYDOWN | WM_SYSKEYDOWN => Some(true),
                WM_KEYUP | WM_SYSKEYUP => Some(false),
                _ => None,
            };
            if let (Some(down), Some(tx)) = (key, HOOK_TX.get()) {
                if let Ok(tx) = tx.lock() {
                    let _ = tx.send(down);
                }
            }
        }
    }
    // Always pass the event on: TAB keeps reaching the game.
    // SAFETY: the arguments are the ones Windows gave us, unchanged.
    unsafe { CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam) }
}

/// Overwatch's process name. Matched case-insensitively; the launcher and chance windows don't count.
fn is_game(app: &str) -> bool {
    app.eq_ignore_ascii_case("Overwatch.exe") || app.eq_ignore_ascii_case("Overwatch")
}

fn process_name(pid: u32) -> Option<String> {
    // SAFETY: the handle is closed before returning; the buffer is owned by this frame.
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return None;
        }
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut len) != 0;
        CloseHandle(handle);
        if !ok {
            return None;
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        Some(path.rsplit('\\').next().unwrap_or(&path).to_string())
    }
}

fn window_title(hwnd: HWND) -> String {
    // SAFETY: buf is a valid, writable UTF-16 buffer.
    unsafe {
        let mut buf = [0u16; 512];
        let len = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        if len <= 0 {
            String::new()
        } else {
            String::from_utf16_lossy(&buf[..len as usize])
        }
    }
}

/// The process and title of the foreground window.
fn foreground() -> Option<(String, String)> {
    // SAFETY: GetForegroundWindow returns a window that may be null; the pid lookup is read-only.
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return None;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 {
            return None;
        }
        Some((process_name(pid)?, window_title(hwnd)))
    }
}

fn game_in_foreground() -> bool {
    foreground().is_some_and(|(app, _)| is_game(&app))
}

fn focus_description() -> Option<String> {
    foreground().map(|(app, title)| format!("{app} | {title}"))
}

/// The largest visible Overwatch window. xcap's `app_name` is the exe's version-info description
/// ("Overwatch", a localized name, ...), not the file name, so ask Windows for the process name of the
/// window's PID instead. The title is only a last resort.
fn find_game_window() -> Option<Window> {
    let windows = Window::all().ok()?;
    windows
        .into_iter()
        .filter(|w| !w.is_minimized().unwrap_or(false))
        .filter(|w| {
            if let Some(exe) = w.pid().ok().and_then(process_name) {
                return is_game(&exe);
            }
            let app = w.app_name().unwrap_or_default();
            let title = w.title().unwrap_or_default();
            app.to_lowercase().contains("overwatch")
                || matches!(title.trim(), "Overwatch" | "오버워치")
        })
        .max_by_key(|w| w.width().unwrap_or(0) as u64 * w.height().unwrap_or(0) as u64)
}

fn describe(w: &Window) -> String {
    format!(
        "{} | {}",
        w.app_name().unwrap_or_default(),
        w.title().unwrap_or_default()
    )
}

fn capture(w: &Window) -> Result<(Vec<u8>, usize, usize), Error> {
    let img = w.capture_image().map_err(|e| e.to_string())?;
    let (width, height) = (img.width() as usize, img.height() as usize);
    Ok((img.into_raw(), width, height))
}

/// Installs the hook, then runs its message loop until the thread ends. Reports readiness first, so
/// `start` can fail loudly when the hook cannot be installed.
fn hook_loop(key_tx: Sender<bool>, ready: Sender<Result<(), String>>) {
    if HOOK_TX.set(Mutex::new(key_tx)).is_err() {
        let _ = ready.send(Err("TAB capture is already running".into()));
        return;
    }
    // SAFETY: the hook stays installed for the life of the thread and is removed before it ends.
    unsafe {
        let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), std::ptr::null_mut(), 0);
        if hook.is_null() {
            let _ = ready.send(Err("could not install the keyboard hook".into()));
            return;
        }
        let _ = ready.send(Ok(()));
        let mut msg = std::mem::zeroed();
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        UnhookWindowsHookEx(hook);
    }
}

/// The scoreboard fades in after TAB, and Windows Graphics Capture can hand back a frame from just
/// before it. Keep taking frames while the *same* TAB press is down, until the scoreboard is actually
/// in one, and never emit the gameplay frame. [`BoardWait`] holds the timing rule and is unit tested;
/// this function only feeds it frames.
fn capture_board(held: &Arc<Mutex<Option<Instant>>>, token: Instant) -> LiveEvent {
    let mut wait = BoardWait::default();
    // Looked up once per capture: listing every window and asking each one's process name is the
    // expensive part, and the game window does not change between retries of the same press.
    let Some(w) = find_game_window() else {
        return LiveEvent::CaptureFailed {
            why: "game window not found".into(),
            focus: focus_description(),
        };
    };
    loop {
        // Before grabbing: TAB already up means the scoreboard is fading out, so don't take the frame.
        if *held.lock().unwrap() != Some(token) {
            return LiveEvent::CaptureFailed {
                why: WHY_RELEASED.into(),
                focus: None,
            };
        }
        let t0 = Instant::now();
        let (rgba, width, height) = match capture(&w) {
            Ok(frame) => frame,
            Err(e) => {
                return LiveEvent::CaptureFailed {
                    why: e.to_string(),
                    focus: None,
                };
            }
        };
        let board = detect_scoreboard(&Frame {
            data: &rgba,
            width,
            height,
        })
        .is_some();
        // The capture itself can take longer than a key press; the verdict looks at the press again.
        let held_now = *held.lock().unwrap() == Some(token);
        match wait.verdict(Instant::now(), held_now, board) {
            FrameVerdict::Accept => {
                return LiveEvent::Capture {
                    rgba,
                    width,
                    height,
                    grab: t0.elapsed(),
                    window: describe(&w),
                };
            }
            FrameVerdict::GiveUp(why) => {
                return LiveEvent::CaptureFailed {
                    why: why.into(),
                    focus: None,
                };
            }
            // Still fading in: retry, but wake right away when TAB goes up.
            FrameVerdict::Retry => {
                for _ in 0..8 {
                    if *held.lock().unwrap() != Some(token) {
                        break;
                    }
                    thread::sleep(Duration::from_millis(15));
                }
            }
        }
    }
}

/// Starts watching TAB. Events arrive on the returned channel; the hook and capture run on their own
/// threads and idle between presses.
pub fn start() -> Result<Receiver<LiveEvent>, Error> {
    let (tx, rx) = channel();
    let (key_tx, key_rx) = channel::<bool>();
    let (press_tx, press_rx) = channel::<Instant>();
    let held = Arc::new(Mutex::new(None::<Instant>));

    // Hook thread: install first, then run the message loop.
    let (ready_tx, ready_rx) = channel::<Result<(), String>>();
    thread::spawn(move || hook_loop(key_tx, ready_tx));
    match ready_rx.recv() {
        Ok(Ok(())) => {}
        Ok(Err(e)) => return Err(e.into()),
        Err(e) => return Err(e.into()),
    }

    // Capture thread: one capture after HOLD, then every REPEAT while the same press lasts.
    let held_cap = held.clone();
    let tx_cap = tx.clone();
    thread::spawn(move || {
        for token in press_rx {
            // Sleep until HOLD after *this* press, and wake up when it is released: a quick tap then a
            // new press must not make the new press wait for the old one's delay. Never grab on a press
            // that already ended.
            let deadline = token + HOLD;
            while Instant::now() < deadline {
                if *held_cap.lock().unwrap() != Some(token) {
                    break;
                }
                let left = deadline.saturating_duration_since(Instant::now());
                thread::sleep(left.min(Duration::from_millis(20)));
            }
            if *held_cap.lock().unwrap() != Some(token) {
                continue;
            }
            let mut failed = false;
            while *held_cap.lock().unwrap() == Some(token) {
                // the game lost focus, or the press is implausibly long
                if !game_in_foreground() || token.elapsed() > MAX_HOLD {
                    let mut h = held_cap.lock().unwrap();
                    if *h == Some(token) {
                        *h = None;
                        let _ = tx_cap.send(LiveEvent::Tab(false));
                    }
                    break;
                }
                let ev = capture_board(&held_cap, token);
                // a failure (game minimized...) is reported once per press, not every REPEAT
                let is_failure = matches!(ev, LiveEvent::CaptureFailed { .. });
                if !(is_failure && failed) && tx_cap.send(ev).is_err() {
                    return;
                }
                failed |= is_failure;
                let until = Instant::now() + REPEAT;
                while Instant::now() < until && *held_cap.lock().unwrap() == Some(token) {
                    thread::sleep(Duration::from_millis(50));
                }
            }
        }
    });

    // Key thread: TAB presses that didn't count are reported with what had focus instead.
    thread::spawn(move || {
        for down in key_rx {
            if down {
                let mut h = held.lock().unwrap();
                if h.is_none() {
                    if game_in_foreground() {
                        let now = Instant::now();
                        *h = Some(now);
                        let _ = press_tx.send(now);
                        let _ = tx.send(LiveEvent::Tab(true));
                    } else {
                        let _ = tx.send(LiveEvent::TabIgnored {
                            reason: FocusReason::Other,
                            window: focus_description(),
                        });
                    }
                }
            } else if held.lock().unwrap().take().is_some() {
                let _ = tx.send(LiveEvent::Tab(false));
            }
        }
    });
    Ok(rx)
}
