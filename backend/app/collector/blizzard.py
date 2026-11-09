"""Blizzard 공식 영웅 통계 페이지에서 다른 언어의 영웅·맵 이름만 가져온다.

통계 자체는 한국 서버 데이터가 있는 넥슨 페이지를 쓰고, 여기서는 이름만 쓴다.
영웅·맵 id는 넥슨 페이지와 같다(2026-10 확인).
"""

import html
import json
import re

import httpx

URL = "https://overwatch.blizzard.com/{locale}/rates/"
_ROWS_RE = re.compile(r'allrows="([^"]*)"')
_MAP_SELECT_RE = re.compile(r'id="filter-map-select">(.*?)</select>', re.S)
_OPTION_RE = re.compile(r'value="([^"]*)"[^>]*>([^<]*)<')


def parse_names(page: str) -> dict[str, dict[str, str]]:
    m = _ROWS_RE.search(page)
    if not m:
        raise ValueError("allrows not found")
    rows = json.loads(html.unescape(m.group(1)))
    heroes = {r["id"]: r["hero"]["name"] for r in rows}
    maps = {}
    sel = _MAP_SELECT_RE.search(page)
    if sel:
        maps = {v: html.unescape(t).strip() for v, t in _OPTION_RE.findall(sel.group(1)) if v != "all-maps"}
    return {"heroes": heroes, "maps": maps}


def fetch_names(locale: str = "en-us", user_agent: str = "pickgak/0.1") -> dict[str, dict[str, str]]:
    resp = httpx.get(URL.format(locale=locale), headers={"User-Agent": user_agent}, timeout=20, follow_redirects=True)
    resp.raise_for_status()
    return parse_names(resp.text)
