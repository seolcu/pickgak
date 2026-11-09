"""상성 평점 가져오기 (counterwatch.gg, 5v5).

counterwatch는 영웅끼리 맞붙었을 때 누가 킬 교환에서 이기는지(듀얼·한타 데이터)로 상성 평점을 내고,
영웅 자체의 강함은 빼서 '상성'만 남긴다. 0이 대등, +10이면 크게 유리.

자동 수집은 하지 않는다(남의 사이트를 매일 긁지 않도록). 상성은 패치 때나 바뀌므로 가끔 손으로 갱신:

    uv run python -m app.collector.counterwatch      # data/matchups.json 갱신 (영웅 수만큼 요청, 약 1~2분)
"""

import json
import re
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import httpx

URL = "https://www.counterwatch.gg/stats/overwatch/counters/{slug}"
OUT = Path(__file__).resolve().parent.parent.parent / "data" / "matchups.json"
TO_SLUG = {"soldier-76": "soldier76", "jetpack-cat": "jetpackcat"}
FROM_SLUG = {v: k for k, v in TO_SLUG.items()}

# 신뢰도 낮은 평점과 미미한 평점(|r| < MIN_ABS)은 버린다
MIN_ABS = 2.0
KEEP_CONFIDENCE = {"good", "high", "very high"}

_ROW_SPLIT = '<div class="group flex items-stretch'
_SLUG = re.compile(r'href="/stats/overwatch/heroes/([a-z0-9-]+)"')
_RATING = re.compile(r"leading-none[^>]*>([+-]?\d+(?:\.\d+)?)</span>")
# 예: "Very high confidence: 1,564 players". 등급은 두 단어이고 숫자에는 쉼표가 들어간다
_CONF = re.compile(r'title="([A-Za-z ]+?) confidence: ([\d,]+) players')


def parse(page: str, target: str) -> dict[str, float]:
    """한 영웅 페이지 → {상대 영웅: 평점}. 양수면 그 상대가 target에게 유리."""
    out: dict[str, float] = {}
    for block in page.split(_ROW_SPLIT)[1:]:
        block = block.split("</li>", 1)[0]
        s, r, c = _SLUG.search(block), _RATING.search(block), _CONF.search(block)
        if not (s and r and c) or c.group(1).lower() not in KEEP_CONFIDENCE:
            continue
        hero = FROM_SLUG.get(s.group(1), s.group(1))
        rating = float(r.group(1))
        if hero != target and hero not in out and abs(rating) >= MIN_ABS:
            out[hero] = rating
    return out


def fetch_all(hero_ids: list[str], delay: float = 1.5) -> dict[str, dict[str, float]]:
    ratings = {}
    with httpx.Client(headers={"User-Agent": "pickgak/0.1 (personal tool)"}, timeout=30, follow_redirects=True) as c:
        for i, hid in enumerate(hero_ids):
            if i:
                time.sleep(delay)
            resp = c.get(URL.format(slug=TO_SLUG.get(hid, hid)))
            resp.raise_for_status()
            ratings[hid] = parse(resp.text, hid)
            print(f"{i + 1}/{len(hero_ids)} {hid}: {len(ratings[hid])}", file=sys.stderr)
    return ratings


def main():
    from app import db

    ids = [h["hero_id"] for h in db.list_heroes(db.connect())]
    data = {
        "source": "https://www.counterwatch.gg/stats/overwatch/counters (5v5)",
        "fetched_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "note": "ratings[target][counter] = counter가 target 상대로 갖는 상성 평점 (+면 counter 유리, 10 ≈ 크게 유리)",
        "ratings": fetch_all(ids),
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
