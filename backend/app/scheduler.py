"""자동 수집. 사용자가 수집을 신경 쓰지 않도록 서버가 알아서 최신 통계를 유지한다.

한 시간마다 지역별로 마지막 수집 시각을 보고, 오래됐으면 다음 순서로 수집한다.
1) 한국 등급 합산 (첫 실행에도 1~2분 안에 화면을 쓸 수 있게)
2) 다른 지역 등급 합산
3) 지역별 경쟁전 등급별 (오래 걸리므로 마지막)
"""

import logging
import threading
from datetime import UTC, datetime, timedelta

from app import collect, db, map_images
from app.collector import nexon

log = logging.getLogger("pickgak.scheduler")

STALE_AFTER = timedelta(hours=20)
CHECK_EVERY = timedelta(hours=1)
RETRY_AFTER_ERROR = timedelta(minutes=15)


def plan_steps(conn, now: datetime | None = None) -> list[tuple[str, str]]:
    """지금 해야 할 수집 단계 [(region, "all"|"tiers"), ...]를 우선순위 순서로."""
    now = now or datetime.now(UTC)

    def stale(region: str, kind: str) -> bool:
        # 끝까지 마친 수집 기준 (중간에 끊긴 수집은 다시 한다)
        last = db.last_finished_run(conn, region=region, kind=kind)
        return last is None or now - datetime.fromisoformat(last) > STALE_AFTER

    steps = [(r, "all") for r in nexon.REGIONS if stale(r, "all")]
    steps += [(r, "tiers") for r in nexon.REGIONS if stale(r, "tiers")]
    return steps


class Scheduler:
    def __init__(self, conn, *, delay: float = 1.0):
        self.conn = conn
        self.delay = delay
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, name="pickgak-scheduler", daemon=True)

    def start(self):
        self._thread.start()

    def stop(self):
        self._stop.set()

    def run_due(self) -> int:
        """밀린 단계를 모두 실행. 실행한 단계 수를 돌려준다."""
        done = 0
        for region, ranks in plan_steps(self.conn):
            if self._stop.is_set():
                break
            with collect.LOCK:
                collect.run(self.conn, regions=(region,), ranks=(ranks,), delay=self.delay, names=done == 0)
            done += 1
        return done

    def _loop(self):
        images_warmed = False
        while not self._stop.is_set():
            wait = CHECK_EVERY
            try:
                # 전장 이미지를 미리 받아 둔다. 맵 목록이 아직 없으면(첫 실행) 첫 수집 뒤에
                maps = [m["map_id"] for m in db.list_maps(self.conn)]
                if not images_warmed and maps:
                    map_images.warm(maps)
                    for r in map_images.RANKS:
                        map_images.rank_image_path(r)
                    images_warmed = True
                self.run_due()
                if not images_warmed:
                    map_images.warm([m["map_id"] for m in db.list_maps(self.conn)])
                    images_warmed = True
            except Exception:  # noqa: BLE001 - 네트워크 오류 등은 다음 주기에 다시 시도
                log.exception("auto collect failed; retrying later")
                wait = RETRY_AFTER_ERROR
            self._stop.wait(wait.total_seconds())
