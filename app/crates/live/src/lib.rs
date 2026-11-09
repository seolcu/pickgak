//! TAB-triggered capture of the game window. Observes TAB and copies the game's pixels while it is held.
//!
//! - Linux: X11 / XWayland (the game runs on XWayland under Proton). See `x11`.
//! - Windows: a low-level keyboard hook and Windows Graphics Capture. See `windows`.
//!
//! In both backends only TAB is looked at, the key is never swallowed, and nothing runs between TAB
//! presses. Nothing touches the game process.

use std::time::{Duration, Instant};

#[cfg(target_os = "linux")]
mod x11;
#[cfg(target_os = "linux")]
pub use x11::start;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::start;

/// Wait this long after TAB goes down before capturing (the scoreboard fades in).
/// Windows needs a little longer (Windows Graphics Capture also adds a frame or two).
#[cfg(windows)]
pub const HOLD: Duration = Duration::from_millis(600);
#[cfg(not(windows))]
pub const HOLD: Duration = Duration::from_millis(300);
/// While TAB stays held, capture again this often (someone may swap heroes while you watch).
pub const REPEAT: Duration = Duration::from_millis(1500);
/// A press longer than this is treated as stuck.
pub const MAX_HOLD: Duration = Duration::from_secs(120);
/// How long the same TAB press keeps taking frames until the scoreboard is actually in one. Windows
/// Graphics Capture can also hand back a frame from just before TAB; the scoreboard fades in, and a
/// scoreboard never appears at all if the player lets go too early. 3 s was enough on a real capture.
pub const BOARD_WAIT: Duration = Duration::from_secs(3);

/// Why a TAB press produced no reading. The debug view translates these exact strings.
pub const WHY_RELEASED: &str = "released before the scoreboard";
/// See [`WHY_RELEASED`].
pub const WHY_NO_BOARD: &str = "scoreboard not visible";

/// What to do with a frame taken while waiting for the scoreboard.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameVerdict {
    /// The frame shows the scoreboard: it may become a reading.
    Accept,
    /// Not the scoreboard yet and the same press is still held: take another frame.
    Retry,
    /// Give up. The string is what the debug view shows.
    GiveUp(&'static str),
}

/// Decides which captured frame may become a reading.
///
/// A gameplay frame is never accepted: holding TAB is not enough, the scoreboard has to be in the
/// image. That also covers a frame taken after TAB went up, when the game has already gone back to
/// gameplay. The wait starts with the first rejected frame and ends with [`BOARD_WAIT`] or the press.
#[derive(Debug, Default)]
pub struct BoardWait {
    started: Option<Instant>,
}

impl BoardWait {
    /// `held`: the same TAB press is still down. `board`: the frame contains a scoreboard.
    pub fn verdict(&mut self, now: Instant, held: bool, board: bool) -> FrameVerdict {
        if board {
            return FrameVerdict::Accept;
        }
        if !held {
            return FrameVerdict::GiveUp(WHY_RELEASED);
        }
        let started = *self.started.get_or_insert(now);
        if now.duration_since(started) >= BOARD_WAIT {
            return FrameVerdict::GiveUp(WHY_NO_BOARD);
        }
        FrameVerdict::Retry
    }
}

#[cfg(test)]
mod timing_tests {
    use super::*;

    fn at(base: Instant, ms: u64) -> Instant {
        base + Duration::from_millis(ms)
    }

    #[test]
    fn a_frame_with_the_scoreboard_is_accepted_straight_away() {
        let t = Instant::now();
        assert_eq!(
            BoardWait::default().verdict(t, true, true),
            FrameVerdict::Accept
        );
    }

    #[test]
    fn a_gameplay_frame_is_never_accepted_even_after_a_long_hold() {
        let t = Instant::now();
        let mut w = BoardWait::default();
        // every frame while the scoreboard is missing is rejected, no matter how many there are
        for ms in [0, 200, 600, 1500, 2900] {
            assert_eq!(w.verdict(at(t, ms), true, false), FrameVerdict::Retry);
        }
        assert_eq!(
            w.verdict(at(t, 3000), true, false),
            FrameVerdict::GiveUp(WHY_NO_BOARD)
        );
    }

    #[test]
    fn waits_for_the_fade_in_and_takes_the_first_scoreboard_frame() {
        let t = Instant::now();
        let mut w = BoardWait::default();
        assert_eq!(w.verdict(at(t, 0), true, false), FrameVerdict::Retry);
        assert_eq!(w.verdict(at(t, 400), true, false), FrameVerdict::Retry);
        assert_eq!(w.verdict(at(t, 800), true, true), FrameVerdict::Accept);
    }

    #[test]
    fn a_frame_taken_after_tab_went_up_is_not_a_reading() {
        let t = Instant::now();
        // the frame arrived after release and no longer shows the scoreboard: drop it, don't retry
        assert_eq!(
            BoardWait::default().verdict(t, false, false),
            FrameVerdict::GiveUp(WHY_RELEASED)
        );
    }

    #[test]
    fn a_scoreboard_frame_is_kept_even_if_tab_just_went_up() {
        let t = Instant::now();
        let mut w = BoardWait::default();
        assert_eq!(w.verdict(at(t, 0), true, false), FrameVerdict::Retry);
        // releasing does not throw away a frame that really is the scoreboard
        assert_eq!(w.verdict(at(t, 300), false, true), FrameVerdict::Accept);
    }
}

#[derive(Debug)]
pub enum LiveEvent {
    /// TAB was held long enough and the game window was captured (RGBA).
    Capture {
        rgba: Vec<u8>,
        width: usize,
        height: usize,
        grab: Duration,
        window: String,
    },
    /// TAB was held but no game window was found or the grab failed. `focus` is the window that had
    /// focus when the game window wasn't found, for the debug log.
    CaptureFailed { why: String, focus: Option<String> },
    /// TAB went down (true) or up (false), sent right away (for an overlay shown only while TAB is held).
    Tab(bool),
    /// TAB went down but didn't count, because this had focus (for the debug log).
    TabIgnored {
        reason: FocusReason,
        window: Option<String>,
    },
}

/// Why a TAB press didn't count, for the debug log. The UI translates it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FocusReason {
    /// Another window had focus.
    Other,
    /// No X window has focus (a Wayland-native window does). Linux only.
    Wayland,
    /// The window manager gives no `_NET_ACTIVE_WINDOW` at all. Linux only.
    NoEwmh,
}

pub type Error = Box<dyn std::error::Error + Send + Sync>;

/// TAB capture is only implemented for Linux (X11) and Windows. Other targets build but capture nothing.
#[cfg(not(any(target_os = "linux", windows)))]
pub fn start() -> Result<std::sync::mpsc::Receiver<LiveEvent>, Error> {
    Err("TAB capture is only supported on Linux (X11) and Windows".into())
}
