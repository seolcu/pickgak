import json
import re
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import db, seo
from app.collector import nexon

INDEX = (Path(__file__).parents[2] / "frontend" / "index.html").read_text(encoding="utf-8")


@pytest.fixture
def site(parsed, tmp_path):
    """빌드된 화면 대신 실제 frontend/index.html 하나만 둔 정적 폴더로 SpaFiles를 띄운다."""
    path = tmp_path / "seo.db"
    conn = db.connect(path)
    db.save_snapshot(conn, nexon.Query(), parsed["heroes"], fetched_at="2026-10-24T00:00:00+00:00")
    conn.close()
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text(INDEX, encoding="utf-8")
    (static / "icon-512.png").write_bytes(b"png")
    seo._hero_cache.update(at=0.0, names={})

    from app.main import SpaFiles

    app = FastAPI()
    app.state.db = db.ThreadConnections(path)
    app.mount("/", SpaFiles(directory=static, html=True))
    with TestClient(app) as c:
        c.hero = parsed["heroes"][0]["hero_id"]
        yield c
    app.state.db.close_all()


def test_pages_carry_language_and_metadata(site):
    r = site.get("/meta?lang=ko")
    assert r.status_code == 200 and r.headers["content-language"] == "ko"
    assert '<html lang="ko">' in r.text
    assert "<title>오버워치 영웅 티어와 승률 | 픽각</title>" in r.text
    assert '<link rel="canonical" href="https://pickgak.seolcu.com/meta?lang=ko" />' in r.text
    assert 'hreflang="x-default" href="https://pickgak.seolcu.com/meta"' in r.text
    assert r.text.count("<title>") == 1

    # 맨 주소는 Accept-Language로 고르고 canonical을 두지 않는다
    r = site.get("/meta", headers={"Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8"})
    assert r.headers["content-language"] == "ko" and 'rel="canonical"' not in r.text
    r = site.get("/meta", headers={"Accept-Language": "fr-FR"})
    assert r.headers["content-language"] == "en"


def test_hero_pages_use_hero_names_and_unknown_paths_are_404(site):
    r = site.get(f"/heroes/{site.hero}?lang=en")
    assert r.status_code == 200
    assert re.search(r"<title>.+ counters, matchups and win rate \| PickGak</title>", r.text)

    for path in ("/heroes/not-a-hero", "/nope", "/heroes/../etc"):
        r = site.get(path)
        assert r.status_code == 404, path
        assert '<meta name="robots" content="noindex" />' in r.text
        assert '<div id="root">' in r.text  # 사람에게는 그대로 앱이 열린다


def test_private_pages_are_noindex(site):
    for path in ("/account", "/settings", "/players"):
        r = site.get(path)
        assert r.status_code == 200 and 'content="noindex"' in r.text and "hreflang" not in r.text


def test_home_structured_data_and_static_files(site):
    r = site.get("/?lang=en")
    ld = re.search(r'<script type="application/ld\+json">(.*?)</script>', r.text, re.S)
    assert json.loads(ld.group(1))["@type"] == "WebApplication"
    assert site.get("/icon-512.png").content == b"png"  # 실제 파일은 그대로


def test_robots_and_sitemap(site):
    robots = seo.robots_txt()
    assert "Disallow: /api/" in robots and "Sitemap: https://pickgak.seolcu.com/sitemap.xml" in robots
    conn = site.app.state.db.get()
    xml = seo.sitemap_xml(conn)
    assert f"https://pickgak.seolcu.com/heroes/{site.hero}?lang=ko" in xml
    assert "/account" not in xml
    assert xml.count("<url>") == 2 * (len(seo.PAGES) + len(seo.hero_names(conn)))
