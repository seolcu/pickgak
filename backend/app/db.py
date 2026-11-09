import json
import sqlite3
import threading
import weakref
from datetime import UTC, datetime
from pathlib import Path

from app import migrations

DEFAULT_PATH = Path(__file__).resolve().parent.parent / "pickgak.db"
LEGACY_PATH = DEFAULT_PATH.with_name("ow_meta.db")  # 옵픽 시절 이름


def migrate_legacy_file(path: Path | str = DEFAULT_PATH) -> None:
    """예전 DB 파일(ow_meta.db)이 있고 새 파일이 없으면 이름만 바꿔 그대로 쓴다 (WAL 파일 포함)."""
    path = Path(path)
    if path != DEFAULT_PATH or path.exists() or not LEGACY_PATH.exists():
        return
    for suffix in ("", "-wal", "-shm"):
        old = LEGACY_PATH.with_name(LEGACY_PATH.name + suffix)
        if old.exists():
            old.rename(path.with_name(path.name + suffix))


BASE_LOCALE = "ko"  # heroes.name / maps.name 에 들어 있는 언어
ALL_ROLES = ("tank", "damage", "support")


def connect(path: Path | str = DEFAULT_PATH, *, migrate: bool = True) -> sqlite3.Connection:
    # 자동 수집(별도 연결)과 요청 처리가 동시에 일어나므로 WAL + 잠금 대기
    conn = sqlite3.connect(path, check_same_thread=False, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    if migrate:
        migrations.apply(conn)
    return conn


class _Held:
    """스레드 하나의 연결. 스레드가 끝나 thread-local 값이 사라지면 연결도 닫힌다."""

    __slots__ = ("conn", "__weakref__")

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def __del__(self):
        self.conn.close()


class ThreadConnections:
    """요청 처리 스레드마다 연결 하나씩. sqlite 연결 하나를 여러 스레드가 동시에 쓰면 오류가 난다.

    anyio는 10초 동안 쉰 작업 스레드를 없애고 새로 만든다. 끝난 스레드의 연결을 붙잡아 두면 파일
    핸들이 쌓여 서버가 멈춘다 (45시간에 연결 505개, 한도 1024). 그래서 연결 목록은 약한 참조로만 둔다.
    """

    def __init__(self, path: Path | str):
        self.path = path
        self._local = threading.local()
        self._all: weakref.WeakSet[_Held] = weakref.WeakSet()
        self._lock = threading.Lock()
        connect(path).close()  # 마이그레이션은 시작할 때 한 번

    def get(self) -> sqlite3.Connection:
        held = getattr(self._local, "held", None)
        if held is None:
            held = self._local.held = _Held(connect(self.path, migrate=False))
            with self._lock:
                self._all.add(held)
        return held.conn

    def open_count(self) -> int:
        with self._lock:
            return len(self._all)

    def close_all(self) -> None:
        with self._lock:
            for h in list(self._all):
                h.conn.close()
            self._all.clear()


def save_filters(conn: sqlite3.Connection, filters: dict) -> None:
    modes = {m["value"] for m in filters["maps"] if m["parentValue"] == "battlefield"}
    conn.executemany(
        "INSERT OR REPLACE INTO maps (map_id, name, mode) VALUES (?, ?, ?)",
        [(m["value"], m["name"], m["parentValue"]) for m in filters["maps"] if m["parentValue"] in modes],
    )
    conn.commit()


def save_names(conn: sqlite3.Connection, locale: str, heroes: dict[str, str], maps: dict[str, str]) -> None:
    with conn:
        conn.executemany(
            "INSERT OR REPLACE INTO hero_names (hero_id, locale, name) VALUES (?, ?, ?)",
            [(k, locale, v) for k, v in heroes.items()],
        )
        conn.executemany(
            "INSERT OR REPLACE INTO map_names (map_id, locale, name) VALUES (?, ?, ?)",
            [(k, locale, v) for k, v in maps.items()],
        )


def save_snapshot(conn: sqlite3.Connection, query, heroes: list[dict], fetched_at: str | None = None) -> int:
    fetched_at = fetched_at or datetime.now(UTC).isoformat(timespec="seconds")
    with conn:
        conn.executemany(
            "INSERT OR REPLACE INTO heroes (hero_id, name, role, subrole, color, thumbnail)"
            " VALUES (:hero_id, :name, :role, :subrole, :color, :thumbnail)",
            heroes,
        )
        cur = conn.execute(
            "INSERT INTO snapshots (fetched_at, region, rq, rank, map, input) VALUES (?, ?, ?, ?, ?, ?)",
            (fetched_at, query.region, query.rq, query.rank, query.map, query.input),
        )
        sid = cur.lastrowid
        conn.executemany(
            "INSERT INTO hero_stats (snapshot_id, hero_id, win_rate, pick_rate, ban_rate) VALUES (?, ?, ?, ?, ?)",
            [(sid, h["hero_id"], h["win_rate"], h["pick_rate"], h["ban_rate"]) for h in heroes],
        )
    return sid


def rank_parts(rank: str) -> list[str]:
    """합친 등급("bronze+silver")을 등급 목록으로. 경쟁전 경기 등급 범위가 여러 등급에 걸칠 때 쓴다."""
    return rank.split("+")


def merge_stats(groups: list[list[dict]]) -> list[dict]:
    """여러 등급의 영웅별 통계를 하나로 합친다.

    등급별 판 수는 공개되지 않으므로 각 등급의 판 수가 같다고 본다: 픽률·밴률은 평균, 승률은 픽률 가중 평균
    (그 영웅이 나온 판 기준). 어느 등급에 없는 영웅은 그 등급에서 픽률 0으로 본다.
    """
    n = len(groups)
    by: dict[str, list[dict]] = {}
    for rows in groups:
        for r in rows:
            by.setdefault(r["hero_id"], []).append(r)
    out = []
    for rows in by.values():
        picks = [r["pick_rate"] or 0 for r in rows]
        wins = [(r["win_rate"], p) for r, p in zip(rows, picks, strict=True) if r["win_rate"] is not None]
        weight = sum(p for _, p in wins)
        win = (
            sum(w * p for w, p in wins) / weight
            if weight > 0
            else (sum(w for w, _ in wins) / len(wins) if wins else None)
        )
        bans = [r["ban_rate"] for r in rows if r["ban_rate"] is not None]
        out.append(
            {
                **rows[0],
                "win_rate": win,
                "pick_rate": sum(picks) / n,
                "ban_rate": sum(bans) / n if bans else None,
            }
        )
    return out


def latest_stats(
    conn: sqlite3.Connection, *, region="korea", rq="2", rank="all", map="all", input="pc", before: str | None = None
) -> tuple[str | None, list[dict]]:
    """조건에 맞는 가장 최근 스냅샷의 (fetched_at, 영웅별 통계). before가 있으면 그 이전 것.

    합친 등급이면 등급마다 찾아 합친다 (fetched_at은 가장 오래된 것).
    """
    if "+" in rank:
        found = [
            latest_stats(conn, region=region, rq=rq, rank=r, map=map, input=input, before=before)
            for r in rank_parts(rank)
        ]
        found = [(at, rows) for at, rows in found if at]
        if not found:
            return None, []
        return min(at for at, _ in found), merge_stats([rows for _, rows in found])
    sql = (
        "SELECT id, fetched_at FROM snapshots WHERE region=? AND rq=? AND rank=? AND map=? AND input=?"
        + (" AND fetched_at < ?" if before else "")
        + " ORDER BY fetched_at DESC, id DESC LIMIT 1"
    )
    args = [region, rq, rank, map, input] + ([before] if before else [])
    snap = conn.execute(sql, args).fetchone()
    if not snap:
        return None, []
    rows = conn.execute(
        "SELECT h.hero_id, h.name, h.role, h.subrole, h.color, h.thumbnail,"
        " s.win_rate, s.pick_rate, s.ban_rate"
        " FROM hero_stats s JOIN heroes h USING (hero_id) WHERE s.snapshot_id=?",
        (snap["id"],),
    ).fetchall()
    return snap["fetched_at"], [dict(r) for r in rows]


def last_collected(conn: sqlite3.Connection, region: str | None = None, tiers: bool | None = None) -> str | None:
    """마지막 수집 시각. tiers=True면 등급별 스냅샷, False면 등급 합산 스냅샷만 본다."""
    sql, args = "SELECT MAX(fetched_at) FROM snapshots WHERE 1=1", []
    if region:
        sql, args = sql + " AND region=?", [*args, region]
    if tiers is not None:
        sql += " AND rank != 'all'" if tiers else " AND rank = 'all'"
    return conn.execute(sql, args).fetchone()[0]


def record_run(conn: sqlite3.Connection, *, region: str, kind: str, started_at: str, pages: int) -> None:
    with conn:
        conn.execute(
            "INSERT INTO collect_runs (region, kind, started_at, finished_at, pages) VALUES (?, ?, ?, ?, ?)",
            (region, kind, started_at, datetime.now(UTC).isoformat(timespec="seconds"), pages),
        )


def last_finished_run(conn: sqlite3.Connection, *, region: str, kind: str) -> str | None:
    row = conn.execute("SELECT MAX(finished_at) FROM collect_runs WHERE region=? AND kind=?", (region, kind))
    return row.fetchone()[0]


def maps_with_data(conn: sqlite3.Connection, *, region: str, rq: str, rank: str, input: str = "pc") -> set[str]:
    if "+" in rank:
        return set().union(*(maps_with_data(conn, region=region, rq=rq, rank=r, input=input) for r in rank_parts(rank)))
    rows = conn.execute(
        "SELECT DISTINCT map FROM snapshots WHERE region=? AND rq=? AND rank=? AND input=?", (region, rq, rank, input)
    )
    return {r[0] for r in rows}


def list_heroes(conn, lang: str = BASE_LOCALE) -> list[dict]:
    rows = conn.execute(
        "SELECT h.hero_id, COALESCE(n.name, h.name) AS name, h.role, h.subrole, h.color, h.thumbnail"
        " FROM heroes h LEFT JOIN hero_names n ON n.hero_id = h.hero_id AND n.locale = ?"
        " ORDER BY h.role, name",
        (lang,),
    )
    return [dict(r) for r in rows]


def list_maps(conn, lang: str = BASE_LOCALE) -> list[dict]:
    rows = conn.execute(
        "SELECT m.map_id, COALESCE(n.name, m.name) AS name, m.mode"
        " FROM maps m LEFT JOIN map_names n ON n.map_id = m.map_id AND n.locale = ?"
        " ORDER BY m.mode, name",
        (lang,),
    )
    return [dict(r) for r in rows]


# ---- 플레이어 프로필 ----


def _player(conn, row) -> dict:
    heroes = [r[0] for r in conn.execute("SELECT hero_id FROM player_heroes WHERE player_id=?", (row["id"],))]
    return {
        "id": row["id"],
        "name": row["name"],
        "aliases": json.loads(row["aliases"]),
        "is_me": bool(row["is_me"]),
        "preferred_roles": json.loads(row["preferred_roles"]),
        "heroes": sorted(heroes),
        "only_preferred": bool(row["only_preferred"]),
    }


def _aliases(name: str, aliases: list[str]) -> list[str]:
    """부계정 닉네임: 앞뒤 공백을 빼고, 대표 이름과 같거나 겹치는 것은 버린다 (대소문자 무시)"""
    seen = {name.strip().casefold()}
    out = []
    for a in aliases:
        a = a.strip()
        if a and a.casefold() not in seen:
            seen.add(a.casefold())
            out.append(a)
    return out


def list_players(conn, user_id: int) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM players WHERE user_id=? ORDER BY is_me DESC, created_at, id", (user_id,)
    ).fetchall()
    return [_player(conn, r) for r in rows]


