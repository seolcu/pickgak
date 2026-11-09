"""회원 API: 가입·로그인·로그아웃·탈퇴, 그리고 회원별 플레이어 프로필.

비회원은 프로필을 브라우저(localStorage)에 두므로 이 API를 쓰지 않는다.
추천 API는 선호 영웅을 요청 본문으로 받으므로 회원 여부와 관계없이 똑같이 동작한다.
"""

import os
import re
import unicodedata
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, StringConstraints

from app import auth, db

router = APIRouter(prefix="/api")

COOKIE = "pickgak_session"
Role = Literal["tank", "damage", "support"]
USERNAME = re.compile(r"^[0-9A-Za-z_가-힣]{2,20}$")

# 시도 제한 (DB에 기록되어 재시작해도 유지)
# - 같은 IP: 로그인·탈퇴·비밀번호 확인 10분에 10번, 가입 1시간에 5번, 복구 1시간에 10번
# - 같은 아이디: 로그인·복구 실패 1시간에 10번 (여러 IP로 나눠 한 계정을 노리는 경우)
# - 사이트 전체: 하루 가입 수 상한 (스팸 계정 대량 생성 방지)
login_limit = auth.RateLimiter("login_ip", 10, 600)
signup_limit = auth.RateLimiter("signup_ip", 5, 3600)
recover_limit = auth.RateLimiter("recover_ip", 10, 3600)
account_fail_limit = auth.RateLimiter("account_fail", 10, 3600)
SIGNUP_DAILY_CAP = int(os.environ.get("PICKGAK_SIGNUP_DAILY_CAP", "200"))


def _conn(request: Request):
    return request.app.state.db.get()


def _client_ip(request: Request) -> str:
    # 배포에서는 앞단 리버스 프록시를 거쳐서만 들어오므로 그쪽이 붙인 X-Forwarded-For를 쓴다.
    # 맨 오른쪽 값이 우리 프록시가 본 실제 접속 주소다 (왼쪽 값은 클라이언트가 지어낼 수 있다)
    if os.environ.get("PICKGAK_TRUST_PROXY") == "1":
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


def _username(raw: str) -> str:
    # macOS 등에서 한글이 자모 분리(NFD)로 들어와도 같은 아이디로 본다
    return unicodedata.normalize("NFC", raw.strip())


def _error(status: int, code: str):
    return HTTPException(status, {"code": code, "params": {}})


def current_user(request: Request) -> dict:
    token = request.cookies.get(COOKIE)
    row = db.session_user(_conn(request), auth.token_hash(token)) if token else None
    if not row:
        raise _error(401, "login_required")
    return {"id": row["id"], "username": row["username"]}


User = Annotated[dict, Depends(current_user)]


def _start_session(request: Request, response: Response, user_id: int) -> None:
    # 이 브라우저에 남아 있던 세션은 끝낸다 (새 로그인마다 버려진 세션이 쌓이지 않게)
    old = request.cookies.get(COOKIE)
    if old:
        db.delete_session(_conn(request), auth.token_hash(old))
    token = auth.new_token()
    db.create_session(_conn(request), user_id, auth.token_hash(token), auth.session_expiry())
    response.set_cookie(
        COOKIE,
        token,
        max_age=auth.SESSION_DAYS * 86400,
        httponly=True,
        samesite="lax",
        secure=os.environ.get("PICKGAK_SECURE_COOKIE") == "1",
        path="/",
    )


class Credentials(BaseModel):
    username: str = Field(..., min_length=1, max_length=40)
    password: str = Field(..., min_length=1, max_length=200)


class SignupIn(Credentials):
    # 사람에게는 보이지 않는 칸. 채워져 있으면 자동 가입 봇으로 본다
    website: str = Field("", max_length=200)


def _check_new_password(password: str) -> None:
    if len(password) < 8:
        raise _error(422, "weak_password")


def _limit(limiter: auth.RateLimiter, request: Request, key: str) -> None:
    if not limiter.allow(_conn(request), key):
        raise _error(429, "too_many_attempts")


def _verify_or_count(request: Request, row, password: str) -> None:
    """비밀번호 확인. 틀리면 그 계정의 실패로 센다 (계정 잠금)"""
    conn = _conn(request)
    name = row["username"].lower() if row else ""
    if row and account_fail_limit.blocked(conn, name):
        raise _error(429, "too_many_attempts")
    ok = auth.verify_password(password, row["pw_hash"] if row else auth.DUMMY_HASH)
    if not row or not ok:
        if row:
            account_fail_limit.record(conn, name)
        raise _error(401, "bad_credentials")


@router.post("/auth/signup", status_code=201)
def signup(body: SignupIn, request: Request, response: Response):
    conn = _conn(request)
    _limit(signup_limit, request, _client_ip(request))
    if body.website:
        raise _error(422, "bad_username")
    since = (datetime.now(UTC) - timedelta(days=1)).strftime("%Y-%m-%d %H:%M:%S")
    if db.count_users_since(conn, since) >= SIGNUP_DAILY_CAP:
        raise _error(429, "signup_closed")
    name = _username(body.username)
    if not USERNAME.match(name):
        raise _error(422, "bad_username")
    _check_new_password(body.password)
    code = auth.new_recovery_code()
    user = db.create_user_with_recovery(conn, name, auth.hash_password(body.password), auth.recovery_hash(code))
    if not user:
        raise _error(409, "username_taken")
    _start_session(request, response, user["id"])
    # 복구 코드는 지금 한 번만 보여 준다 (서버에는 해시만 남는다)
    return {**user, "recovery_code": code}


