"""회원 인증: 비밀번호 해시(scrypt), 세션 토큰, 로그인 시도 제한.

비밀번호는 표준 라이브러리 scrypt로 해시한다(추가 의존성 없음).
세션 토큰 원문은 HttpOnly 쿠키에만 두고, DB에는 SHA-256 해시만 저장한다.
"""

import base64
import hashlib
import hmac
import secrets
import time
from datetime import UTC, datetime, timedelta

SESSION_DAYS = 90
_N, _R, _P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    b64 = lambda b: base64.b64encode(b).decode()  # noqa: E731
    return f"scrypt${_N}${_R}${_P}${b64(salt)}${b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, digest = stored.split("$")
        if algo != "scrypt":
            return False
        expected = base64.b64decode(digest)
        got = hashlib.scrypt(
            password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=len(expected)
        )
    except ValueError:
        return False
    return hmac.compare_digest(got, expected)


# 없는 아이디로 로그인할 때도 같은 시간이 걸리게 (아이디 존재 여부를 응답 시간으로 알 수 없게)
DUMMY_HASH = hash_password(secrets.token_hex(8))


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def session_expiry() -> str:
    return (datetime.now(UTC) + timedelta(days=SESSION_DAYS)).strftime("%Y-%m-%d %H:%M:%S")


RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # 헷갈리는 0/O, 1/I 제외


def new_recovery_code() -> str:
    """복구 코드: 5자씩 4묶음(20자, 100비트). 사람이 옮겨 적기 쉬운 문자만"""
    raw = "".join(secrets.choice(RECOVERY_ALPHABET) for _ in range(20))
    return "-".join(raw[i : i + 5] for i in range(0, 20, 5))


def recovery_hash(code: str) -> str:
    # 무작위 100비트라 느린 해시가 필요 없다. 입력은 대소문자·하이픈·공백을 무시한다
    norm = "".join(c for c in code.upper() if c.isalnum())
    return hashlib.sha256(norm.encode()).hexdigest()


def recovery_matches(code: str, stored: str | None) -> bool:
    return bool(stored) and hmac.compare_digest(recovery_hash(code), stored)


class RateLimiter:
    """종류(kind)와 키(IP·아이디)마다 window초 안에 limit번까지.
    DB에 남기므로 재시작해도 유지된다. 키는 해시로만 저장한다(IP를 그대로 두지 않음)."""

    def __init__(self, kind: str, limit: int, window: float):
        self.kind, self.limit, self.window = kind, limit, window

    def _key(self, key: str) -> str:
        return hashlib.sha256(f"{self.kind}:{key}".encode()).hexdigest()[:32]

    def blocked(self, conn, key: str) -> bool:
        """기록하지 않고 한도에 걸렸는지만 본다"""
        since = time.time() - self.window
        n = conn.execute(
            "SELECT COUNT(*) FROM auth_attempts WHERE kind=? AND key=? AND ts>?", (self.kind, self._key(key), since)
        ).fetchone()[0]
        return n >= self.limit

    def record(self, conn, key: str) -> None:
        now = time.time()
        with conn:
            conn.execute("INSERT INTO auth_attempts (kind, key, ts) VALUES (?, ?, ?)", (self.kind, self._key(key), now))
            conn.execute("DELETE FROM auth_attempts WHERE ts < ?", (now - 2 * 86400,))  # 이틀 지난 기록은 버린다

    def allow(self, conn, key: str) -> bool:
        """한도 안이면 기록하고 True"""
        if self.blocked(conn, key):
            return False
        self.record(conn, key)
        return True