def get_player(conn, player_id: int, user_id: int) -> dict | None:
    row = conn.execute("SELECT * FROM players WHERE id=? AND user_id=?", (player_id, user_id)).fetchone()
    return _player(conn, row) if row else None


def save_player(
    conn,
    *,
    user_id: int,
    name: str,
    is_me: bool,
    preferred_roles: list[str],
    heroes: list[str],
    only_preferred: bool = False,
    aliases: list[str] | None = None,
    player_id: int | None = None,
) -> dict | None:
    """회원 user_id의 프로필을 만들거나 고친다. 다른 회원의 프로필이면 None"""
    aliases = _aliases(name, aliases or [])
    # 세 역할을 모두 고른 것과 하나도 안 고른 것은 같은 뜻('상관없음')이므로 빈 목록으로 통일한다
    preferred_roles = (
        [] if set(preferred_roles) >= set(ALL_ROLES) else sorted(set(preferred_roles), key=ALL_ROLES.index)
    )
    with conn:
        if (
            player_id is not None
            and not conn.execute("SELECT 1 FROM players WHERE id=? AND user_id=?", (player_id, user_id)).fetchone()
        ):
            return None
        if is_me:  # "나"는 회원마다 한 명뿐
            conn.execute("UPDATE players SET is_me=0 WHERE user_id=? AND id IS NOT ?", (user_id, player_id))
        if player_id is None:
            cur = conn.execute(
                "INSERT INTO players (user_id, name, aliases, is_me, preferred_roles, only_preferred)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (user_id, name, json.dumps(aliases), int(is_me), json.dumps(preferred_roles), int(only_preferred)),
            )
            player_id = cur.lastrowid
        else:
            conn.execute(
                "UPDATE players SET name=?, aliases=?, is_me=?, preferred_roles=?, only_preferred=? WHERE id=?",
                (name, json.dumps(aliases), int(is_me), json.dumps(preferred_roles), int(only_preferred), player_id),
            )
            conn.execute("DELETE FROM player_heroes WHERE player_id=?", (player_id,))
        conn.executemany(
            "INSERT INTO player_heroes (player_id, hero_id) VALUES (?, ?)", [(player_id, h) for h in set(heroes)]
        )
    return get_player(conn, player_id, user_id)


