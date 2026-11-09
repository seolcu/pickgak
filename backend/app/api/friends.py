"""친구: 회원끼리 아이디로 요청하고 받으면 친구가 된다.

친구가 된 사람의 '나' 프로필(선호 역할·영웅)은 파티원 후보로 보인다. 그 사람이 프로필을 고치면 그대로 따라온다.
"""

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app import auth, db
from app.api.account import User, _conn, _error, _limit, _username

router = APIRouter(prefix="/api")

# 한 사람이 가질 수 있는 친구+보낸 요청, 그리고 쌓아 둘 수 있는 받은 요청 수
MAX_FRIENDS = 100
# 요청 남발(아이디 훑기·스팸) 막기: 회원마다 1시간에 30번
request_limit = auth.RateLimiter("friend_request", 30, 3600)


class FriendRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=40)


@router.get("/friends")
def friends(user: User, request: Request):
    return db.list_friends(_conn(request), user["id"])


@router.post("/friends", status_code=201)
def request_friend(body: FriendRequest, user: User, request: Request):
    conn = _conn(request)
    _limit(request_limit, request, str(user["id"]))
    other = db.find_user(conn, _username(body.username))
    if not other:
        raise _error(404, "user_not_found")
    if other["id"] == user["id"]:
        raise _error(422, "friend_self")
    if db.friend_count(conn, user["id"]) >= MAX_FRIENDS or db.incoming_count(conn, other["id"]) >= MAX_FRIENDS:
        raise _error(422, "friend_limit")
    status = db.request_friend(conn, user["id"], other["id"])
    if status == "already":
        raise _error(409, "already_friends")
    if status == "pending":
        raise _error(409, "request_pending")
    return {"status": status, "user_id": other["id"], "username": other["username"]}


@router.post("/friends/{user_id}/accept", status_code=204)
def accept_friend(user_id: int, user: User, request: Request):
    conn = _conn(request)
    if db.friend_count(conn, user["id"]) >= MAX_FRIENDS:
        raise _error(422, "friend_limit")
    if not db.accept_friend(conn, user["id"], user_id):
        raise _error(404, "request_not_found")


@router.delete("/friends/{user_id}", status_code=204)
def remove_friend(user_id: int, user: User, request: Request):
    """친구 끊기·보낸 요청 취소·받은 요청 거절"""
    if not db.remove_friend(_conn(request), user["id"], user_id):
        raise _error(404, "request_not_found")
