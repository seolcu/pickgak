"""검색엔진과 링크 미리보기를 위한 화면 메타데이터.

화면은 브라우저에서 그리므로 index.html에는 내용이 없다. 그래서 백엔드가 주소마다 제목, 설명,
언어별 대체 주소(hreflang), canonical, Open Graph 태그를 index.html에 넣어 보낸다.

- 언어: ?lang=ko|en 이 있으면 그 언어 (그 주소가 canonical), 없으면 Accept-Language로 고른다.
  언어를 고르는 맨 주소는 hreflang x-default이고 canonical을 두지 않는다.
- 없는 주소는 404로 보낸다 (본문은 그대로 앱이라 사람에게는 추천 화면이 보인다).
- 개인 화면(계정, 설정, 친구)은 noindex.
"""

import html
import json
import os
import re
import time
from pathlib import Path

from starlette.datastructures import Headers, QueryParams
from starlette.responses import HTMLResponse, Response
from starlette.types import Scope

from app import db

PUBLIC_URL = os.environ.get("PICKGAK_PUBLIC_URL", "https://pickgak.seolcu.com").rstrip("/")
LANGS = ("ko", "en")
NAME = {"ko": "픽각", "en": "PickGak"}

# 경로 -> 언어별 (제목, 설명)
PAGES: dict[str, dict[str, tuple[str, str]]] = {
    "/": {
        "ko": (
            "픽각 | 오버워치 영웅 픽 추천",
            "적 조합, 맵, 메타, 파티, 선호 영웅을 보고 이번 판에 고를 영웅을 추천합니다. "
            "한국, 아시아, 미주, 유럽 공식 통계를 매일 수집합니다.",
        ),
        "en": (
            "PickGak | Overwatch hero pick helper",
            "Recommends which Overwatch hero to pick this match from the enemy comp, map, meta, party and "
            "your preferred heroes, using official stats for Korea, Asia, the Americas and Europe collected daily.",
        ),
    },
    "/meta": {
        "ko": (
            "오버워치 영웅 티어와 승률 | 픽각",
            "맵과 랭크별 오버워치 영웅의 승률, 픽률, 밴률과 티어를 공식 통계로 보여 줍니다.",
        ),
        "en": (
            "Overwatch hero tier list and win rates | PickGak",
            "Overwatch hero win, pick and ban rates and tiers by map and rank, from official stats.",
        ),
    },
    "/trends": {
        "ko": (
            "오버워치 영웅 승률 추이 | 픽각",
            "오버워치 영웅의 승률과 픽률이 날짜별로 어떻게 바뀌었는지 보여 줍니다.",
        ),
        "en": ("Overwatch hero win rate trends | PickGak", "How Overwatch hero win and pick rates change day by day."),
    },
    "/maps": {
        "ko": (
            "오버워치 맵별 영웅 분석 | 픽각",
            "오버워치 맵마다 승률이 높은 영웅과 조합을 공식 통계로 보여 줍니다.",
        ),
        "en": (
            "Overwatch heroes by map | PickGak",
            "The strongest Overwatch heroes and comps on each map, from official stats.",
        ),
    },
    "/download": {
        "ko": (
            "픽각 데스크톱 앱 다운로드 | 픽각",
            "TAB 점수판을 읽어 적 조합을 자동으로 채우는 픽각 데스크톱 앱을 내려받습니다.",
        ),
        "en": (
            "Download the PickGak desktop app | PickGak",
            "The PickGak desktop app reads the TAB scoreboard and fills in the enemy comp for you.",
        ),
    },
}
PRIVATE = {"/players", "/settings", "/account"}
HERO = {
    "ko": (
        "{name} 카운터, 상성, 승률 | 픽각",
        "오버워치 {name}의 상대 영웅별 상성과 시너지, 맵별 승률을 공식 통계로 보여 줍니다.",
    ),
    "en": (
        "{name} counters, matchups and win rate | PickGak",
        "Overwatch {name}: matchups and synergies against every hero, and win rate by map, from official stats.",
    ),
}

_HERO_PATH = re.compile(r"^/heroes/([a-z0-9-]{1,40})$")
_CACHE_SECONDS = 3600
_hero_cache: dict = {"at": 0.0, "names": {}}


def hero_names(conn) -> dict[str, dict[str, str]]:
    """hero_id -> {lang: 이름}. 영웅 목록은 하루에 한 번 바뀌므로 한 시간 캐시한다."""
    now = time.monotonic()
    if now - _hero_cache["at"] > _CACHE_SECONDS or not _hero_cache["names"]:
        names: dict[str, dict[str, str]] = {}
        for lang in LANGS:
            for h in db.list_heroes(conn, lang):
                names.setdefault(h["hero_id"], {})[lang] = h["name"]
        _hero_cache.update(at=now, names=names)
    return _hero_cache["names"]


