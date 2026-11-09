"""전장 이미지·등급 엠블럼. 처음 한 번만 받아 로컬에 캐시한다.

출처(맵 id가 넥슨 통계 페이지와 같다):
1) OverFast API https://overfast-api.tekrop.fr/maps: Blizzard 공식 스크린샷
2) counterwatch.gg: 1)에 아직 없는 신규 맵(그림스뵈튼, 네온 교차로 등)
"""

import os
import threading
import time
from pathlib import Path

import httpx

SOURCES = [
    ("https://overfast-api.tekrop.fr/static/maps/{map_id}.jpg", ".jpg"),
    (
        "https://efnrodzdhzvdgmctpjdx.supabase.co/storage/v1/object/public/gd-images/full/overwatch/{map_id}.webp",
        ".webp",
    ),
]
MEDIA_TYPES = {".jpg": "image/jpeg", ".webp": "image/webp"}
# 배포에서는 PICKGAK_CACHE로 데이터 볼륨 안을 가리킨다 (컨테이너를 다시 만들어도 받은 이미지 유지)
CACHE_DIR = Path(os.environ.get("PICKGAK_CACHE") or Path(__file__).resolve().parent.parent / "cache") / "maps"
RETRY_MISSING_AFTER = 6 * 3600  # 원본에 이미지가 없던 맵은 6시간 동안 다시 묻지 않는다
_missing: dict[str, float] = {}
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(map_id: str) -> threading.Lock:
    # 맵마다 따로 잠가서 여러 맵을 동시에 받을 수 있게 (같은 맵은 한 번만)
    with _locks_guard:
        return _locks.setdefault(map_id, threading.Lock())


def _cached(key: str, cache_dir: Path) -> Path | None:
    return next((p for ext in MEDIA_TYPES if (p := cache_dir / f"{key}{ext}").exists()), None)


def _fetch(key: str, cache_dir: Path, sources: list[tuple[str, str]], fmt: dict) -> Path | None:
    """캐시에 있으면 그대로, 없으면 출처를 차례로 시도해 받아 저장. 모두 실패하면 None (잠시 다시 묻지 않음)."""
    if path := _cached(key, cache_dir):
        return path
    miss_key = f"{cache_dir.name}/{key}"
    if time.monotonic() - _missing.get(miss_key, -RETRY_MISSING_AFTER) < RETRY_MISSING_AFTER:
        return None
    with _lock_for(miss_key):
        if path := _cached(key, cache_dir):
            return path
        for url, ext in sources:
            try:
                resp = httpx.get(
                    url.format(**fmt),
                    timeout=15,
                    follow_redirects=True,
                    headers={"User-Agent": "pickgak/0.1 (personal tool)"},
                )
                resp.raise_for_status()
            except httpx.HTTPError:
                continue
            if not resp.headers.get("content-type", "").startswith("image/"):
                continue
            cache_dir.mkdir(parents=True, exist_ok=True)
            path = cache_dir / f"{key}{ext}"
            tmp = path.with_suffix(".part")
            tmp.write_bytes(resp.content)
            tmp.replace(path)
            return path
        _missing[miss_key] = time.monotonic()
        return None


def cached(map_id: str, cache_dir: Path = CACHE_DIR) -> Path | None:
    return _cached(map_id, cache_dir)


def image_path(map_id: str, cache_dir: Path = CACHE_DIR) -> Path | None:
    """전장 이미지 경로 (없으면 받아 온다). 실패하면 None (화면은 무늬로 대신)."""
    return _fetch(map_id, cache_dir, SOURCES, {"map_id": map_id})


# ---- 등급 엠블럼 (출처: owtics.gg 에셋, 게임 공식 엠블럼) ----
RANK_CACHE_DIR = CACHE_DIR.parent / "ranks"
RANK_SOURCES = [("https://assets.owtics.gg/tier/{rank}.webp", ".webp")]
RANKS = ("bronze", "silver", "gold", "platinum", "emerald", "diamond", "master", "grandmaster", "champion")


def rank_image_path(rank: str, cache_dir: Path = RANK_CACHE_DIR) -> Path | None:
    return _fetch(rank, cache_dir, RANK_SOURCES, {"rank": rank}) if rank in RANKS else None


def warm(map_ids: list[str], cache_dir: Path = CACHE_DIR) -> int:
    """아직 없는 맵 이미지를 미리 받아 둔다 (처음 전장 선택을 열 때 기다리지 않게). 받은 개수를 돌려준다."""
    return sum(1 for m in map_ids if not cached(m, cache_dir) and image_path(m, cache_dir))
