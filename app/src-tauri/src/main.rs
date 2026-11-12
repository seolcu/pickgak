// No console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api;
mod instance;
#[cfg(target_os = "linux")]
mod kde_layer;
mod live;
mod ocr;
mod overlay_layout;
mod update;

#[cfg(feature = "tray")]
use tauri::menu::{Menu, MenuItem};
#[cfg(feature = "tray")]
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const OVERLAY: &str = "overlay";
static OVERLAY_ZOOM: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(1.0f64.to_bits());
static OVERLAY_LOCKED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

/// Show the overlay window; on KDE this keeps its place (see kde_layer).
fn show_overlay(w: &tauri::WebviewWindow) -> tauri::Result<()> {
    #[cfg(target_os = "linux")]
    return kde_layer::show(w);
    #[cfg(not(target_os = "linux"))]
    w.show()
}

/// Bring the main window to the front, making it again if it was closed (the app keeps running in the
/// tray with the overlay). Used by the tray and by a second start of PickGak.
pub(crate) fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    if let Some(config) = app.config().app.windows.iter().find(|c| c.label == "main")
        && let Ok(builder) = WebviewWindowBuilder::from_config(app, config)
        && let Ok(w) = builder.build()
    {
        let _ = w.set_focus();
    }
}

fn overlay_window(app: &tauri::AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    if let Some(w) = app.get_webview_window(OVERLAY) {
        return Ok(w);
    }
    let w = WebviewWindowBuilder::new(app, OVERLAY, WebviewUrl::App("index.html?overlay=1".into()))
        .title("PickGak overlay")
        // Until the first capture: the in-match scoreboard at 1920x1080 (see overlay_layout).
        .inner_size(248.0, 480.0)
        .position(20.0, 88.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(true)
        .focused(false)
        .visible(false)
        // Windows: an undecorated window with a shadow gets a 1px white border (and rounded corners
        // on Windows 11). That border stayed visible in "only while TAB" mode.
        .shadow(false)
        .build()?;
    if let Some(monitor) = w.current_monitor()? {
        let size = monitor.size();
        let left = (281.0 * size.height as f64 / 1080.0).round() as u32;
        fit_overlay_to_scoreboard(
            app,
            size.width as usize,
            size.height as usize,
            left as usize,
        );
    }
    Ok(w)
}

/// Fit only full-monitor captures: windowed captures have a different screen origin. Tauri's
/// physical coordinates include the monitor offset; webview zoom cancels desktop DPI scaling.
pub(crate) fn fit_overlay_to_scoreboard(
    app: &tauri::AppHandle,
    width: usize,
    height: usize,
    table_left: usize,
) {
    if !OVERLAY_LOCKED.load(std::sync::atomic::Ordering::Relaxed) {
        return;
    }
    let Some(w) = app.get_webview_window(OVERLAY) else {
        return;
    };
    let Ok(Some(monitor)) = w.current_monitor() else {
        return;
    };
    let ms = monitor.size();
    if (width, height) != (ms.width as usize, ms.height as usize) || table_left >= width {
        return;
    }
    let Some(p) = overlay_layout::beside_scoreboard(ms.height, table_left as u32) else {
        return;
    };
    let Ok(size) = w.inner_size() else { return };
    let Ok(dpi) = w.scale_factor() else { return };
    let origin = monitor.position();
    let position = tauri::PhysicalPosition::new(origin.x + p.x as i32, origin.y + p.y as i32);
    if w.outer_position().ok() != Some(position) {
        let _ = w.set_position(position);
    }
    if size.width != p.width {
        let _ = w.set_size(tauri::PhysicalSize::new(p.width, size.height));
    }
    let zoom = p.scale / dpi;
    if f64::from_bits(OVERLAY_ZOOM.load(std::sync::atomic::Ordering::Relaxed)) != zoom
        && w.set_zoom(zoom).is_ok()
    {
        OVERLAY_ZOOM.store(zoom.to_bits(), std::sync::atomic::Ordering::Relaxed);
    }
}

/// Put the overlay above everything with one Win32 call, without activating it. Tauri's
/// set_always_on_top only talks to the window when the flag actually changes, so it could not move an
/// already-topmost overlay back above a game that had raised itself. SWP_SHOWWINDOW also covers a
/// window that was hidden, and SWP_NOACTIVATE keeps the game focused.
#[cfg(windows)]
fn force_topmost(w: &tauri::WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        HWND_TOPMOST, SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
        SetWindowPos,
    };
    if let Ok(hwnd) = w.hwnd() {
        // SAFETY: the handle belongs to this window; the call only changes its z-order and visibility.
        unsafe {
            SetWindowPos(
                hwnd.0,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_ASYNCWINDOWPOS,
            );
        }
    }
}

