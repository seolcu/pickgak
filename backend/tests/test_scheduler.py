from datetime import UTC, datetime, timedelta

from app import db, scheduler
from app.collector import nexon

NOW = datetime(2026, 10, 25, 12, tzinfo=UTC)


def finished(conn, *, region, kind, hours_ago):
    at = (NOW - timedelta(hours=hours_ago)).isoformat(timespec="seconds")
    conn.execute(
        "INSERT INTO collect_runs (region, kind, started_at, finished_at, pages) VALUES (?, ?, ?, ?, 1)",
        (region, kind, at, at),
    )


def test_plan_steps_order_and_staleness(parsed, tmp_path):
    conn = db.connect(tmp_path / "t.db")
    # 빈 DB: 한국 합산이 맨 처음, 그다음 다른 지역 합산, 마지막에 등급별
    steps = scheduler.plan_steps(conn, NOW)
    assert steps[0] == ("korea", "all")
    assert [s for s in steps if s[1] == "all"] == [(r, "all") for r in nexon.REGIONS]
    assert steps[-len(nexon.REGIONS) :] == [(r, "tiers") for r in nexon.REGIONS]

    finished(conn, region="korea", kind="all", hours_ago=2)
    finished(conn, region="korea", kind="tiers", hours_ago=30)
    # 스냅샷만 있고 끝까지 마치지 못한 수집(서버가 중간에 꺼짐)은 최신으로 치지 않는다
    db.save_snapshot(conn, nexon.Query(region="asia"), parsed["heroes"], fetched_at=NOW.isoformat())
    steps = scheduler.plan_steps(conn, NOW)
    assert ("korea", "all") not in steps  # 2시간 전 수집 = 최신
    assert ("korea", "tiers") in steps  # 30시간 전 = 오래됨
    assert ("asia", "all") in steps


def test_run_due_uses_lock_and_marks_names_once(parsed, tmp_path, monkeypatch):
    conn = db.connect(tmp_path / "t.db")
    calls = []
    monkeypatch.setattr(scheduler.collect, "run", lambda c, **kw: calls.append(kw) or 1)
    monkeypatch.setattr(scheduler, "plan_steps", lambda c: [("korea", "all"), ("asia", "all")])
    s = scheduler.Scheduler(conn, delay=0)
    assert s.run_due() == 2
    assert [c["names"] for c in calls] == [True, False]
    assert not scheduler.collect.LOCK.locked()
