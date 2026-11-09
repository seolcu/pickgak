-- 끝까지 마친 수집 기록. 중간에 서버가 꺼지면 기록이 남지 않아 다음에 다시 수집한다.
CREATE TABLE collect_runs (
    id          INTEGER PRIMARY KEY,
    region      TEXT NOT NULL,
    kind        TEXT NOT NULL,  -- 'all' = 등급 합산, 'tiers' = 등급별
    started_at  TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    pages       INTEGER NOT NULL
);
CREATE INDEX collect_runs_lookup ON collect_runs (region, kind, finished_at);
