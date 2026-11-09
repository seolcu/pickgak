//! Desktop updates. The server publishes the newest version and its files at /api/app/latest (the same
//! list the download page uses). The app checks that list, and installs the file that matches how it was
//! installed:
//! - rpm/deb: `pkexec dnf/apt install -y <file>` (one polkit prompt), then restart
//! - AppImage: replace the running AppImage file, then restart
//! - Windows (NSIS, per user): run the installer silently after this process exits, then start the new one
//! - Flatpak: the sandbox cannot replace its own package, so the UI gets the `flatpak update` command
//!
//! Nothing is installed without the user pressing the button, only the configured server is asked, and a
//! file is only run when the list gives its SHA-256 and the download matches it.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Deserialize, Serialize, Clone)]
pub struct UpdateFile {
    pub name: String,
    /// "rpm", "deb", "appimage" or "exe"
    pub kind: String,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub sha256: Option<String>,
}

#[derive(Deserialize)]
struct Release {
    version: String,
    #[serde(default)]
    released: String,
    #[serde(default)]
    files: Vec<UpdateFile>,
}

#[derive(Serialize, Clone)]
pub struct UpdateInfo {
    pub current: String,
    pub latest: String,
    pub released: String,
    pub newer: bool,
    /// How this copy was installed: "native", "appimage", "flatpak" or "windows".
    pub install: String,
    /// The package for this install form. None for Flatpak.
    pub file: Option<UpdateFile>,
    /// The command the user runs instead (Flatpak).
    pub command: Option<String>,
}

#[derive(Serialize, Clone)]
struct Progress {
    done: u64,
    total: u64,
    name: String,
}

/// Where the current process runs from. Checked once per call: the sandbox markers and `$APPIMAGE` are
/// fixed for the lifetime of the process.
pub fn install_kind() -> &'static str {
    if cfg!(windows) {
        "windows"
    } else if Path::new("/.flatpak-info").exists() || std::env::var_os("FLATPAK_ID").is_some() {
        "flatpak"
    } else if std::env::var_os("APPIMAGE").is_some() {
        "appimage"
    } else {
        "native"
    }
}

/// "rpm" or "deb", from the distro. Both are installed through pkexec.
fn native_kind() -> &'static str {
    let os = fs::read_to_string("/etc/os-release")
        .unwrap_or_default()
        .to_lowercase();
    if os.contains("debian") || os.contains("ubuntu") || os.contains("linuxmint") {
        "deb"
    } else {
        "rpm"
    }
}

fn wanted_kind(kind: &str) -> Option<&'static str> {
    match kind {
        "windows" => Some("exe"),
        "appimage" => Some("appimage"),
        "native" => Some(native_kind()),
        _ => None,
    }
}

fn pick(kind: &str, files: &[UpdateFile]) -> Option<UpdateFile> {
    let want = wanted_kind(kind)?;
    files.iter().find(|f| f.kind == want).cloned()
}

/// Same rule the server applies to file names (defense in depth: the name goes into a URL and a path).
fn valid_name(name: &str) -> bool {
    if name.len() > 96 || !name.starts_with("PickGak") {
        return false;
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return false;
    }
    matches!(
        name.rsplit_once('.').map(|(_, ext)| ext),
        Some("rpm" | "deb" | "exe" | "AppImage")
    )
}

fn version_tuple(v: &str) -> (u32, u32, u32) {
    let mut it = v.split(['-', '+']).next().unwrap_or("").split('.');
    let part =
        |it: &mut std::str::Split<'_, char>| it.next().and_then(|p| p.parse().ok()).unwrap_or(0);
    (part(&mut it), part(&mut it), part(&mut it))
}

fn is_newer(latest: &str, current: &str) -> bool {
    version_tuple(latest) > version_tuple(current)
}