/// Re-assert the always-on-top overlay when TAB goes down. On Windows a window can lose its topmost
/// place after the game changes display mode; this never activates the overlay, so the game keeps
/// focus. The overlay is created in setup, so this never creates a window from the capture thread.
pub(crate) fn raise_overlay(app: &tauri::AppHandle) {
    let Some(w) = app.get_webview_window(OVERLAY) else {
        return;
    };
    // show() also records "visible" in Tauri/tao. A raw SetWindowPos alone leaves tao thinking the
    // window is hidden, and the next click-through change (apply_diff) would hide it again.
    if !w.is_visible().unwrap_or(false) {
        let _ = show_overlay(&w);
    }
    #[cfg(windows)]
    force_topmost(&w);
    let _ = w.set_always_on_top(true);
}

/// True when Windows reports a Direct3D full-screen app owning the display. A topmost window cannot be
/// drawn over that, so the debug view can explain a missing overlay instead of leaving it a mystery.
#[cfg(windows)]
pub(crate) fn fullscreen_game() -> bool {
    use windows_sys::Win32::UI::Shell::{
        QUNS_RUNNING_D3D_FULL_SCREEN, SHQueryUserNotificationState,
    };
    let mut state = 0;
    // SAFETY: the API writes one value into the out parameter.
    let hr = unsafe { SHQueryUserNotificationState(&mut state) };
    hr == 0 && state == QUNS_RUNNING_D3D_FULL_SCREEN
}

/// (visible, always on top) for the debug report: if the overlay never shows up, this says whether the
/// window is missing, hidden or just not on top.
pub(crate) fn overlay_state(app: &tauri::AppHandle) -> (bool, bool) {
    match app.get_webview_window(OVERLAY) {
        Some(w) => (
            w.is_visible().unwrap_or(false),
            w.is_always_on_top().unwrap_or(false),
        ),
        None => (false, false),
    }
}

/// Fit the overlay window to its content. The overlay is click-through, so the mouse wheel goes to
/// the game and can never scroll it: whatever it shows has to be inside the window. The height is
/// capped at the rest of the window's monitor.
#[tauri::command]
fn overlay_fit(app: tauri::AppHandle, height: f64) -> Result<(), String> {
    let w = overlay_window(&app).map_err(|e| e.to_string())?;
    let scale = w.scale_factor().map_err(|e| e.to_string())?;
    let size = w.inner_size().map_err(|e| e.to_string())?;
    let current = size.height as f64 / scale;
    let max = w
        .current_monitor()
        .ok()
        .flatten()
        .and_then(|m| w.outer_position().ok().map(|p| (m, p)))
        .map(|(m, p)| {
            let (mp, ms) = (m.position(), m.size());
            (ms.height as f64 - (p.y - mp.y) as f64) / scale - 24.0
        })
        .unwrap_or(1000.0)
        .max(160.0);
    let height = height * f64::from_bits(OVERLAY_ZOOM.load(std::sync::atomic::Ordering::Relaxed));
    let height = height.clamp(80.0, max);
    if (current - height).abs() < 2.0 {
        return Ok(());
    }
    let width = size.width as f64 / scale;
    w.set_size(tauri::LogicalSize::new(width, height))
        .map_err(|e| e.to_string())
}

