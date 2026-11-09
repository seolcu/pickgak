import pytest
from fastapi.testclient import TestClient

from app import db
from app.collector import nexon


@pytest.fixture
def app_(parsed, tmp_path, monkeypatch):
    path = tmp_path / "friends.db"
    conn = db.connect(path)
    db.save_snapshot(conn, nexon.Query(), parsed["heroes"], fetched_at="2026-10-24T00:00:00+00:00")
    conn.close()
    monkeypatch.setenv("PICKGAK_DB", str(path))
    monkeypatch.setenv("PICKGAK_AUTOCOLLECT", "0")
    from app.main import app

    with TestClient(app):
        yield app


def member(app, name):
    c = TestClient(app)
    assert c.post("/api/auth/signup", json={"username": name, "password": "password123"}).status_code == 201
    return c


def test_request_accept_and_profile(app_):
    a, b = member(app_, "alice"), member(app_, "bob")
    b.post(
        "/api/players",
        json={"name": "나", "aliases": ["부계"], "is_me": True, "preferred_roles": ["support"], "heroes": ["ana"]},
    )
    b.post("/api/players", json={"name": "다른 친구", "heroes": ["genji"]})

    r = a.post("/api/friends", json={"username": "BOB"})
    assert r.status_code == 201 and r.json()["status"] == "requested"
    assert a.post("/api/friends", json={"username": "bob"}).json()["detail"]["code"] == "request_pending"
    assert a.get("/api/friends").json()["outgoing"] == [{"user_id": r.json()["user_id"], "username": "bob"}]
    incoming = b.get("/api/friends").json()["incoming"]
    assert [p["username"] for p in incoming] == ["alice"]

    # 받기 전에는 프로필이 보이지 않는다
    assert a.get("/api/friends").json()["friends"] == []
    assert b.post(f"/api/friends/{incoming[0]['user_id']}/accept").status_code == 204
    [f] = a.get("/api/friends").json()["friends"]
    # 친구에게는 그 사람의 '나' 프로필만, 닉네임과 역할·영웅 선호만 보인다
    assert f["username"] == "bob"
    assert f["profile"] == {
        "name": "나",
        "aliases": ["부계"],
        "preferred_roles": ["support"],
        "heroes": ["ana"],
        "only_preferred": False,
    }
    assert b.get("/api/friends").json()["friends"][0]["profile"] is None  # alice는 '나' 프로필이 없다
    assert a.post("/api/friends", json={"username": "bob"}).json()["detail"]["code"] == "already_friends"


def test_crossing_requests_become_friends(app_):
    a, b = member(app_, "c1"), member(app_, "c2")
    assert a.post("/api/friends", json={"username": "c2"}).json()["status"] == "requested"
    assert b.post("/api/friends", json={"username": "c1"}).json()["status"] == "accepted"
    assert len(a.get("/api/friends").json()["friends"]) == 1


def test_errors_remove_and_isolation(app_):
    a, b, c = member(app_, "d1"), member(app_, "d2"), member(app_, "d3")
    assert a.post("/api/friends", json={"username": "nobody"}).json()["detail"]["code"] == "user_not_found"
    assert a.post("/api/friends", json={"username": "d1"}).json()["detail"]["code"] == "friend_self"
    bid = a.post("/api/friends", json={"username": "d2"}).json()["user_id"]
    aid = b.get("/api/friends").json()["incoming"][0]["user_id"]
    # 남의 요청을 대신 받거나, 보낸 사람이 스스로 받을 수 없다
    assert c.post(f"/api/friends/{aid}/accept").status_code == 404
    assert a.post(f"/api/friends/{bid}/accept").status_code == 404
    assert c.delete(f"/api/friends/{aid}").status_code == 404
    # 거절하면 사라진다
    assert b.delete(f"/api/friends/{aid}").status_code == 204
    assert a.get("/api/friends").json() == {"friends": [], "incoming": [], "outgoing": []}
    # 비회원은 쓸 수 없다
    assert TestClient(app_).get("/api/friends").status_code == 401


def test_deleting_an_account_removes_friendships(app_):
    a, b = member(app_, "e1"), member(app_, "e2")
    a.post("/api/friends", json={"username": "e2"})
    b.post("/api/friends", json={"username": "e1"})
    assert b.post("/api/auth/delete", json={"password": "password123"}).status_code == 204
    assert a.get("/api/friends").json()["friends"] == []


def test_friend_cap(app_, monkeypatch):
    from app.api import friends

    a = member(app_, "f0")
    for i in range(3):
        member(app_, f"f{i + 1}")
    monkeypatch.setattr(friends, "MAX_FRIENDS", 2)
    assert a.post("/api/friends", json={"username": "f1"}).status_code == 201
    assert a.post("/api/friends", json={"username": "f2"}).status_code == 201
    assert a.post("/api/friends", json={"username": "f3"}).json()["detail"]["code"] == "friend_limit"
