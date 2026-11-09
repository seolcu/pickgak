import sqlite3

from app import db, migrations
from app.collector import blizzard, nexon
from tests.conftest import FIXTURES


def test_parse_heroes(parsed):
    heroes = parsed["heroes"]
    assert len(heroes) >= 50
    genji = next(h for h in heroes if h["hero_id"] == "genji")
    assert genji["name"] == "겐지"
    assert genji["role"] == "damage"
    assert 0 < genji["win_rate"] < 100 and 0 < genji["pick_rate"] < 100
    assert {h["role"] for h in heroes} == {"tank", "damage", "support"}


def test_parse_filters(parsed):
    f = parsed["filters"]
    assert "korea" in [r["value"] for r in f["regions"]]
    maps = nexon.map_ids(f)
    assert "ilios" in maps and "kings-row" in maps
    assert "control" not in maps and "all" not in maps


def test_iter_queries(parsed):
    f = parsed["filters"]
    n_maps = 1 + len(nexon.map_ids(f))
    qs = list(nexon.iter_queries(f))
    # 경쟁전·빠른 대전 각각 등급 합산 × 맵, 한국, PC만
    assert len(qs) == 2 * n_maps
    assert {q.region for q in qs} == {"korea"} and {q.input for q in qs} == {"pc"}

    tiers = list(nexon.iter_queries(f, regions=nexon.REGIONS, ranks=nexon.tier_ranks(f)))
    assert {q.rq for q in tiers} == {"2"}  # 빠른 대전은 등급이 없으므로 등급별 수집에서 빠진다
    assert "all" not in {q.rank for q in tiers}
    assert len(tiers) == 4 * len(nexon.tier_ranks(f)) * n_maps


def test_db_roundtrip(parsed, tmp_path):
    conn = db.connect(tmp_path / "t.db")
    db.save_filters(conn, parsed["filters"])
    q = nexon.Query(rank="gold", map="ilios")
    db.save_snapshot(conn, q, parsed["heroes"], fetched_at="2026-10-01T00:00:00+00:00")
    db.save_snapshot(conn, q, parsed["heroes"], fetched_at="2026-10-02T00:00:00+00:00")
    at, stats = db.latest_stats(conn, rank="gold", map="ilios")
    assert at.startswith("2026-10-02") and len(stats) == len(parsed["heroes"])
    prev_at, _ = db.latest_stats(conn, rank="gold", map="ilios", before=at)
    assert prev_at.startswith("2026-10-01")
    assert db.latest_stats(conn, rank="silver")[1] == []
    assert any(m["map_id"] == "ilios" and m["mode"] == "control" for m in db.list_maps(conn))


def test_blizzard_en_names_match_nexon_ids(parsed):
    names = blizzard.parse_names((FIXTURES / "blizzard_rates_en.html").read_text(encoding="utf-8"))
    assert names["heroes"]["soldier-76"] == "Soldier: 76"
    assert names["maps"]["ilios"] == "Ilios"
    assert set(names["heroes"]) == {h["hero_id"] for h in parsed["heroes"]}


def test_localized_names(parsed, tmp_path):
    conn = db.connect(tmp_path / "t.db")
    db.save_filters(conn, parsed["filters"])
    db.save_snapshot(conn, nexon.Query(), parsed["heroes"])
    db.save_names(conn, "en", {"genji": "Genji"}, {"ilios": "Ilios"})
    ko = {h["hero_id"]: h["name"] for h in db.list_heroes(conn, "ko")}
    en = {h["hero_id"]: h["name"] for h in db.list_heroes(conn, "en")}
    assert ko["genji"] == "겐지" and en["genji"] == "Genji"
    assert en["ana"] == "아나"  # 번역이 없으면 기본(한국어) 이름
    assert next(m for m in db.list_maps(conn, "en") if m["map_id"] == "ilios")["name"] == "Ilios"


def test_migrations_upgrade_existing_db(tmp_path):
    # 마이그레이션 도입 전 DB(테이블은 있고 user_version=0)도 그대로 올라가야 한다
    path = tmp_path / "old.db"
    old = sqlite3.connect(path)
    old.executescript((migrations._DIR / "0001_initial.sql").read_text(encoding="utf-8"))
    old.close()
    conn = db.connect(path)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == migrations.migrations()[-1][0]
    assert db.list_players(conn, 1) == []


def test_last_collected_and_maps_with_data(parsed, tmp_path):
    conn = db.connect(tmp_path / "t.db")
    db.save_snapshot(conn, nexon.Query(map="ilios"), parsed["heroes"], fetched_at="2026-10-01T00:00:00+00:00")
    db.save_snapshot(conn, nexon.Query(rank="gold"), parsed["heroes"], fetched_at="2026-10-02T00:00:00+00:00")
    assert db.last_collected(conn, region="korea", tiers=False).startswith("2026-10-01")
    assert db.last_collected(conn, region="korea", tiers=True).startswith("2026-10-02")
    assert db.last_collected(conn, region="asia") is None
    assert db.maps_with_data(conn, region="korea", rq="2", rank="all") == {"ilios"}


def test_preferred_roles_normalized(tmp_path):
    conn = db.connect(tmp_path / "t.db")
    uid = db.create_user(conn, "u", "x")["id"]
    p = db.save_player(
        conn, user_id=uid, name="a", is_me=False, preferred_roles=["support", "tank", "damage"], heroes=[]
    )
    assert p["preferred_roles"] == []  # 세 역할 모두 = 상관없음
    p = db.save_player(conn, user_id=uid, name="b", is_me=False, preferred_roles=["support", "tank", "tank"], heroes=[])
    assert p["preferred_roles"] == ["tank", "support"]


def test_legacy_db_file_is_renamed(tmp_path, monkeypatch):
    new, old = tmp_path / "pickgak.db", tmp_path / "ow_meta.db"
    monkeypatch.setattr(db, "DEFAULT_PATH", new)
    monkeypatch.setattr(db, "LEGACY_PATH", old)
    old.write_bytes(b"x")
    (tmp_path / "ow_meta.db-wal").write_bytes(b"w")
    db.migrate_legacy_file(new)
    assert new.read_bytes() == b"x" and (tmp_path / "pickgak.db-wal").exists() and not old.exists()