def delete_player(conn, player_id: int, user_id: int) -> bool:
    with conn:
        return conn.execute("DELETE FROM players WHERE id=? AND user_id=?", (player_id, user_id)).rowcount > 0


# ---- 회원 ----


def create_user(conn, username: str, pw_hash: str) -> dict | None:
    """아이디가 이미 있으면 None (대소문자 구분 없음)"""
    try:
        with conn:
            cur = conn.execute("INSERT INTO users (username, pw_hash) VALUES (?, ?)", (username, pw_hash))
    except sqlite3.IntegrityError:
        return None
    return {"id": cur.lastrowid, "username": username}


def find_user(conn, username: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()


def get_user(conn, user_id: int) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()


def create_user_with_recovery(conn, username: str, pw_hash: str, recovery_hash: str) -> dict | None:
    """아이디가 이미 있으면 None (대소문자 구분 없음)"""
    try:
        with conn:
            cur = conn.execute(
                "INSERT INTO users (username, pw_hash, recovery_hash) VALUES (?, ?, ?)",
                (username, pw_hash, recovery_hash),
            )
    except sqlite3.IntegrityError:
        return None
    return {"id": cur.lastrowid, "username": username}


def set_password(conn, user_id: int, pw_hash: str) -> None:
    """비밀번호를 바꾸면 모든 세션을 끊는다 (호출한 쪽이 새 세션을 만든다)"""
    with conn:
        conn.execute("UPDATE users SET pw_hash=? WHERE id=?", (pw_hash, user_id))
        conn.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))


