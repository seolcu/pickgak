CREATE TABLE players (
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    is_me           INTEGER NOT NULL DEFAULT 0,
    preferred_roles TEXT NOT NULL DEFAULT '[]',  -- JSON 배열
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE player_heroes (
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    hero_id   TEXT NOT NULL,
    PRIMARY KEY (player_id, hero_id)
);
