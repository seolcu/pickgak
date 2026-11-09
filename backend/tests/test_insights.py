import pytest

from app import db
from app.analysis import insights
from app.collector import nexon
from app.recommend.engine import Matchups
from tests.conftest import hero

# 평점 데이터 없이 손으로 정리한 상성만 (테스트가 데이터 갱신에 흔들리지 않게)
MANUAL = Matchups.load(ratings_path=None)

BASE = [hero("genji", "damage", 50, 10), hero("cassidy", "damage", 48, 10), hero("ana", "support", 50, 20)]


def rows(**over):
    """BASE에서 특정 영웅의 (승률, 픽률)만 바꾼 통계"""
    out = []
    for h in BASE:
        h = {**h, "subrole": None, "color": None, "thumbnail": None, "ban_rate": 0.0}
        if h["hero_id"] in over:
            h["win_rate"], h["pick_rate"] = over[h["hero_id"]]
        out.append(h)
    return out


@pytest.fixture
def conn(tmp_path, parsed):
    c = db.connect(tmp_path / "t.db")
    db.save_filters(c, parsed["filters"])
    t1, t2 = "2026-10-01T00:00:00+00:00", "2026-10-02T00:00:00+00:00"
    db.save_snapshot(c, nexon.Query(), rows(genji=(49, 9)), fetched_at=t1)
    db.save_snapshot(c, nexon.Query(), rows(), fetched_at=t2)
    db.save_snapshot(c, nexon.Query(map="ilios"), rows(genji=(56, 5)), fetched_at=t2)  # 강한데 덜 골라짐
    db.save_snapshot(c, nexon.Query(map="nepal"), rows(genji=(46, 30)), fetched_at=t2)  # 3배 많이 골라짐
    db.save_snapshot(c, nexon.Query(rank="gold"), rows(genji=(52, 12)), fetched_at=t2)
    return c


def test_hero_detail(conn):
    d = insights.hero_detail(conn, "genji", region="korea", rq="2", rank="all", matchups=MANUAL)
    assert d["summary"]["delta"] == {"win": 1, "pick": 1}
    maps = {m["map_id"]: m for m in d["maps"]}
    assert maps["ilios"]["win_diff"] == 6 and maps["nepal"]["pick_ratio"] == 3
    assert d["hidden_strong"][0]["map_id"] == "ilios"
    assert d["map_spread"] == {"sigma": 5.0, "min": 46, "max": 56}
    assert d["ranks"] == [{"rank": "gold", "win_rate": 52, "pick_rate": 12, "ban_rate": 0.0}]
    assert [h["win_rate"] for h in d["history"]] == [49, 50]
    # 상성은 통계에 있는 영웅만 보여준다 (테스트 데이터: 겐지·캐서디·아나)
    assert d["matchups"] == {"strong_vs": ["ana"], "weak_vs": ["cassidy"], "synergy": []}
    assert insights.hero_detail(conn, "nobody", region="korea", rq="2", rank="all", matchups=MANUAL) is None


def test_quick_play_detail_has_no_ranks(conn):
    db.save_snapshot(conn, nexon.Query(rq="0"), rows(), fetched_at="2026-10-02T00:00:00+00:00")
    d = insights.hero_detail(conn, "genji", region="korea", rq="0", rank="all", matchups=MANUAL)
    assert d["ranks"] == []


def test_map_specialists(conn):
    res = insights.map_specialists(conn, region="korea", rq="2", rank="all")
    nepal = next(m for m in res["maps"] if m["map_id"] == "nepal")
    assert nepal["specialists"][0] == {
        "hero_id": "genji",
        "role": "damage",
        "pick_rate": 30,
        "win_rate": 46,
        "pick_ratio": 3.0,
        "win_diff": -4,
    }
    assert res["maps"][0]["map_id"] == "nepal"  # 배율이 가장 큰 맵이 먼저
