"""넥슨 공식 영웅 통계(https://overwatch.nexon.com/hero/rate) 수집기.

페이지는 Nuxt SSR이라 통계가 HTML 안 `__NUXT_DATA__` 스크립트(devalue 직렬화)에 들어 있다.
게임 클라이언트와는 무관한 공개 웹페이지만 읽는다.
"""

import json
import re
import time
from dataclasses import dataclass

import httpx

BASE_URL = "https://overwatch.nexon.com/hero/rate"
USER_AGENT = "pickgak/0.1 (personal stats tool)"

_NUXT_RE = re.compile(r'<script[^>]*id="__NUXT_DATA__"[^>]*>(.*?)</script>', re.S)
_WRAPPERS = {"Reactive", "ShallowReactive", "Ref", "ShallowRef", "EmptyRef", "EmptyShallowRef"}


@dataclass(frozen=True)
class Query:
    region: str = "korea"
    rq: str = "2"  # 0 = 빠른 대전, 2 = 경쟁전 (둘 다 역할 고정)
    rank: str = "all"
    map: str = "all"
    input: str = "pc"

    def params(self) -> dict[str, str]:
        return {**self.__dict__, "role": "all"}


def decode_nuxt_payload(html: str) -> dict:
    """`__NUXT_DATA__`의 devalue 배열을 일반 파이썬 객체로 복원한다."""
    m = _NUXT_RE.search(html)
    if not m:
        raise ValueError("__NUXT_DATA__ not found")
    table = json.loads(m.group(1))
    cache: dict[int, object] = {}

    def ref(i):
        # devalue: 음수는 undefined/NaN 같은 특수값
        if not isinstance(i, int) or isinstance(i, bool) or i < 0:
            return None
        if i not in cache:
            cache[i] = None  # 순환 참조 방지
            cache[i] = node(table[i])
        return cache[i]

    def node(x):
        if isinstance(x, dict):
            return {k: ref(v) for k, v in x.items()}
        if isinstance(x, list):
            if x and isinstance(x[0], str):
                if x[0] in _WRAPPERS:
                    return ref(x[1]) if len(x) > 1 else None
                if x[0] == "Set":
                    return [ref(v) for v in x[1:]]
                if x[0] == "Map":
                    return {ref(k): ref(v) for k, v in zip(x[1::2], x[2::2], strict=False)}
                if x[0] == "Date":
                    return x[1]
            return [ref(v) for v in x]
        return x

    return ref(0)


def _find_state(payload: dict) -> dict:
    """payload 트리에서 hero-rate-list / hero-rate-filters 를 가진 dict를 찾는다."""
    stack = [payload]
    seen = set()
    while stack:
        cur = stack.pop()
        if id(cur) in seen:
            continue
        seen.add(id(cur))
        if isinstance(cur, dict):
            # 같은 키를 가진 상태 dict(pending/error 등)가 여러 개라 실제 데이터가 든 것을 고른다
            lst = cur.get("hero-rate-list")
            if isinstance(lst, dict) and isinstance(lst.get("data"), dict):
                return cur
            stack.extend(cur.values())
        elif isinstance(cur, list):
            stack.extend(cur)
    raise ValueError("hero-rate-list not found in payload")


def _num(v) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def parse_page(html: str) -> dict:
    """HTML → {"heroes": [...], "filters": {...} | None}"""
    state = _find_state(decode_nuxt_payload(html))
    rows = (state["hero-rate-list"] or {}).get("data", {}).get("list", [])
    heroes = [
        {
            "hero_id": h["heroId"],
            "name": h["name"],
            "role": h["role"],
            "subrole": h.get("subrole"),
            "color": h.get("colorCode"),
            "thumbnail": h.get("thumbnailUrl"),
            "win_rate": _num(h.get("winRate")),
            "pick_rate": _num(h.get("pickRate")),
            "ban_rate": _num(h.get("banRate")),
        }
        for h in rows
    ]
    filters = (state.get("hero-rate-filters") or {}).get("data")
    return {"heroes": heroes, "filters": filters}


def fetch(query: Query, client: httpx.Client) -> dict:
    resp = client.get(BASE_URL, params=query.params())
    resp.raise_for_status()
    return parse_page(resp.text)


def map_ids(filters: dict) -> list[str]:
    """필터 목록에서 실제 전장 id만 (모드 그룹 제외)."""
    modes = {m["value"] for m in filters["maps"] if m["parentValue"] == "battlefield"}
    return [m["value"] for m in filters["maps"] if m["parentValue"] in modes]


REGIONS = ("korea", "asia", "americas", "europe")
COMPETITIVE, QUICK = "2", "0"


def iter_queries(filters: dict, regions=("korea",), ranks=("all",), maps=None):
    """수집할 조건 조합. 입력장치는 PC만, 빠른 대전은 등급이 없으므로 ranks에 "all"이 있을 때만 등급 합산으로."""
    maps = maps or ["all", *map_ids(filters)]
    known = {r["value"] for r in filters["ranks"]}
    ranks = [r for r in ranks if r in known]
    for region in regions:
        for rank in ranks:
            for map_ in maps:
                yield Query(region=region, rq=COMPETITIVE, rank=rank, map=map_)
        if "all" in ranks:
            for map_ in maps:
                yield Query(region=region, rq=QUICK, rank="all", map=map_)


def tier_ranks(filters: dict) -> list[str]:
    return [r["value"] for r in filters["ranks"] if r["value"] != "all"]


def collect(on_result, *, regions=("korea",), ranks=("all",), delay: float = 1.0, on_error=None) -> int:
    """조건 조합을 순회하며 수집한다. on_result(query, parsed)를 호출한다.

    ranks에 "tiers"를 넣으면 등급별(all 제외) 전체로 펼친다. 서버 부담을 줄이려고 요청 간 delay초 쉰다.
    한 조합이 실패해도(네트워크, 페이지 구조 변경) on_error(query, exc)만 부르고 나머지는 계속한다.
    """
    with httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=20, follow_redirects=True) as client:
        first = fetch(Query(), client)
        filters = first["filters"]
        if not filters:
            raise ValueError("filters not found in first page")
        expanded = [r for x in ranks for r in (tier_ranks(filters) if x == "tiers" else [x])]
        count = 0
        for i, q in enumerate(iter_queries(filters, regions=regions, ranks=expanded)):
            if q == Query():
                on_result(q, first)
                count += 1
                continue
            if i:
                time.sleep(delay)
            try:
                on_result(q, fetch(q, client))
                count += 1
            except (httpx.HTTPError, ValueError, KeyError) as e:
                if on_error:
                    on_error(q, e)
        return count