@router.post("/auth/login")
def login(body: Credentials, request: Request, response: Response):
    _limit(login_limit, request, _client_ip(request))
    row = db.find_user(_conn(request), _username(body.username))
    _verify_or_count(request, row, body.password)
    _start_session(request, response, row["id"])
    return {"id": row["id"], "username": row["username"]}


@router.post("/auth/logout", status_code=204)
def logout(request: Request, response: Response):
    token = request.cookies.get(COOKIE)
    if token:
        db.delete_session(_conn(request), auth.token_hash(token))
    response.delete_cookie(COOKIE, path="/")


@router.post("/auth/logout-all", status_code=204)
def logout_all(user: User, request: Request, response: Response):
    """모든 기기에서 로그아웃 (이 기기 포함)"""
    db.delete_sessions(_conn(request), user["id"])
    response.delete_cookie(COOKIE, path="/")


@router.get("/auth/me")
def me(request: Request):
    """로그인했으면 회원 정보, 아니면 null (비회원도 정상 응답)"""
    try:
        return current_user(request)
    except HTTPException:
        return None


class Password(BaseModel):
    password: str = Field(..., min_length=1, max_length=200)


class PasswordChange(BaseModel):
    current: str = Field(..., min_length=1, max_length=200)
    new: str = Field(..., min_length=1, max_length=200)


@router.post("/auth/password", status_code=204)
def change_password(body: PasswordChange, user: User, request: Request, response: Response):
    """비밀번호 변경. 다른 기기의 로그인은 모두 끊고 이 기기만 새로 로그인한다"""
    _limit(login_limit, request, _client_ip(request))
    row = db.get_user(_conn(request), user["id"])
    _verify_or_count(request, row, body.current)
    _check_new_password(body.new)
    db.set_password(_conn(request), user["id"], auth.hash_password(body.new))
    _start_session(request, response, user["id"])


@router.post("/auth/recovery-code")
def new_recovery_code(body: Password, user: User, request: Request):
    """복구 코드를 새로 만든다 (이전 코드는 더는 쓸 수 없다)"""
    _limit(login_limit, request, _client_ip(request))
    row = db.get_user(_conn(request), user["id"])
    _verify_or_count(request, row, body.password)
    code = auth.new_recovery_code()
    db.set_recovery_hash(_conn(request), user["id"], auth.recovery_hash(code))
    return {"recovery_code": code}


class Recover(BaseModel):
    username: str = Field(..., min_length=1, max_length=40)
    recovery_code: str = Field(..., min_length=1, max_length=60)
    new_password: str = Field(..., min_length=1, max_length=200)


@router.post("/auth/recover")
def recover(body: Recover, request: Request, response: Response):
    """복구 코드로 비밀번호 재설정. 쓴 코드는 버리고 새 코드를 준다. 모든 기존 로그인은 끊긴다"""
    conn = _conn(request)
    _limit(recover_limit, request, _client_ip(request))
    row = db.find_user(conn, _username(body.username))
    name = row["username"].lower() if row else ""
    if row and account_fail_limit.blocked(conn, name):
        raise _error(429, "too_many_attempts")
    if not row or not auth.recovery_matches(body.recovery_code, row["recovery_hash"]):
        if row:
            account_fail_limit.record(conn, name)
        raise _error(401, "bad_recovery")
    _check_new_password(body.new_password)
    db.set_password(conn, row["id"], auth.hash_password(body.new_password))
    code = auth.new_recovery_code()
    db.set_recovery_hash(conn, row["id"], auth.recovery_hash(code))
    _start_session(request, response, row["id"])
    return {"id": row["id"], "username": row["username"], "recovery_code": code}


@router.post("/auth/delete", status_code=204)
def delete_account(body: Password, user: User, request: Request, response: Response):
    """회원 탈퇴. 실수 방지로 비밀번호를 한 번 더 받는다"""
    _limit(login_limit, request, _client_ip(request))
    row = db.get_user(_conn(request), user["id"])
    _verify_or_count(request, row, body.password)
    db.delete_user(_conn(request), user["id"])
    response.delete_cookie(COOKIE, path="/")


# ---- 회원별 플레이어 프로필 ----


HeroId = Annotated[str, StringConstraints(max_length=40)]
Nickname = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
MAX_ALIASES = 10


class PlayerIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=40)
    # 부계정 닉네임. 데스크톱 앱은 대표 이름과 이 닉네임을 모두 점수판 이름과 맞춰 본다
    aliases: list[Nickname] = Field(default=[], max_length=MAX_ALIASES)
    is_me: bool = False
    preferred_roles: list[Role] = Field(default=[], max_length=3)
    heroes: list[HeroId] = Field(default=[], max_length=100)
    only_preferred: bool = False


MAX_PLAYERS = 50


@router.get("/players")
def players(user: User, request: Request):
    return db.list_players(_conn(request), user["id"])


@router.post("/players", status_code=201)
def create_player(body: PlayerIn, user: User, request: Request):
    if len(db.list_players(_conn(request), user["id"])) >= MAX_PLAYERS:
        raise _error(422, "too_many_players")
    return db.save_player(_conn(request), user_id=user["id"], **body.model_dump())


@router.put("/players/{player_id}")
def update_player(player_id: int, body: PlayerIn, user: User, request: Request):
    p = db.save_player(_conn(request), user_id=user["id"], player_id=player_id, **body.model_dump())
    if not p:
        raise _error(404, "player_not_found")
    return p


@router.delete("/players/{player_id}", status_code=204)
def delete_player(player_id: int, user: User, request: Request):
    if not db.delete_player(_conn(request), player_id, user["id"]):
        raise _error(404, "player_not_found")
