//! Calls to the PickGak API from Rust, so the webview needs no CORS and sends no cross-site Origin.
//! Only paths under /api on the configured server are allowed (checked on the parsed URL, see `api_url`).
//!
//! The account session is a cookie. The jar is saved in the app data folder, so an app update (which
//! restarts the process) does not log the user out.

use std::fs;
use std::io::{BufReader, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use reqwest_cookie_store::CookieStoreMutex;
use serde::Serialize;
use tauri::Manager;

pub const SERVER: &str = "https://pickgak.seolcu.com";

struct Client {
    http: reqwest::Client,
    jar: Arc<CookieStoreMutex>,
    /// None when the app data folder is not available (cookies then live in memory only).
    path: Option<PathBuf>,
    /// The jar as last written. Requests run concurrently; this lock also keeps two saves from
    /// writing the file at the same time.
    saved: Mutex<Vec<u8>>,
}

fn client(app: &tauri::AppHandle) -> &'static Client {
    static C: OnceLock<Client> = OnceLock::new();
    C.get_or_init(|| {
        let path = app
            .path()
            .app_data_dir()
            .ok()
            .map(|dir| dir.join("cookies.json"));
        let store = path
            .as_ref()
            .and_then(|p| fs::File::open(p).ok())
            .and_then(|f| cookie_store::serde::json::load(BufReader::new(f)).ok())
            .unwrap_or_default();
        let jar = Arc::new(CookieStoreMutex::new(store));
        let http = reqwest::Client::builder()
            .cookie_provider(jar.clone())
            .user_agent(concat!("PickGak-desktop/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(20))
            .build()
            .expect("http client");
        Client {
            http,
            jar,
            path,
            saved: Mutex::new(Vec::new()),
        }
    })
}

/// Writes the cookie jar (session token) to the app data folder, readable only by this user. Only when
/// it changed, and through a temporary file, so a crash or a concurrent request never leaves a
/// truncated jar (which would log the user out).
fn save(c: &Client) {
    let Some(path) = &c.path else { return };
    let mut json = Vec::new();
    match c.jar.lock() {
        Ok(store) => {
            if cookie_store::serde::json::save(&store, &mut json).is_err() {
                return;
            }
        }
        Err(_) => return,
    }
    let Ok(mut saved) = c.saved.lock() else {
        return;
    };
    if *saved == json {
        return;
    }
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let tmp = path.with_extension("tmp");
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let written = opts.open(&tmp).and_then(|mut f| {
        f.write_all(&json)?;
        f.sync_all()
    });
    if written.is_ok() && fs::rename(&tmp, path).is_ok() {
        *saved = json;
    }
}

#[derive(Serialize)]
pub struct ApiResponse {
    status: u16,
    body: String,
}

pub(crate) fn server() -> String {
    std::env::var("PICKGAK_SERVER").unwrap_or_else(|_| SERVER.to_string())
}

/// The URL for an /api path, or None when it would leave /api on the server. The parsed URL is checked,
/// not the raw string: URL parsing resolves percent-encoded dot segments ("/%2e%2e/"), which a plain
/// `contains("..")` lets through.
fn api_url(server: &str, path: &str) -> Option<reqwest::Url> {
    if !path.starts_with('/') || path.contains("..") || path.contains("://") || path.contains('\\')
    {
        return None;
    }
    let base = reqwest::Url::parse(server).ok()?;
    let url = reqwest::Url::parse(&format!("{server}/api{path}")).ok()?;
    let same_origin = url.origin() == base.origin();
    (same_origin && url.path().starts_with("/api/")).then_some(url)
}

#[tauri::command]
pub async fn api(
    app: tauri::AppHandle,
    method: String,
    path: String,
    body: Option<String>,
) -> Result<ApiResponse, String> {
    let url = api_url(&server(), &path).ok_or("bad path")?;
    let c = client(&app);
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| "bad method")?;
    let mut req = c.http.request(method, url);
    if let Some(b) = body {
        req = req.header("Content-Type", "application/json").body(b);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    // login/logout and session refreshes change the jar; keep it for the next launch
    save(c);
    Ok(ApiResponse { status, body })
}

#[cfg(test)]
mod tests {
    use super::api_url;

    const S: &str = "https://pickgak.seolcu.com";

    #[test]
    fn stays_under_api() {
        assert_eq!(
            api_url(S, "/players?x=1").unwrap().as_str(),
            "https://pickgak.seolcu.com/api/players?x=1"
        );
        for bad in [
            "players",
            "/../x",
            "/%2e%2e/x",
            "/%2E%2E/%2e%2e/x",
            "/.%2e/x",
            "\\..\\x",
            "@evil.example/x",
            "/x://y",
        ] {
            assert!(api_url(S, bad).is_none(), "{bad}");
        }
    }
}