fn client(secs: u64) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(concat!("PickGak-desktop/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(secs))
        .build()
        .map_err(|_| "update.serverFailed".to_string())
}

fn fetch(c: &reqwest::blocking::Client) -> Result<Release, String> {
    let url = format!("{}/api/app/latest", crate::api::server());
    let resp = c.get(url).send().map_err(|_| "update.serverFailed")?;
    if !resp.status().is_success() {
        return Err("update.serverFailed".into());
    }
    resp.json::<Release>()
        .map_err(|_| "update.serverFailed".into())
}

fn info(release: Release, kind: &str) -> UpdateInfo {
    let file = pick(kind, &release.files);
    UpdateInfo {
        current: env!("CARGO_PKG_VERSION").to_string(),
        newer: is_newer(&release.version, env!("CARGO_PKG_VERSION")),
        latest: release.version,
        released: release.released,
        install: kind.to_string(),
        file,
        command: (kind == "flatpak").then(|| "flatpak update -y com.seolcu.pickgak".to_string()),
    }
}

/// Checks the server. Cheap; the UI calls it at startup and from Settings.
pub fn check() -> Result<UpdateInfo, String> {
    let c = client(15)?;
    let release = fetch(&c)?;
    Ok(info(release, install_kind()))
}

fn download(app: &AppHandle, file: &UpdateFile) -> Result<PathBuf, String> {
    if !valid_name(&file.name) {
        return Err("update.serverFailed".into());
    }
    // a file without a published hash is never run (the published latest.json always has one)
    let want = file
        .sha256
        .as_deref()
        .filter(|h| h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or("update.hashFailed")?;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "update.installFailed")?
        .join("updates");
    fs::create_dir_all(&dir).map_err(|_| "update.installFailed")?;
    let path = dir.join(&file.name);
    let url = format!("{}/api/app/download/{}", crate::api::server(), file.name);
    let c = client(600)?;
    let mut resp = c.get(url).send().map_err(|_| "update.downloadFailed")?;
    if !resp.status().is_success() {
        return Err("update.downloadFailed".into());
    }
    let total = resp.content_length().unwrap_or(file.size);
    let mut out = fs::File::create(&path).map_err(|_| "update.installFailed")?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    let mut done = 0u64;
    loop {
        let n = resp.read(&mut buf).map_err(|_| "update.downloadFailed")?;
        if n == 0 {
            break;
        }
        out.write_all(&buf[..n])
            .map_err(|_| "update.installFailed")?;
        hasher.update(&buf[..n]);
        done += n as u64;
        let _ = app.emit(
            "update://progress",
            Progress {
                done,
                total,
                name: file.name.clone(),
            },
        );
    }
    out.flush().map_err(|_| "update.installFailed")?;
    let got = format!("{:x}", hasher.finalize());
    if !got.eq_ignore_ascii_case(want) {
        let _ = fs::remove_file(&path);
        return Err("update.hashFailed".into());
    }
    Ok(path)
}

fn package_manager() -> Option<&'static str> {
    [
        "/usr/bin/dnf",
        "/bin/dnf",
        "/usr/bin/apt-get",
        "/bin/apt-get",
        "/usr/bin/zypper",
    ]
    .into_iter()
    .find(|p| Path::new(p).exists())
    .map(|p| p.rsplit('/').next().unwrap_or("dnf"))
}

/// The program file after the package manager replaced it. Linux reports the running, now replaced
/// file as "/usr/bin/pickgak (deleted)", which cannot be started; the new file has the old name.
fn installed_exe() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let s = exe.to_str()?;
    Some(PathBuf::from(s.strip_suffix(" (deleted)").unwrap_or(s)))
}

fn install_package(app: &AppHandle, path: &Path) -> Result<(), String> {
    let pm = package_manager().ok_or("update.unsupported")?;
    let status = Command::new("pkexec")
        .arg(pm)
        .args(["install", "-y"])
        .arg(path)
        .status()
        .map_err(|_| "update.installFailed")?;
    if !status.success() {
        // pkexec returns 126 when the dialog is cancelled
        return Err(if status.code() == Some(126) {
            "update.cancelled".into()
        } else {
            "update.installFailed".into()
        });
    }
    if let Some(exe) = installed_exe() {
        let _ = Command::new(exe).spawn();
    }
    app.exit(0);
    Ok(())
}

fn install_appimage(app: &AppHandle, path: &Path) -> Result<(), String> {
    let target = std::env::var_os("APPIMAGE")
        .map(PathBuf::from)
        .ok_or("update.unsupported")?;
    let dir = target.parent().ok_or("update.installFailed")?;
    // copy next to the running file, then rename over it: a rename works while it is running, a copy
    // across file systems into it would not
    let tmp = dir.join(format!(".pickgak-update-{}.AppImage", std::process::id()));
    fs::copy(path, &tmp).map_err(|_| "update.installFailed")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(0o755));
    }
    fs::rename(&tmp, &target).map_err(|_| "update.installFailed")?;
    let _ = Command::new(&target).spawn();
    app.exit(0);
    Ok(())
}