def set_recovery_hash(conn, user_id: int, recovery_hash: str) -> None:
    with conn:
        conn.execute("UPDATE users SET recovery_hash=? WHERE id=?", (recovery_hash, user_id))


def delete_sessions(conn, user_id: int) -> None:
    with conn:
        conn.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))


def count_users_since(conn, since: str) -> int:
    return conn.execute("SELECT COUNT(*) FROM users WHERE created_at > ?", (since,)).fetchone()[0]


def delete_user(conn, user_id: int) -> None:
    """회원 탈퇴: 세션·프로필까지 지운다 (외래 키 ON DELETE CASCADE)"""
    with conn:
        conn.execute("DELETE FROM users WHERE id=?", (user_id,))


def create_session(conn, user_id: int, token_hash: str, expires_at: str) -> None:
    with conn:
        conn.execute(
            "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", (token_hash, user_id, expires_at)
        )
        conn.execute("DELETE FROM sessions WHERE expires_at < datetime('now')")


def session_user(conn, token_hash: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id"
        " WHERE s.token_hash=? AND s.expires_at > datetime('now')",
        (token_hash,),
    ).fetchone()


def delete_session(conn, token_hash: str) -> None:
    with conn:
        conn.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash,))


# ---- 친구 ----


def _pair(conn, a: int, b: int) -> sqlite3.Row | None:
    """두 회원 사이의 친구 관계 줄 (방향 무관)"""
    return conn.execute(
        "SELECT * FROM friendships WHERE (requester=? AND addressee=?) OR (requester=? AND addressee=?)",
        (a, b, b, a),
    ).fetchone()


