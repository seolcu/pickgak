import pytest
from fastapi.testclient import TestClient

from app import db
from app.collector import nexon


@pytest.fixture
def client(parsed, tmp_path, monkeypatch):
    path = tmp_path / "api.db"
    conn = db.connect(path)
    db.save_filters(conn, parsed["filters"])
    db.save_snapshot(conn, nexon.Query(), parsed["heroes"], fetched_at="2026-10-24T00:00:00+00:00")
    db.save_snapshot(conn, nexon.Query(map="ilios"), parsed["heroes"], fetched_at="2026-10-24T00:00:00+00:00")
    conn.close()
    monkeypatch.setenv("PICKGAK_DB", str(path))
    monkeypatch.setenv("PICKGAK_AUTOCOLLECT", "0")
    from app.main import app

    with TestClient(app) as c:
        yield c


def test_config(client):
    cfg = client.get("/api/config").json()
    assert cfg["queues"]["role_queue"]["slots"] == {"tank": 1, "damage": 2, "support": 2}
    assert cfg["queues"]["open_queue"]["team_size"] == 6
    assert cfg["queues"]["other"] == {"team_size": 5, "slots": None, "stats_fallback": True, "default": False}
    assert cfg["last_collected"]["korea"].startswith("2026-10-24")


def test_recommend_and_validation(client):
    body = {"map": "ilios", "role": "damage", "enemies": ["pharah"], "allies": ["ana"]}
    r = client.post("/api/recommend", json=body).json()
    assert r["map_has_data"] and len(r["recommendations"]) == 5
    assert all(x["role"] == "damage" for x in r["recommendations"])

    bad = client.post("/api/recommend", json={"enemies": ["reinhardt", "winston"]})
    assert bad.status_code == 422
    assert bad.json()["detail"] == {"code": "too_many_role", "params": {"team": "enemies", "role": "tank", "limit": 1}}


def test_party(client):
    body = {"members": [{"key": "me", "role": "tank"}, {"key": "friend", "role": "support"}], "enemies": ["genji"]}
    r = client.post("/api/party", json=body).json()
    assert len(r["combos"]) == 3 and set(r["alternatives"]) == {"me", "friend"}


def _signup(client, name="tester", password="password123"):
    r = client.post("/api/auth/signup", json={"username": name, "password": password})
    assert r.status_code == 201, r.text
    return r.json()


def test_players_crud(client):
    assert client.get("/api/players").status_code == 401  # 비회원은 서버에 프로필이 없다
    _signup(client)
    me = client.post(
        "/api/players", json={"name": "나", "is_me": True, "heroes": ["ana", "kiriko"], "only_preferred": True}
    ).json()
    assert me["only_preferred"] is True
    friend = client.post("/api/players", json={"name": "친구", "preferred_roles": ["tank"]}).json()
    client.put(f"/api/players/{friend['id']}", json={"name": "친구", "is_me": True})
    players = {p["id"]: p for p in client.get("/api/players").json()}
    assert players[friend["id"]]["is_me"] and not players[me["id"]]["is_me"]
    assert client.delete(f"/api/players/{me['id']}").status_code == 204
    assert client.delete(f"/api/players/{me['id']}").status_code == 404
    assert client.put("/api/players/999", json={"name": "x"}).status_code == 404


def test_player_aliases(client):
    _signup(client)
    p = client.post("/api/players", json={"name": "Main", "aliases": [" Alt ", "main", "alt", "Smurf"]}).json()
    # 공백은 빼고, 대표 이름이나 앞의 닉네임과 겹치는 것은 버린다 (대소문자 무시)
    assert p["aliases"] == ["Alt", "Smurf"]
    assert client.put(f"/api/players/{p['id']}", json={"name": "Main"}).json()["aliases"] == []
    assert client.post("/api/players", json={"name": "x", "aliases": [""]}).status_code == 422
    assert client.post("/api/players", json={"name": "x", "aliases": ["a" * 41]}).status_code == 422
    assert client.post("/api/players", json={"name": "x", "aliases": [f"a{i}" for i in range(11)]}).status_code == 422


def test_localized_lists(client):
    heroes = client.get("/api/heroes?lang=en").json()
    assert any(h["hero_id"] == "genji" for h in heroes)  # 영어 이름이 없으면 한국어로 대체


