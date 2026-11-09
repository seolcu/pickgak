-- 회원: 아이디 + 비밀번호(scrypt 해시). 이메일 등 다른 개인정보는 받지 않는다
CREATE TABLE users (
    id         INTEGER PRIMARY KEY,
    username   TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pw_hash    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 로그인 세션. 토큰 원문은 쿠키에만 있고 DB에는 SHA-256만 둔다
CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX sessions_user ON sessions(user_id);

-- 플레이어 프로필은 회원마다 따로. 예전(회원 기능 전) 프로필은 user_id가 NULL이라 아무 계정에도 보이지 않는다
ALTER TABLE players ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX players_user ON players(user_id);