def friend_count(conn, user_id: int) -> int:
    """친구와 내가 보낸(아직 안 받은) 요청 수"""
    return conn.execute(
        "SELECT COUNT(*) FROM friendships WHERE requester=? OR (addressee=? AND accepted=1)", (user_id, user_id)
    ).fetchone()[0]


def incoming_count(conn, user_id: int) -> int:
    return conn.execute("SELECT COUNT(*) FROM friendships WHERE addressee=? AND accepted=0", (user_id,)).fetchone()[0]


def request_friend(conn, user_id: int, other_id: int) -> str:
    """친구 요청. 상대가 이미 나에게 요청했으면 바로 친구가 된다.
    돌려주는 값: requested, accepted(맞요청으로 성사), already(이미 친구), pending(이미 요청함)"""
    with conn:
        row = _pair(conn, user_id, other_id)
        if row is None:
            conn.execute("INSERT INTO friendships (requester, addressee) VALUES (?, ?)", (user_id, other_id))
            return "requested"
        if row["accepted"]:
            return "already"
        if row["requester"] == user_id:
            return "pending"
        conn.execute("UPDATE friendships SET accepted=1 WHERE requester=? AND addressee=?", (other_id, user_id))
        return "accepted"


def accept_friend(conn, user_id: int, other_id: int) -> bool:
    """other_id가 보낸 요청을 받는다. 그런 요청이 없으면 False"""
    with conn:
        return (
            conn.execute(
                "UPDATE friendships SET accepted=1 WHERE requester=? AND addressee=? AND accepted=0",
                (other_id, user_id),
            ).rowcount
            > 0
        )


def remove_friend(conn, user_id: int, other_id: int) -> bool:
    """친구 끊기, 보낸 요청 취소, 받은 요청 거절. 모두 그 줄을 지운다"""
    with conn:
        return (
            conn.execute(
                "DELETE FROM friendships WHERE (requester=? AND addressee=?) OR (requester=? AND addressee=?)",
                (user_id, other_id, other_id, user_id),
            ).rowcount
            > 0
        )


# 친구에게 보이는 '나' 프로필의 항목
FRIEND_PROFILE_KEYS = ("name", "aliases", "preferred_roles", "heroes", "only_preferred")


def list_friends(conn, user_id: int) -> dict:
    """친구(그 친구의 '나' 프로필 포함), 받은 요청, 보낸 요청"""
    rows = conn.execute(
        "SELECT f.requester, f.accepted, u.id, u.username FROM friendships f"
        " JOIN users u ON u.id = CASE WHEN f.requester=? THEN f.addressee ELSE f.requester END"
        " WHERE f.requester=? OR f.addressee=? ORDER BY u.username COLLATE NOCASE",
        (user_id, user_id, user_id),
    ).fetchall()
    out: dict[str, list[dict]] = {"friends": [], "incoming": [], "outgoing": []}
    for r in rows:
        person = {"user_id": r["id"], "username": r["username"]}
        if r["accepted"]:
            me = conn.execute("SELECT * FROM players WHERE user_id=? AND is_me=1", (r["id"],)).fetchone()
            profile = _player(conn, me) if me else None
            # 친구에게 보이는 것은 '나' 프로필의 이름(게임 닉네임)·부계정 닉네임과 역할·영웅 선호뿐 (프로필 id는 빼고).
            # 이름은 데스크톱 앱이 점수판의 파티원 이름과 맞춰 볼 때 쓴다
            out["friends"].append(
                {
                    **person,
                    "profile": {k: profile[k] for k in FRIEND_PROFILE_KEYS} if profile else None,
                }
            )
        else:
            out["outgoing" if r["requester"] == user_id else "incoming"].append(person)
    return out