def test_quick_play_ignores_rank(client):
    # 빠른 대전은 등급이 없으므로 rank를 줘도 등급 합산 데이터로 응답한다 (fixture는 경쟁전만 있으므로 404여야 함)
    assert client.get("/api/meta?rq=0&rank=gold").status_code == 404
    assert client.get("/api/meta?rq=2&rank=gold").status_code == 404
    assert client.get("/api/meta?rq=2&rank=all").status_code == 200


def test_maps_has_data_and_config_regions(client):
    maps = {m["map_id"]: m["has_data"] for m in client.get("/api/maps").json()}
    assert maps["ilios"] is True and maps["nepal"] is False
    cfg = client.get("/api/config").json()
    assert cfg["regions"] == ["korea", "asia", "americas", "europe"]
    assert cfg["last_collected"]["korea"] and cfg["last_collected"]["asia"] is None
    assert cfg["collecting"] is False


def test_bans_api(client):
    cfg = client.get("/api/config").json()
    assert cfg["bans"]["total"] == 4 and cfg["bans"]["modes"] == ["2"]
    r = client.post("/api/bans", json={"protect": ["pharah"], "bans": ["ana"], "party_size": 2})
    assert r.status_code == 200 and len(r.json()["recommendations"]) == 3
    assert r.json()["weights"]["party_size"] == 2
    assert client.post("/api/bans", json={"rq": "0"}).json()["detail"]["code"] == "bans_not_allowed"
    # 금지된 영웅을 고르면 거부, 추천에서도 빠진다
    bad = client.post("/api/recommend", json={"bans": ["genji"], "enemies": ["genji"]})
    assert bad.json()["detail"]["code"] == "banned_hero_picked"
    recs = client.post("/api/recommend", json={"bans": ["genji"], "role": "damage", "top": 20}).json()
    assert "genji" not in {x["hero_id"] for x in recs["recommendations"]}


def test_concurrent_requests(client):
    # 추천·밴·파티 요청이 동시에 와도 DB 연결 오류(500)가 나지 않아야 한다
    from concurrent.futures import ThreadPoolExecutor

    calls = [
        lambda: client.post("/api/recommend", json={"role": "damage"}),
        lambda: client.post("/api/bans", json={"protect": ["ana"]}),
        lambda: client.post("/api/party", json={"members": [{"key": "a", "role": "tank"}, {"key": "b"}]}),
        lambda: client.get("/api/meta"),
        lambda: client.get("/api/maps"),
    ] * 8
    with ThreadPoolExecutor(max_workers=8) as pool:
        codes = [f.result().status_code for f in [pool.submit(c) for c in calls]]
    assert set(codes) == {200}


def test_insight_endpoints(client):
    d = client.get("/api/heroes/genji/detail").json()
    assert d["summary"]["hero_id"] == "genji" and {m["map_id"] for m in d["maps"]} == {"ilios"}
    assert client.get("/api/heroes/nobody/detail").status_code == 404
    assert "maps" in client.get("/api/maps/insights").json()
    t = client.get("/api/trends?since=7d").json()
    assert t["previous"] is None and len(t["series"]["genji"]) == 1


