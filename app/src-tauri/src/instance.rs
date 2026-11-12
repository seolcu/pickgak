//! One PickGak at a time. A second copy would run a second TAB listener and a second overlay on top of
//! the first, and both would capture every scoreboard. The first copy holds an exclusive lock in its
//! data folder; a later start asks it to show its window and exits.
//!
//! After an update the old copy starts the new one and then exits, so the new one briefly finds the
//! lock taken. `PICKGAK_RESTART` tells it to wait for the lock instead of giving up.

#[cfg(unix)]
use std::path::PathBuf;
use std::time::{Duration, Instant};

/// Set by the updater on the copy it starts.
pub(crate) const RESTART_ENV: &str = "PICKGAK_RESTART";
const IDENTIFIER: &str = "com.seolcu.pickgak";

/// Held for the life of the process; dropping it would release the lock.
pub(crate) struct Instance {
    #[cfg(unix)]
    _lock: std::fs::File,
    #[cfg(unix)]
    socket: PathBuf,
}

/// Tauri's app_data_dir: $XDG_DATA_HOME (or ~/.local/share) plus the identifier. In the Flatpak
/// XDG_DATA_HOME points into ~/.var/app, so each install type locks its own folder.
#[cfg(unix)]
fn data_dir() -> Option<PathBuf> {
    let base = std::env::var_os("XDG_DATA_HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))?;
    Some(base.join(IDENTIFIER))
}

fn wait_limit() -> Duration {
    if std::env::var_os(RESTART_ENV).is_some() {
        Duration::from_secs(20)
    } else {
        Duration::ZERO
    }
}

/// Some(instance) when this is the only copy. None after telling the running copy to show itself;
/// the caller exits. When the lock cannot be set up at all, PickGak starts anyway: a missing data
/// folder must not keep the app from running.
#[cfg(unix)]
pub(crate) fn acquire() -> Option<Option<Instance>> {
    use std::io::Write;
    use std::os::fd::AsRawFd;
    use std::os::unix::net::UnixStream;

    let Some(dir) = data_dir() else {
        return Some(None);
    };
    if std::fs::create_dir_all(&dir).is_err() {
        return Some(None);
    }
    let Ok(file) = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(dir.join("instance.lock"))
    else {
        return Some(None);
    };
    let socket = dir.join("instance.sock");
    let deadline = Instant::now() + wait_limit();
    loop {
        // SAFETY: flock on a descriptor this function owns; the kernel drops the lock when the
        // process ends, however it ends.
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0 {
            return Some(Some(Instance {
                _lock: file,
                socket,
            }));
        }
        if Instant::now() >= deadline {
            break;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    if let Ok(mut s) = UnixStream::connect(&socket) {
        let _ = s.set_write_timeout(Some(Duration::from_secs(1)));
        let _ = s.write_all(b"show\n");
    }
    None
}

#[cfg(windows)]
pub(crate) fn acquire() -> Option<Option<Instance>> {
    use windows_sys::Win32::Foundation::{ERROR_ALREADY_EXISTS, GetLastError};
    use windows_sys::Win32::System::Threading::CreateMutexW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        FindWindowW, SW_RESTORE, SetForegroundWindow, ShowWindow,
    };

    let name: Vec<u16> = format!("Local\\{IDENTIFIER}.instance\0")
        .encode_utf16()
        .collect();
    let deadline = Instant::now() + wait_limit();
    loop {
        // SAFETY: a named mutex with no security attributes. The handle stays open (never closed) for
        // the life of the process; Windows releases it on exit.
        let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
        if handle.is_null() {
            return Some(None);
        }
        // SAFETY: reads this thread's last error right after CreateMutexW.
        if unsafe { GetLastError() } != ERROR_ALREADY_EXISTS {
            return Some(Some(Instance {}));
        }
        // SAFETY: closes the handle CreateMutexW just returned.
        unsafe { windows_sys::Win32::Foundation::CloseHandle(handle) };
        if Instant::now() >= deadline {
            break;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    let title: Vec<u16> = "PickGak\0".encode_utf16().collect();
    // SAFETY: looks up a top-level window by its exact title; both calls accept any handle,
    // including a stale one.
    unsafe {
        let hwnd = FindWindowW(std::ptr::null(), title.as_ptr());
        if !hwnd.is_null() {
            ShowWindow(hwnd, SW_RESTORE);
            SetForegroundWindow(hwnd);
        }
    }
    None
}

impl Instance {
    /// Answer later starts: each connection to the socket shows the main window.
    #[cfg(unix)]
    pub(crate) fn listen(self, app: tauri::AppHandle) {
        use std::io::Read;
        use std::os::unix::net::UnixListener;
        // a socket file left by a copy that crashed; this process holds the lock, so it is stale
        let _ = std::fs::remove_file(&self.socket);
        let Ok(listener) = UnixListener::bind(&self.socket) else {
            std::mem::forget(self);
            return;
        };
        std::thread::spawn(move || {
            let _keep = self;
            for mut stream in listener.incoming().flatten() {
                let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
                let mut buf = [0u8; 16];
                // the message itself carries nothing: any connection means "show yourself"
                let _ = stream.read(&mut buf);
                crate::show_main(&app);
            }
        });
    }

    #[cfg(windows)]
    pub(crate) fn listen(self, _app: tauri::AppHandle) {}
}