# ---- 분석용 조회 ----


def _rows_for(conn, snapshot_ids: list[int]) -> dict[int, list[dict]]:
    if not snapshot_ids:
        return {}
    marks = ",".join("?" * len(snapshot_ids))
    rows = conn.execute(
        "SELECT s.snapshot_id, h.hero_id, h.name, h.role, h.subrole, s.win_rate, s.pick_rate, s.ban_rate"
        f" FROM hero_stats s JOIN heroes h USING (hero_id) WHERE s.snapshot_id IN ({marks})",
        snapshot_ids,
    )
    out: dict[int, list[dict]] = {}
    for r in rows:
        d = dict(r)
        out.setdefault(d.pop("snapshot_id"), []).append(d)
    return out


def latest_by(
    conn, group: str, *, region: str, rq: str, rank: str | None = None, map: str | None = None, input: str = "pc"
) -> dict[str, tuple[str, list[dict]]]:
    """group('map' 또는 'rank')별 가장 최근 스냅샷. 고정 조건은 나머지 인자로 준다.

    반환: {그룹 값: (fetched_at, 영웅별 통계)}
    """
    assert group in ("map", "rank")
    if rank is not None and "+" in rank:
        parts = [latest_by(conn, group, region=region, rq=rq, rank=r, map=map, input=input) for r in rank_parts(rank)]
        keys = set().union(*parts)
        return {
            k: (min(p[k][0] for p in parts if k in p), merge_stats([p[k][1] for p in parts if k in p])) for k in keys
        }
    fixed = {"region": region, "rq": rq, "input": input}
    if rank is not None:
        fixed["rank"] = rank
    if map is not None:
        fixed["map"] = map
    where = " AND ".join(f"{k}=?" for k in fixed)
    snaps = conn.execute(
        f"SELECT {group} AS g, id, fetched_at FROM snapshots WHERE {where} ORDER BY fetched_at DESC, id DESC",
        list(fixed.values()),
    ).fetchall()
    latest: dict[str, tuple[int, str]] = {}
    for s in snaps:
        latest.setdefault(s["g"], (s["id"], s["fetched_at"]))
    rows = _rows_for(conn, [sid for sid, _ in latest.values()])
    return {g: (at, rows.get(sid, [])) for g, (sid, at) in latest.items()}


def history(
    conn, *, region: str, rq: str, rank: str, map: str = "all", input: str = "pc", limit: int = 30
) -> list[tuple[str, list[dict]]]:
    """같은 조건의 스냅샷을 하루 하나씩(그날 마지막 수집), 오래된 날부터 최근 limit일.

    통계 페이지는 하루 한 번쯤 바뀌므로 같은 날 여러 번 수집한 것은 하나로 본다.
    """
    if "+" in rank:
        # 등급마다의 하루 기록 중 모든 등급에 있는 날만 합친다
        parts = []
        for r in rank_parts(rank):
            days = history(conn, region=region, rq=rq, rank=r, map=map, input=input, limit=limit)
            parts.append({at[:10]: (at, rows) for at, rows in days})
        days = sorted(set.intersection(*(set(p) for p in parts)))
        return [(max(p[d][0] for p in parts), merge_stats([p[d][1] for p in parts])) for d in days][-limit:]
    snaps = conn.execute(
        "SELECT id, fetched_at FROM snapshots WHERE region=? AND rq=? AND rank=? AND map=? AND input=?"
        " ORDER BY fetched_at DESC, id DESC",
        (region, rq, rank, map, input),
    ).fetchall()
    picked: dict[str, tuple[str, int]] = {}  # 날짜 -> (fetched_at, id)
    for s in snaps:
        day = s["fetched_at"][:10]
        if day not in picked:
            picked[day] = (s["fetched_at"], s["id"])
        if len(picked) >= limit:
            break
    rows = _rows_for(conn, [sid for _, sid in picked.values()])
    return [(at, rows.get(sid, [])) for at, sid in sorted(picked.values())]