def test_map_image(client, tmp_path, monkeypatch):
    from app import map_images

    calls = []

    class Resp:
        content = b"\xff\xd8jpeg"
        headers = {"content-type": "image/jpeg"}

        def raise_for_status(self):
            pass

    monkeypatch.setattr(map_images, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(map_images.httpx, "get", lambda url, **kw: calls.append(url) or Resp())
    monkeypatch.setattr(map_images.image_path, "__defaults__", (tmp_path,))
    r = client.get("/api/maps/ilios/image")
    assert r.status_code == 200 and r.content == b"\xff\xd8jpeg"
    client.get("/api/maps/ilios/image")
    assert len(calls) == 1  # 두 번째는 캐시에서
    assert client.get("/api/maps/not-a-map/image").status_code == 404


def test_map_image_falls_back_to_second_source(client, tmp_path, monkeypatch):
    import httpx

    from app import map_images

    class Resp:
        def __init__(self, ok, ctype):
            self.ok, self.headers, self.content = ok, {"content-type": ctype}, b"RIFFwebp"

        def raise_for_status(self):
            if not self.ok:
                raise httpx.HTTPStatusError("404", request=None, response=None)

    def fake_get(url, **kw):
        return Resp(False, "text/html") if "overfast" in url else Resp(True, "image/webp")

    monkeypatch.setattr(map_images.httpx, "get", fake_get)
    monkeypatch.setattr(map_images.image_path, "__defaults__", (tmp_path,))
    monkeypatch.setattr(map_images, "_missing", {})
    r = client.get("/api/maps/nepal/image")
    assert r.status_code == 200 and r.headers["content-type"] == "image/webp"
    assert (tmp_path / "nepal.webp").exists()


def test_rank_image(client, tmp_path, monkeypatch):
    from app import map_images

    class Resp:
        content, headers = b"RIFFwebp", {"content-type": "image/webp"}

        def raise_for_status(self):
            pass

    monkeypatch.setattr(map_images.httpx, "get", lambda url, **kw: Resp())
    monkeypatch.setattr(map_images.rank_image_path, "__defaults__", (tmp_path,))
    assert client.get("/api/ranks/gold/image").headers["content-type"] == "image/webp"
    assert client.get("/api/ranks/wood/image").status_code == 404


def test_accounts(client):

    assert client.get("/api/auth/me").json() is None
    assert client.post("/api/auth/signup", json={"username": "a", "password": "password123"}).status_code == 422
    assert client.post("/api/auth/signup", json={"username": "철수", "password": "short"}).status_code == 422
    alice = _signup(client, "철수")
    assert client.get("/api/auth/me").json()["username"] == "철수"
    mine = client.post("/api/players", json={"name": "나", "is_me": True}).json()
    # 같은 아이디(대소문자 무관)는 다시 못 만든다
    assert client.post("/api/auth/signup", json={"username": "철수", "password": "password123"}).status_code == 409

    # 다른 회원은 내 프로필을 보지도, 고치지도, 지우지도 못한다
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").json() is None
    _signup(client, "Bob")
    assert client.get("/api/players").json() == []
    assert client.put(f"/api/players/{mine['id']}", json={"name": "해킹"}).status_code == 404
    assert client.delete(f"/api/players/{mine['id']}").status_code == 404
    client.post("/api/players", json={"name": "밥", "is_me": True})  # 내 '나'는 다른 회원의 '나'와 별개

    client.post("/api/auth/logout")
    assert client.post("/api/auth/login", json={"username": "철수", "password": "wrong-pass"}).status_code == 401
    assert client.post("/api/auth/login", json={"username": "없음", "password": "password123"}).status_code == 401
    assert (
        client.post("/api/auth/login", json={"username": "철수", "password": "password123"}).json()["id"] == alice["id"]
    )
    assert [p["name"] for p in client.get("/api/players").json()] == ["나"]
    assert client.get("/api/players").json()[0]["is_me"]

    # 탈퇴: 비밀번호 확인 후 세션·프로필까지 삭제
    assert client.post("/api/auth/delete", json={"password": "wrong-pass"}).status_code == 401
    assert client.post("/api/auth/delete", json={"password": "password123"}).status_code == 204
    assert client.get("/api/auth/me").json() is None
    assert client.post("/api/auth/login", json={"username": "철수", "password": "password123"}).status_code == 401


def test_login_rate_limit(client):

    codes = [client.post("/api/auth/login", json={"username": "x", "password": "y"}).status_code for _ in range(11)]
    assert codes[:10] == [401] * 10 and codes[10] == 429


def test_password_hash():
    from app import auth

    h = auth.hash_password("비밀번호123")
    assert h.startswith("scrypt$") and "비밀번호" not in h
    assert auth.verify_password("비밀번호123", h)
    assert not auth.verify_password("비밀번호124", h)
    assert not auth.verify_password("x", "garbage")


def test_cross_origin_writes_are_rejected(client):

    body = {"username": "csrf", "password": "password123"}
    evil = client.post("/api/auth/signup", json=body, headers={"Origin": "https://evil.example"})
    assert evil.status_code == 403 and evil.json()["detail"]["code"] == "cross_origin"
    site = client.post("/api/auth/logout", headers={"Sec-Fetch-Site": "cross-site"})
    assert site.status_code == 403
    same = client.post("/api/auth/signup", json=body, headers={"Origin": "http://testserver"})
    assert same.status_code == 201
    # 읽기 요청은 막지 않는다
    assert client.get("/api/auth/me", headers={"Origin": "https://evil.example"}).status_code == 200


def test_security_headers_and_no_store(client):
    r = client.get("/api/config")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert "content-security-policy" not in r.headers  # CSP는 화면(HTML)에만
    assert client.get("/api/auth/me").headers["cache-control"] == "no-store"


def test_request_size_limits(client):
    too_many = {"enemies": [f"h{i}" for i in range(13)]}
    assert client.post("/api/recommend", json=too_many).status_code == 422
    assert client.post("/api/recommend", json={"map": "x" * 41}).status_code == 422


def test_per_account_lockout_and_forwarded_ip(client, monkeypatch):

    _signup(client, "target")
    client.post("/api/auth/logout")
    monkeypatch.setenv("PICKGAK_TRUST_PROXY", "1")
    # 매번 다른 IP(맨 오른쪽 = 프록시가 본 주소)로 틀려도 계정 단위로 막힌다. 맨 왼쪽 값은 무시
    for i in range(10):
        r = client.post(
            "/api/auth/login",
            json={"username": "TARGET", "password": "wrong-pass"},
            headers={"X-Forwarded-For": f"1.1.1.1, 10.0.0.{i}"},
        )
        assert r.status_code == 401
    r = client.post(
        "/api/auth/login",
        json={"username": "target", "password": "password123"},
        headers={"X-Forwarded-For": "10.0.1.1"},
    )
    assert r.status_code == 429


def test_csp_hashes_inline_script(tmp_path):
    from app.security import content_security_policy, inline_script_hashes

    (tmp_path / "index.html").write_text(
        '<script>var a=1;</script><script type="module" src="/x.js"></script>', encoding="utf-8"
    )
    hashes = inline_script_hashes(tmp_path / "index.html")
    assert len(hashes) == 1 and hashes[0].startswith("'sha256-")
    csp = content_security_policy(hashes)
    assert "script-src 'self' 'sha256-" in csp and "frame-ancestors 'none'" in csp and "unsafe-eval" not in csp


def test_recovery_code_resets_password_once(client):
    code = _signup(client, "복구맨")["recovery_code"]
    assert len(code) == 23 and code.count("-") == 3
    client.post("/api/players", json={"name": "나", "is_me": True})
    client.post("/api/auth/logout")
    bad = {"username": "복구맨", "recovery_code": "AAAAA-AAAAA-AAAAA-AAAAA", "new_password": "newpassword1"}
    assert client.post("/api/auth/recover", json=bad).status_code == 401
    # 소문자·공백으로 적어도 된다
    ok = {"username": "복구맨", "recovery_code": " " + code.lower().replace("-", " "), "new_password": "newpassword1"}
    r = client.post("/api/auth/recover", json=ok)
    assert r.status_code == 200 and r.json()["recovery_code"] != code
    assert [p["name"] for p in client.get("/api/players").json()] == ["나"]  # 프로필은 그대로
    client.post("/api/auth/logout")
    assert client.post("/api/auth/recover", json=ok).status_code == 401  # 쓴 코드는 다시 못 쓴다
    login = {"username": "복구맨", "password": "newpassword1"}
    assert client.post("/api/auth/login", json=login).status_code == 200


def test_password_change_and_logout_everywhere(client, parsed):
    from fastapi.testclient import TestClient

    from app.main import app

    _signup(client, "phone")
    other = TestClient(app)  # 같은 앱, 다른 기기(쿠키 따로)
    assert other.post("/api/auth/login", json={"username": "phone", "password": "password123"}).status_code == 200
    assert other.get("/api/auth/me").json()

    wrong = {"current": "nope-nope", "new": "newpassword1"}
    assert client.post("/api/auth/password", json=wrong).status_code == 401
    assert client.post("/api/auth/password", json={"current": "password123", "new": "short"}).status_code == 422
    assert client.post("/api/auth/password", json={"current": "password123", "new": "newpassword1"}).status_code == 204
    assert client.get("/api/auth/me").json()["username"] == "phone"  # 이 기기는 그대로
    assert other.get("/api/auth/me").json() is None  # 다른 기기는 끊김

    assert other.post("/api/auth/login", json={"username": "phone", "password": "newpassword1"}).status_code == 200
    assert client.post("/api/auth/logout-all").status_code == 204
    assert client.get("/api/auth/me").json() is None and other.get("/api/auth/me").json() is None

    # 복구 코드 재발급은 비밀번호 확인 후
    client.post("/api/auth/login", json={"username": "phone", "password": "newpassword1"})
    assert client.post("/api/auth/recovery-code", json={"password": "wrong-pass"}).status_code == 401
    assert len(client.post("/api/auth/recovery-code", json={"password": "newpassword1"}).json()["recovery_code"]) == 23


def test_signup_spam_guards(client, monkeypatch):
    from app.api import account

    bot = {"username": "bot1", "password": "password123", "website": "http://spam"}
    assert client.post("/api/auth/signup", json=bot).status_code == 422
    monkeypatch.setattr(account, "SIGNUP_DAILY_CAP", 1)
    _signup(client, "first")
    r = client.post("/api/auth/signup", json={"username": "second", "password": "password123"})
    assert r.status_code == 429 and r.json()["detail"]["code"] == "signup_closed"


def test_rate_limits_survive_restart(parsed, tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    path = tmp_path / "limits.db"
    db.connect(path).close()
    monkeypatch.setenv("PICKGAK_DB", str(path))
    monkeypatch.setenv("PICKGAK_AUTOCOLLECT", "0")
    from app.main import app

    bad = {"username": "x", "password": "y"}
    with TestClient(app) as c:
        assert [c.post("/api/auth/login", json=bad).status_code for _ in range(10)] == [401] * 10
    with TestClient(app) as c:  # 재시작
        assert c.post("/api/auth/login", json=bad).status_code == 429
    # IP는 해시로만 남는다
    keys = [r[0] for r in db.connect(path, migrate=False).execute("SELECT key FROM auth_attempts")]
    assert keys and all("testclient" not in k and len(k) == 32 for k in keys)


def test_threats_and_comps_in_api(client):
    body = {"enemies": ["genji"], "allies": [], "role": "damage", "threats": ["genji", "ana"], "top": 20}
    r = client.post("/api/recommend", json=body)
    assert r.status_code == 200
    data = r.json()
    assert data["comps"] == {"allies": None, "enemies": None}
    # 상대에 없는 영웅은 위험 플레이어로 보지 않는다 (ana는 무시)
    kinds = {x["kind"] for rec in data["recommendations"] for x in rec["reasons"]}
    assert "threat_counter" in kinds or "threat_weak" in kinds


def test_combined_ranks_merge_tier_stats(client, parsed, tmp_path):
    """경기 등급 범위가 두 등급에 걸치면 두 등급 통계를 합친다 (같은 판 수로 보고, 승률은 픽률 가중)."""
    conn = db.connect(tmp_path / "ranks.db")
    base = next(h for h in parsed["heroes"] if h["hero_id"] == "genji")
    for rank, (win, pick) in {"bronze": (40.0, 10.0), "silver": (60.0, 30.0)}.items():
        hero = {**base, "win_rate": win, "pick_rate": pick, "ban_rate": 2.0}
        db.save_snapshot(conn, nexon.Query(rank=rank), [hero], fetched_at="2026-10-26T00:00:00+00:00")
    _, rows = db.latest_stats(conn, region="korea", rq="2", rank="bronze+silver")
    g = next(r for r in rows if r["hero_id"] == "genji")
    assert g["pick_rate"] == 20.0
    assert g["win_rate"] == (40 * 10 + 60 * 30) / 40
    assert g["ban_rate"] == 2.0
    # 순서가 섞여도 받고, 알 수 없거나 겹친 등급은 거절
    assert client.get("/api/meta", params={"rank": "silver+bronze"}).status_code in (200, 404)
    assert client.get("/api/meta", params={"rank": "bronze+wood"}).status_code == 422
    assert client.get("/api/meta", params={"rank": "bronze+bronze"}).status_code == 422


def test_app_download(client, monkeypatch):
    """데스크톱 앱 내려받기: GitHub 릴리스의 latest.json에 있고 실제로 붙은 파일만, 내려받기는 그쪽으로 보낸다."""
    from app import downloads

    gh = "https://github.com/seolcu/pickgak/releases/download/v2.5.1"

    def asset(name, size=3):
        return {"name": name, "size": size, "state": "uploaded", "browser_download_url": f"{gh}/{name}"}

    releases = [
        # 올리는 중인 릴리스 (latest.json이 아직 없다)와 초안은 건너뛴다
        {"draft": False, "assets": [asset("PickGak_2.6.0_x64-setup.exe")]},
        {"draft": True, "assets": [asset("latest.json")]},
        {
            "draft": False,
            "assets": [
                asset("latest.json"),
                asset("PickGak-2.5.1-1.x86_64.rpm"),
                asset("PickGak_2.5.1_amd64.AppImage", 7),
                asset("PickGak_2.5.1_x64-setup.exe"),
                asset("secret.txt"),
            ],
        },
    ]
    listing = {
        "version": "2.5.1",
        "released": "2026-10-26",
        "files": [
            {"name": "PickGak-2.5.1-1.x86_64.rpm", "kind": "rpm", "sha256": "abc"},
            {"name": "PickGak_2.5.1_amd64.AppImage", "kind": "appimage"},
            {"name": "PickGak_2.5.1_x64-setup.exe", "kind": "exe"},
            {"name": "PickGak_2.5.1_amd64.deb", "kind": "deb"},  # 릴리스에 없다
            {"name": "PickGak-2.5.1-1.exe", "kind": "msi"},
            {"name": "secret.txt", "kind": "rpm"},
        ],
    }
    calls = []

    def fake(url):
        calls.append(url)
        if url.startswith("https://api.github.com/"):
            return releases
        assert url == f"{gh}/latest.json"
        return listing

    downloads.reset()
    monkeypatch.setattr(downloads, "get_json", lambda url: [])
    assert client.get("/api/app/latest").status_code == 404

    downloads.reset()
    monkeypatch.setattr(downloads, "get_json", fake)
    info = client.get("/api/app/latest").json()
    assert [f["name"] for f in info["files"]] == [
        "PickGak-2.5.1-1.x86_64.rpm",
        "PickGak_2.5.1_amd64.AppImage",
        "PickGak_2.5.1_x64-setup.exe",
    ]
    assert [f["os"] for f in info["files"]] == ["linux", "linux", "windows"]
    assert [f["size"] for f in info["files"]] == [3, 7, 3]
    assert "url" not in info["files"][0]
    r = client.get("/api/app/download/PickGak-2.5.1-1.x86_64.rpm", follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"] == f"{gh}/PickGak-2.5.1-1.x86_64.rpm"
    for bad in ["secret.txt", "..%2Fsecret.txt", "PickGak_2.5.1_amd64.deb", "PickGak-2.5.1-1.exe"]:
        assert client.get(f"/api/app/download/{bad}", follow_redirects=False).status_code == 404
    # GitHub에는 몇 분에 한 번만 묻는다
    assert len(calls) == 2

    # GitHub에 닿지 않으면 마지막 목록을 그대로 쓴다
    def down(url):
        raise downloads.httpx.ConnectError("down")

    downloads._cache["at"] = 1.0
    monkeypatch.setattr(downloads, "get_json", down)
    assert client.get("/api/app/latest").json()["version"] == "2.5.1"
    downloads.reset()


def test_flatpak_moved_to_pages(client):
    r = client.get("/api/flatpak/com.seolcu.pickgak.flatpakrepo", follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"] == "https://seolcu.github.io/pickgak/flatpak/com.seolcu.pickgak.flatpakrepo"


def test_login_ends_the_previous_session_in_this_browser(client):
    _signup(client, "rotate")
    old = client.cookies.get("pickgak_session")
    assert client.post("/api/auth/login", json={"username": "rotate", "password": "password123"}).status_code == 200
    assert client.cookies.get("pickgak_session") != old
    conn = db.connect(client.app.state.db.path, migrate=False)
    assert conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 1


def test_username_is_unicode_normalized(client):
    import unicodedata

    _signup(client, "한글")
    nfd = unicodedata.normalize("NFD", "한글")
    assert client.post("/api/auth/login", json={"username": nfd, "password": "password123"}).status_code == 200
    r = client.post("/api/auth/signup", json={"username": nfd, "password": "password123"})
    assert r.json()["detail"]["code"] == "username_taken"


def test_player_and_member_lists_are_bounded(client):
    _signup(client)
    long_id = {"name": "a", "heroes": ["x" * 41]}
    assert client.post("/api/players", json=long_id).status_code == 422
    many_roles = {"name": "a", "preferred_roles": ["tank"] * 4}
    assert client.post("/api/players", json=many_roles).status_code == 422
    party = {"members": [{"key": "a", "preferred_roles": ["tank"] * 4}]}
    assert client.post("/api/party", json=party).status_code == 422


def test_thread_connections_close_when_their_thread_ends(tmp_path):
    # anyio이 쉬는 작업 스레드를 없애고 새로 만들 때마다 연결이 남아 파일 핸들이 바닥났다
    import gc
    import threading

    from app import db

    pool = db.ThreadConnections(tmp_path / "t.db")
    for _ in range(50):
        t = threading.Thread(target=lambda: pool.get().execute("SELECT 1"))
        t.start()
        t.join()
    gc.collect()
    assert pool.open_count() == 0
    pool.get().execute("SELECT 1")
    assert pool.open_count() == 1
    pool.close_all()
