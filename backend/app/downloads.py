"""데스크톱 앱 내려받기. 파일은 GitHub 릴리스에 있고, 서버는 최신 목록을 알려 주고 내려받기를 그쪽으로 보낸다.

릴리스마다 CI(.github/workflows/release.yml)가 패키지를 올린 뒤 마지막으로 latest.json을 붙인다:

    {"version": "2.5.1", "released": "2026-10-26",
     "files": [{"name": "PickGak-2.5.1-1.x86_64.rpm", "kind": "rpm", "sha256": "..."},
               {"name": "PickGak_2.5.1_x64-setup.exe", "kind": "exe", "sha256": "..."}]}

초안이 아닌 가장 최근 릴리스 중 latest.json이 붙은 것을 쓴다 (올리는 중인 릴리스는 아직 없으니 건너뛴다).
목록에 있고 릴리스에 실제로 붙은, 이름 규칙에 맞는 파일만 내준다. 설치된 앱의 업데이트 확인(/api/app/latest)과
웹의 내려받기 링크(/api/app/download/<name>)가 모두 이걸 쓴다. GitHub API는 익명으로 IP당 시간에 60번이라
몇 분씩 기억해 두고, GitHub에 닿지 않으면 마지막으로 받은 목록을 그대로 쓴다.
"""

import os
import re
import threading
import time

import httpx

NAME = re.compile(r"^PickGak[-_][0-9A-Za-z._-]{1,80}\.(rpm|deb|exe|AppImage)$")
# 허용하는 파일 종류와 그 파일이 설치되는 OS
KINDS = {"rpm": "linux", "deb": "linux", "appimage": "linux", "exe": "windows"}
REPO = os.environ.get("PICKGAK_RELEASES_REPO", "seolcu/pickgak")
TTL = 300

_lock = threading.Lock()
_cache: dict = {"at": 0.0, "value": None}


def get_json(url: str):
    """GitHub에서 JSON 하나 (테스트에서 바꿔 끼운다)."""
    headers = {"User-Agent": "pickgak-server", "Accept": "application/vnd.github+json"}
    with httpx.Client(timeout=10, follow_redirects=True, headers=headers) as c:
        r = c.get(url)
        r.raise_for_status()
        return r.json()


def parse(raw, assets: dict) -> dict | None:
    """latest.json을 릴리스에 실제로 붙은 파일과 맞춰 본다 (잘못됐으면 None). 파일마다 내려받을 주소를 단다."""
    if not isinstance(raw, dict) or not isinstance(raw.get("version"), str):
        return None
    files = []
    for f in raw.get("files", []):
        if not isinstance(f, dict):
            continue
        name, kind = f.get("name"), f.get("kind")
        if not isinstance(name, str) or not NAME.match(name) or kind not in KINDS or name not in assets:
            continue
        files.append(
            {
                "name": name,
                "kind": kind,
                "os": KINDS[kind],
                "size": int(assets[name].get("size") or 0),
                "sha256": f.get("sha256") if isinstance(f.get("sha256"), str) else None,
                "url": assets[name]["browser_download_url"],
            }
        )
    if not files:
        return None
    return {"version": raw["version"][:40], "released": str(raw.get("released", ""))[:40], "files": files}


def fetch() -> dict | None:
    releases = get_json(f"https://api.github.com/repos/{REPO}/releases?per_page=10")
    for rel in releases if isinstance(releases, list) else []:
        if not isinstance(rel, dict) or rel.get("draft"):
            continue
        assets = {
            a["name"]: a
            for a in rel.get("assets", [])
            if isinstance(a, dict) and a.get("state") == "uploaded" and isinstance(a.get("name"), str)
        }
        meta = assets.get("latest.json")
        if meta:
            return parse(get_json(meta["browser_download_url"]), assets)
    return None


def _current() -> dict | None:
    with _lock:
        if _cache["at"] and time.monotonic() - _cache["at"] < TTL:
            return _cache["value"]
        try:
            _cache["value"] = fetch()
        except httpx.HTTPError, ValueError, KeyError:
            pass  # 마지막으로 받은 목록을 그대로 쓴다
        _cache["at"] = time.monotonic()
        return _cache["value"]


def latest() -> dict | None:
    """최신 버전과 파일 목록 (없으면 None). 내려받을 주소는 빼고 내준다."""
    info = _current()
    if info is None:
        return None
    return {**info, "files": [{k: v for k, v in f.items() if k != "url"} for f in info["files"]]}


def download_url(name: str) -> str | None:
    """목록에 있는 파일의 GitHub 주소. 목록에 없는 이름이면 None."""
    info = _current()
    for f in info["files"] if info else []:
        if f["name"] == name:
            return f["url"]
    return None


def reset() -> None:
    """기억해 둔 목록을 비운다 (테스트용)."""
    with _lock:
        _cache.update(at=0.0, value=None)