def pick_lang(scope: Scope) -> tuple[str, bool]:
    q = QueryParams(scope.get("query_string", b"")).get("lang", "").lower()
    if q in LANGS:
        return q, True
    best, best_q = "en", -1.0
    for part in Headers(scope=scope).get("accept-language", "").split(","):
        tag, _, params = part.strip().partition(";")
        prim = tag.strip().lower().split("-")[0]
        try:
            weight = float(params.strip()[2:]) if params.strip().startswith("q=") else 1.0
        except ValueError:
            weight = 0.0
        if prim in LANGS and weight > best_q:
            best, best_q = prim, weight
    return best, False


def page_info(path: str, lang: str, conn) -> tuple[int, str, str, bool]:
    """(상태 코드, 제목, 설명, 색인 허용)"""
    path = path.rstrip("/") or "/"
    if path in PAGES:
        title, desc = PAGES[path][lang]
        return 200, title, desc, True
    if path in PRIVATE:
        return 200, NAME[lang], PAGES["/"][lang][1], False
    if m := _HERO_PATH.match(path):
        name = hero_names(conn).get(m.group(1), {}).get(lang)
        if name:
            title, desc = HERO[lang]
            return 200, title.format(name=name), desc.format(name=name), True
    return 404, NAME[lang], PAGES["/"][lang][1], False


def head_tags(path: str, lang: str, explicit: bool, title: str, desc: str, index: bool) -> str:
    e = html.escape
    path = path.rstrip("/") or "/"
    url = PUBLIC_URL + path
    tags = [
        f"<title>{e(title)}</title>",
        f'<meta name="description" content="{e(desc)}" />',
    ]
    if not index:
        tags.append('<meta name="robots" content="noindex" />')
    else:
        for alt in LANGS:
            tags.append(f'<link rel="alternate" hreflang="{alt}" href="{e(url)}?lang={alt}" />')
        tags.append(f'<link rel="alternate" hreflang="x-default" href="{e(url)}" />')
        if explicit:
            tags.append(f'<link rel="canonical" href="{e(url)}?lang={lang}" />')
    tags += [
        '<meta property="og:type" content="website" />',
        f'<meta property="og:site_name" content="{NAME[lang]}" />',
        f'<meta property="og:locale" content="{"ko_KR" if lang == "ko" else "en_US"}" />',
        f'<meta property="og:title" content="{e(title)}" />',
        f'<meta property="og:description" content="{e(desc)}" />',
        f'<meta property="og:url" content="{e(url)}{f"?lang={lang}" if explicit else ""}" />',
        f'<meta property="og:image" content="{PUBLIC_URL}/icon-512.png" />',
        '<meta name="twitter:card" content="summary" />',
    ]
    if path == "/" and index:
        ld = {
            "@context": "https://schema.org",
            "@type": "WebApplication",
            "name": "PickGak",
            "alternateName": "픽각",
            "url": PUBLIC_URL + "/",
            "applicationCategory": "GameApplication",
            "operatingSystem": "Web, Windows, Linux",
            "description": desc,
            "inLanguage": list(LANGS),
            "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
            "sameAs": "https://github.com/seolcu/pickgak",
        }
        # </script> 가 나오지 않게 < 를 이스케이프한다
        tags.append(
            '<script type="application/ld+json">'
            + json.dumps(ld, ensure_ascii=False).replace("<", "\\u003c")
            + "</script>"
        )
    return "\n    ".join(tags)


class PageRenderer:
    """index.html에 주소별 메타데이터를 넣어 보낸다."""

    def __init__(self, index_html: Path):
        self.template = index_html.read_text(encoding="utf-8")
        if "<title>PickGak</title>" not in self.template:
            raise RuntimeError("index.html has no <title>PickGak</title> placeholder")

    def render(self, scope: Scope, path: str, conn) -> Response:
        lang, explicit = pick_lang(scope)
        status, title, desc, index = page_info(path, lang, conn)
        body = self.template.replace("<title>PickGak</title>", head_tags(path, lang, explicit, title, desc, index), 1)
        body = body.replace('<html lang="en">', f'<html lang="{lang}">', 1)
        return HTMLResponse(
            body,
            status_code=status,
            headers={"Cache-Control": "no-cache", "Content-Language": lang, "Vary": "Accept-Language"},
        )


def robots_txt() -> str:
    lines = ["User-agent: *", "Disallow: /api/"]
    lines += [f"Disallow: {p}" for p in sorted(PRIVATE)]
    lines += ["", f"Sitemap: {PUBLIC_URL}/sitemap.xml", ""]
    return "\n".join(lines)


def sitemap_xml(conn) -> str:
    paths = list(PAGES) + [f"/heroes/{h}" for h in sorted(hero_names(conn))]
    out = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ]
    for p in paths:
        url = html.escape(PUBLIC_URL + p)
        alts = "".join(f'<xhtml:link rel="alternate" hreflang="{a}" href="{url}?lang={a}"/>' for a in LANGS)
        alts += f'<xhtml:link rel="alternate" hreflang="x-default" href="{url}"/>'
        for lang in LANGS:
            out.append(f"<url><loc>{url}?lang={lang}</loc>{alts}</url>")
    out.append("</urlset>")
    return "\n".join(out) + "\n"
