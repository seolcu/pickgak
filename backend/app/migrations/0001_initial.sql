CREATE TABLE IF NOT EXISTS heroes (
    hero_id   TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    role      TEXT NOT NULL,
    subrole   TEXT,
    color     TEXT,
    thumbnail TEXT
);
CREATE TABLE IF NOT EXISTS maps (
    map_id TEXT PRIMARY KEY,
    name   TEXT NOT NULL,
    mode   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshots (
    id         INTEGER PRIMARY KEY,
    fetched_at TEXT NOT NULL,
    region     TEXT NOT NULL,
    rq         TEXT NOT NULL,
    rank       TEXT NOT NULL,
    map        TEXT NOT NULL,
    input      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS snapshots_filter
    ON snapshots (region, rq, rank, map, input, fetched_at);
CREATE TABLE IF NOT EXISTS hero_stats (
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
    hero_id     TEXT NOT NULL,
    win_rate    REAL,
    pick_rate   REAL,
    ban_rate    REAL,
    PRIMARY KEY (snapshot_id, hero_id)
);
