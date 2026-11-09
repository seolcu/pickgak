-- 친구: 요청(accepted=0)과 친구 사이(accepted=1). 한 쌍에 한 줄만 둔다 (requester가 먼저 요청한 쪽)
CREATE TABLE friendships (
    requester  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    accepted   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (requester, addressee),
    CHECK (requester <> addressee)
);
CREATE INDEX friendships_addressee ON friendships(addressee);
