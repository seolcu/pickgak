//! KWin keeps the focused full-screen window (the game) in a layer above every "keep above" window,
//! so on KDE Plasma the overlay was drawn under Overwatch. KWin 6.8 layers, bottom to top, read with a
//! KWin script over workspace.stackingOrder (Fedora 45, Plasma 6.8.2, Overwatch full screen on
//! XWayland): normal 2, keep above 3, notification 4, active full screen 5, critical notification 7,
//! on-screen display 8. An X11 window typed _KDE_NET_WM_WINDOW_TYPE_ON_SCREEN_DISPLAY lands in 8,
//! above the game; _NET_WM_WINDOW_TYPE_NOTIFICATION (4) stays under it. Listing both types made KWin
//! fall back to normal, so the property holds one atom.
//!
//! KWin reads the type only when it maps the window, centers an OSD when it maps it, and does not let
//! the user drag one. So the overlay is an OSD only while locked: a change unmaps it, sets the type,
//! maps it again and puts it back where it was. Mutter already keeps the overlay over the game, so
//! this runs only on KDE.

use std::sync::atomic::{AtomicU8, Ordering};

const UNSET: u8 = 0;
const NORMAL: u8 = 1;
const OSD: u8 = 2;
static CURRENT: AtomicU8 = AtomicU8::new(UNSET);

fn on_kde() -> bool {
    std::env::var("XDG_CURRENT_DESKTOP")
        .is_ok_and(|d| d.split(':').any(|p| p.eq_ignore_ascii_case("KDE")))
        && std::env::var("GDK_BACKEND").as_deref() == Ok("x11")
}

pub(crate) fn apply(w: &tauri::WebviewWindow, locked: bool) {
    if !on_kde() {
        return;
    }
    let want = if locked { OSD } else { NORMAL };
    let before = CURRENT.swap(want, Ordering::Relaxed);
    // A new window is a normal one; only an OSD request needs work the first time.
    if before == want || (before == UNSET && want == NORMAL) {
        return;
    }
    let win = w.clone();
    let _ = w.run_on_main_thread(move || {
        if let Err(e) = retype(&win, want == OSD) {
            eprintln!("overlay window type: {e}");
        }
    });
}

fn retype(w: &tauri::WebviewWindow, osd: bool) -> Result<(), String> {
    use gtk::prelude::*;
    use x11rb::protocol::xproto::{AtomEnum, ConnectionExt, PropMode};
    use x11rb::wrapper::ConnectionExt as _;

    let gw = w.gtk_window().map_err(|e| e.to_string())?;
    // The overlay is built hidden, and GTK makes the X window only when it is first realized: do that
    // now, so the type is in place before the first map.
    if gw.window().is_none() {
        gw.realize();
    }
    let gdk_window = gw.window().ok_or("not realized")?;
    let xid = gdk_window
        .downcast::<gdkx11::X11Window>()
        .map_err(|_| "not an X11 window")?
        .xid() as u32;
    let mapped = gw.is_visible();
    let position = w.outer_position().ok();
    if mapped {
        gw.hide();
        // GDK talks to the server on its own connection: make sure the unmap reached it before the
        // type changes, or KWin could see the new type on the still-managed window and ignore it.
        gw.display().sync();
    }
    let (conn, _) = x11rb::connect(None).map_err(|e| e.to_string())?;
    let atom = |name: &str| -> Result<u32, String> {
        Ok(conn
            .intern_atom(false, name.as_bytes())
            .map_err(|e| e.to_string())?
            .reply()
            .map_err(|e| e.to_string())?
            .atom)
    };
    let kind = atom(if osd {
        "_KDE_NET_WM_WINDOW_TYPE_ON_SCREEN_DISPLAY"
    } else {
        "_NET_WM_WINDOW_TYPE_NORMAL"
    })?;
    conn.change_property32(
        PropMode::REPLACE,
        xid,
        atom("_NET_WM_WINDOW_TYPE")?,
        AtomEnum::ATOM,
        &[kind],
    )
    .map_err(|e| e.to_string())?;
    // a round trip: the property is set before GDK maps the window again
    conn.get_input_focus()
        .map_err(|e| e.to_string())?
        .reply()
        .map_err(|e| e.to_string())?;
    drop(conn);
    if mapped {
        gw.show();
        if let Some(p) = position {
            restore_position(w, p);
        }
    }
    Ok(())
}

/// KWin places an OSD itself after it maps it (centered, low on the screen), and a move sent along
/// with the map loses to that placement. Measured on Plasma 6.8.2: a move sent right after show()
/// was overridden, one sent after KWin had managed the window held. So move it back a few times over
/// the first second, until it stays.
fn restore_position(w: &tauri::WebviewWindow, p: tauri::PhysicalPosition<i32>) {
    let w = w.clone();
    std::thread::spawn(move || {
        for delay in [50u64, 150, 300, 500] {
            std::thread::sleep(std::time::Duration::from_millis(delay));
            if w.outer_position().ok() != Some(p) {
                let _ = w.set_position(p);
            }
        }
    });
}

/// Show the overlay where it was. KWin centers an OSD each time it maps one, which put the overlay in
/// the middle of the game after it was hidden and shown again.
pub(crate) fn show(w: &tauri::WebviewWindow) -> tauri::Result<()> {
    let kde = on_kde() && !w.is_visible().unwrap_or(true);
    let position = if kde { w.outer_position().ok() } else { None };
    w.show()?;
    if let Some(p) = position {
        restore_position(w, p);
    }
    Ok(())
}
