"""데이터 수집.

서버가 켜져 있으면 app.scheduler가 알아서 수집하므로 보통은 직접 실행할 필요가 없다. 수동 실행:

uv run python -m app.collect                       # 한국, 등급 합산 × 맵 (약 64회 요청, 1분)
uv run python -m app.collect --regions all --full  # 전 지역, 등급별까지 (약 1,300회 요청, 20분 남짓)
"""

import argparse
import logging
import threading
from datetime import UTC, datetime

from app import db
from app.collector import blizzard, nexon

log = logging.getLogger("pickgak.collect")

# 수집은 한 번에 하나만 (스케줄러와 수동 실행이 겹치지 않게)
LOCK = threading.Lock()


def run(conn, *, regions=("korea",), ranks=("all",), delay: float = 1.0, names: bool = True) -> int:
    """ranks: ("all",) = 등급 합산 / ("tiers",) = 등급별 / 둘 다 가능."""
    # 한 번의 수집을 같은 시각으로 묶어야 나중에 "이번 수집 vs 지난 수집" 비교가 된다
    stamp = datetime.now(UTC).isoformat(timespec="seconds")

    def on_result(q, parsed):
        if parsed["filters"]:
            db.save_filters(conn, parsed["filters"])
        # 로테이션에서 빠진 맵 등은 빈 결과가 온다. 저장하면 이전 데이터를 가리므로 건너뛴다
        if parsed["heroes"]:
            db.save_snapshot(conn, q, parsed["heroes"], fetched_at=stamp)
        log.debug("%s rq=%s rank=%s map=%s: %d heroes", q.region, q.rq, q.rank, q.map, len(parsed["heroes"]))

    errors = 0

    def on_error(q, e):
        nonlocal errors
        errors += 1
        log.warning("skip %s rq=%s rank=%s map=%s: %s", q.region, q.rq, q.rank, q.map, e)

    count = nexon.collect(on_result, regions=regions, ranks=ranks, delay=delay, on_error=on_error)
    # 끝까지 제대로 마친 것만 기록한다 (자동 수집이 '최신인지' 판단하는 기준).
    # 절반 넘게 실패했으면(사이트 장애 등) 기록하지 않아 다음 주기에 다시 시도한다.
    if errors <= count:
        for region in regions:
            for kind in ranks:
                db.record_run(conn, region=region, kind=kind, started_at=stamp, pages=count)
    else:
        log.warning("too many failures (%d failed, %d ok); will retry", errors, count)

    # 영어 이름은 부가 정보라 실패해도 수집 전체를 실패로 보지 않는다
    if names:
        try:
            n = blizzard.fetch_names("en-us", user_agent=nexon.USER_AGENT)
            db.save_names(conn, "en", n["heroes"], n["maps"])
        except Exception as e:  # noqa: BLE001
            log.warning("en names skipped: %s", e)
    log.info("collected %d pages (regions=%s ranks=%s)", count, ",".join(regions), ",".join(ranks))
    return count


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--full", action="store_true", help="경쟁전 등급별까지 수집")
    p.add_argument("--regions", default="korea", help="쉼표 구분 또는 all (korea,asia,americas,europe)")
    p.add_argument("--delay", type=float, default=1.0, help="요청 간 대기(초)")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    regions = nexon.REGIONS if args.regions == "all" else tuple(args.regions.split(","))
    db.migrate_legacy_file()
    with LOCK:
        run(db.connect(), regions=regions, ranks=("all", "tiers") if args.full else ("all",), delay=args.delay)


if __name__ == "__main__":
    main()
