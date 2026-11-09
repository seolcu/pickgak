-- 비밀번호 복구 코드(이메일 대신): 가입할 때 한 번만 보여 주고 해시만 둔다
ALTER TABLE users ADD COLUMN recovery_hash TEXT;

-- 로그인·가입 시도 기록 (재시작해도 시도 제한이 유지되게). IP·아이디는 해시로만 둔다
CREATE TABLE auth_attempts (
    kind TEXT NOT NULL,
    key  TEXT NOT NULL,
    ts   REAL NOT NULL
);
CREATE INDEX auth_attempts_lookup ON auth_attempts(kind, key, ts);
CREATE INDEX auth_attempts_ts ON auth_attempts(ts);