/// Show/hide the overlay. When locked it ignores the mouse (clicks go to the game).
#[tauri::command]
fn overlay_set(
    app: tauri::AppHandle,
    visible: bool,
    locked: bool,
    asking: Option<bool>,
) -> Result<(), String> {
    let w = overlay_window(&app).map_err(|e| e.to_string())?;
    OVERLAY_LOCKED.store(locked, std::sync::atomic::Ordering::Relaxed);
    if !visible {
        return w.hide().map_err(|e| e.to_string());
    }
    // Show first, on every platform: setting click-through on a window that was never shown panics
    // inside tao on Linux, and on Windows the click-through change rewrites the window style from
    // tao's saved flags. A raw SetWindowPos alone (without this) left those flags at "hidden", so the
    // next set_ignore_cursor_events hid the window again - the overlay stayed invisible.
    // A question on the overlay unlocks it only to take clicks. The window type stays: an unlocked
    // overlay on KDE is a normal window, which the game would cover.
    #[cfg(target_os = "linux")]
    if asking != Some(true) {
        kde_layer::apply(&w, locked);
    }
    #[cfg(not(target_os = "linux"))]
    let _ = asking;
    show_overlay(&w).map_err(|e| e.to_string())?;
    // Raise it above the game too, without activating it.
    #[cfg(windows)]
    force_topmost(&w);
    let _ = w.set_always_on_top(true);
    w.set_ignore_cursor_events(locked)
        .map_err(|e| e.to_string())
}

fn main() {
    // Stay-on-top windows need X11: GNOME on Wayland ignores "always on top" requests from Wayland
    // clients. The game itself also runs on XWayland under Proton.
    #[cfg(target_os = "linux")]
    if std::env::var_os("GDK_BACKEND").is_none() {
        // SAFETY: set before any other thread starts.
        unsafe { std::env::set_var("GDK_BACKEND", "x11") };
    }

    let Some(instance) = instance::acquire() else {
        // another PickGak is running and was asked to show itself
        return;
    };

    tauri::Builder::default()
        .setup(move |app| {
            if let Some(instance) = instance {
                instance.listen(app.handle().clone());
            }
            let state = live::start(app.handle());
            app.manage(state);
            overlay_window(app.handle())?;
            // The overlay is always on (click-through). "Only while TAB" hides its content, not the
            // window, so showing it never takes focus from the game.
            // PICKGAK_OVERLAY=unlocked: start movable (the drag regression test uses this).
            let unlocked = std::env::var("PICKGAK_OVERLAY").as_deref() == Ok("unlocked");
            let _ = overlay_set(app.handle().clone(), true, !unlocked, None);

            #[cfg(feature = "tray")]
            {
                let show = MenuItem::with_id(app, "show", "PickGak", true, None::<&str>)?;
                let overlay = MenuItem::with_id(app, "overlay", "Overlay", true, None::<&str>)?;
                let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show, &overlay, &quit])?;
                TrayIconBuilder::new()
                    .icon(app.default_window_icon().cloned().expect("icon"))
                    .tooltip("PickGak")
                    .menu(&menu)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => show_main(app),
                        "overlay" => {
                            if let Ok(w) = overlay_window(app) {
                                let _ = if w.is_visible().unwrap_or(false) {
                                    w.hide()
                                } else {
                                    show_overlay(&w)
                                };
                            }
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .build(app)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            api::api,
            overlay_set,
            overlay_fit,
            live::live_status,
            live::live_recent,
            live::live_teach,
            live::live_teach_map,
            live::live_set_players,
            live::live_set_maps,
            live::live_confirm_name,
            live::live_reject_name,
            live::live_forget_name,
            live::live_forget_name_template,
            live::live_forget,
            live::live_forget_maps,
            live::live_clear,
            live::live_open_captures,
            update::update_check,
            update::update_install,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PickGak");
}
