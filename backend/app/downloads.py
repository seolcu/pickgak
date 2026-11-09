"""데스크톱 앱 내려받기. 코드 저장소가 비공개라 릴리스 파일을 서버가 직접 내려준다.

파일은 데이터 폴더의 downloads/ (PICKGAK_DOWNLOADS로 바꿀 수 있음)에 두고, 같은 폴더의 latest.json이 목록이다:

    {"version": "2.5.1", "released": "2026-10-26",
     "files": [{"name": "PickGak-2.5.1-1.x86_64.rpm", "kind": "rpm", "size": 7247073, "sha256": "..."},
               {"name": "PickGak_2.5.1_amd64.AppImage", "kind": "appimage", "size": 81234567},
               {"name": "PickGak_2.5.1_x64-setup.exe", "kind": "exe", "size": 7123456}]}

목록에 있는 이름만 내려준다 (경로 조작 차단). 배포할 때 패키지와 함께 목록을 만들어 올린다.
내려받은 앱이 스스로 업데이트할 때도 이 목록을 쓴다 (kind로 설치 형태를 고르고, os는 kind에서 정한다).
"""

import json
import os
import re
from pathlib import Path

from app import db

NAME = re.compile(r"^PickGak[-_][0-9A-Za-z._-]{1,80}\.(rpm|deb|exe|AppImage)$")
# 허용하는 파일 종류와 그 파일이 설치되는 OS
KINDS = {"rpm": "linux", "deb": "linux", "appimage": "linux", "exe": "windows"}


def directory() -> Path:
    env = os.environ.get("PICKGAK_DOWNLOADS")
    if env:
        return Path(env)
    return Path(os.environ.get("PICKGAK_DB", db.DEFAULT_PATH)).resolve().parent / "downloads"


def latest(base: Path | None = None) -> dict | None:
    """올라간 최신 버전 (없거나 잘못됐으면 None). 실제로 있는 파일만 남긴다."""
    base = base or directory()
    try:
        raw = json.loads((base / "latest.json").read_text(encoding="utf-8"))
    except OSError, ValueError:
        return None
    if not isinstance(raw, dict) or not isinstance(raw.get("version"), str):
        return None
    files = []
    for f in raw.get("files", []):
        if not isinstance(f, dict):
            continue
        name, kind = f.get("name"), f.get("kind")
        if not isinstance(name, str) or not NAME.match(name) or kind not in KINDS:
            continue
        path = base / name
        if not path.is_file():
            continue
        files.append(
            {
                "name": name,
                "kind": kind,
                "os": KINDS[kind],
                "size": path.stat().st_size,
                "sha256": f.get("sha256") if isinstance(f.get("sha256"), str) else None,
            }
        )
    if not files:
        return None
    return {"version": raw["version"][:40], "released": str(raw.get("released", ""))[:40], "files": files}


def file_path(name: str, base: Path | None = None) -> Path | None:
    """내려줄 파일 경로. 목록에 있는 이름이 아니면 None."""
    base = base or directory()
    info = latest(base)
    if not info or name not in {f["name"] for f in info["files"]}:
        return None
    return base / name
