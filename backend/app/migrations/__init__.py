"""버전별 SQL 마이그레이션. 파일 이름 앞 숫자가 PRAGMA user_version 과 대응한다."""

import sqlite3
from pathlib import Path

_DIR = Path(__file__).resolve().parent


def migrations() -> list[tuple[int, Path]]:
    return sorted((int(p.name.split("_", 1)[0]), p) for p in _DIR.glob("[0-9]*_*.sql"))


def apply(conn: sqlite3.Connection) -> int:
    current = conn.execute("PRAGMA user_version").fetchone()[0]
    for version, path in migrations():
        if version <= current:
            continue
        with conn:
            conn.executescript(path.read_text(encoding="utf-8"))
            conn.execute(f"PRAGMA user_version = {version}")
        current = version
    return current