#[cfg(windows)]
fn install_windows(app: &AppHandle, path: &Path) -> Result<(), String> {
    // Wait for this process to exit (Windows keeps the running exe locked), install silently, then start
    // the installed copy. NSIS installs per user under %LOCALAPPDATA%\PickGak.
    let installed = std::env::var_os("LOCALAPPDATA")
        .map(|d| PathBuf::from(d).join("PickGak").join("PickGak.exe"))
        .ok_or("update.installFailed")?;
    // single-quoted PowerShell strings: a quote inside (a user name like O'Brien) is doubled
    let quote = |p: &Path| format!("'{}'", p.display().to_string().replace('\'', "''"));
    let script = format!(
        "Wait-Process -Id {} -ErrorAction SilentlyContinue; Start-Process -FilePath {} -ArgumentList '/S' -Wait; Start-Process -FilePath {}",
        std::process::id(),
        quote(path),
        quote(&installed)
    );
    Command::new("powershell")
        .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &script])
        .spawn()
        .map_err(|_| "update.installFailed")?;
    app.exit(0);
    Ok(())
}

#[cfg(not(windows))]
fn install_windows(_app: &AppHandle, _path: &Path) -> Result<(), String> {
    Err("update.unsupported".into())
}

fn install(app: &AppHandle) -> Result<(), String> {
    let kind = install_kind();
    if kind == "flatpak" {
        // the sandbox cannot replace its own package; the UI shows the command instead
        return Err("update.flatpakHint".into());
    }
    let c = client(15)?;
    let release = fetch(&c)?;
    if !is_newer(&release.version, env!("CARGO_PKG_VERSION")) {
        return Err("update.alreadyLatest".into());
    }
    let file = pick(kind, &release.files).ok_or("update.unsupported")?;
    let path = download(app, &file)?;
    match kind {
        "native" => install_package(app, &path),
        "appimage" => install_appimage(app, &path),
        "windows" => install_windows(app, &path),
        _ => Err("update.unsupported".into()),
    }
}

/// Checks for a newer version. Returns the file for this install form (or the Flatpak command).
#[tauri::command]
pub async fn update_check() -> Result<UpdateInfo, String> {
    tauri::async_runtime::spawn_blocking(check)
        .await
        .map_err(|e| e.to_string())?
}

/// Downloads and installs the newest version, then restarts. Long: progress arrives as
/// `update://progress`.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || install(&handle))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{UpdateFile, is_newer, pick, valid_name, version_tuple};

    #[test]
    fn compares_versions() {
        assert!(is_newer("2.6.0", "2.5.2"));
        assert!(is_newer("2.10.0", "2.9.9"));
        assert!(!is_newer("2.6.0", "2.6.0"));
        assert!(!is_newer("2.5.1", "2.5.2"));
        // alpha tags are not part of the package version
        assert_eq!(version_tuple("2.6.0-alpha.11"), (2, 6, 0));
    }

    #[test]
    fn only_accepts_package_names() {
        assert!(valid_name("PickGak-2.6.0-1.x86_64.rpm"));
        assert!(valid_name("PickGak_2.6.0_amd64.AppImage"));
        assert!(valid_name("PickGak_2.6.0_x64-setup.exe"));
        for bad in [
            "",
            "../secret",
            "PickGak.exe.sh",
            "Other-2.6.0.rpm",
            "PickGak 2.6.0.rpm",
        ] {
            assert!(!valid_name(bad), "{bad}");
        }
    }

    #[test]
    fn picks_the_file_for_the_install_form() {
        let files = vec![
            file("PickGak-2.6.0-1.x86_64.rpm", "rpm"),
            file("PickGak_2.6.0_amd64.deb", "deb"),
            file("PickGak_2.6.0_x64-setup.exe", "exe"),
            file("PickGak_2.6.0_amd64.AppImage", "appimage"),
        ];
        assert_eq!(pick("windows", &files).unwrap().kind, "exe");
        assert_eq!(pick("appimage", &files).unwrap().kind, "appimage");
        assert_eq!(
            pick("native", &files).map(|f| f.kind),
            super::wanted_kind("native").map(str::to_string)
        );
        assert!(pick("flatpak", &files).is_none());
    }

    fn file(name: &str, kind: &str) -> UpdateFile {
        UpdateFile {
            name: name.into(),
            kind: kind.into(),
            size: 0,
            sha256: None,
        }
    }
}
