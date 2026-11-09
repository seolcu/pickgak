from datetime import datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field, StringConstraints

from app import collect, db, downloads, map_images
from app.analysis import insights, meta
from app.collector import nexon
from app.recommend.bans import recommend_bans
from app.recommend.engine import BanRules, Context, InvalidSituation, Queue, recommend, validate_bans
from app.recommend.party import Member, recommend_party

router = APIRouter(prefix="/api")

# 요청 크기 상한: 영웅·전장 id는 짧은 문자열, 목록은 한 판에 나올 수 있는 만큼만
Id = Annotated[str, StringConstraints(max_length=40)]
# 등급 하나 또는 합친 등급 ("bronze+silver+gold")
RankId = Annotated[str, StringConstraints(max_length=100)]
HeroList = Annotated[list[Id], Field(max_length=12)]

Role = Literal["tank", "damage", "support"]
Region = Literal["korea", "asia", "americas", "europe"]
RANKS = ["all", "bronze", "silver", "gold", "platinum", "emerald", "diamond", "master", "grandmaster"]
QUICK, COMPETITIVE = "0", "2"


def _no_input(f: dict) -> dict:
    return {k: v for k, v in f.items() if k != "input"}


def normalize_rank(rank: str) -> str:
    """등급 하나, 또는 경기 등급 범위처럼 합친 등급("bronze+silver"). 합친 등급은 알려진 등급만, 낮은 등급부터,
    겹치지 않게 다시 쓴다. 맞지 않으면 422."""
    if "+" not in rank:
        return rank
    parts = rank.split("+")
    tiers = RANKS[1:]
    if len(parts) > len(tiers) or any(p not in tiers for p in parts) or len(set(parts)) != len(parts):
        raise HTTPException(status_code=422, detail="bad rank")
    return "+".join(sorted(parts, key=tiers.index)) if len(parts) > 1 else parts[0]


def stat_filters(region: str, rq: str, rank: str) -> dict:
    """통계 조회 조건. PC만 다루고, 빠른 대전은 등급이 없으므로 항상 등급 합산."""
    return {"region": region, "rq": rq, "rank": "all" if rq == QUICK else normalize_rank(rank), "input": "pc"}


def _conn(request: Request):
    return request.app.state.db.get()


def invalid_situation_handler(_request: Request, exc: InvalidSituation):
    return JSONResponse(status_code=422, content={"detail": {"code": exc.code, "params": exc.params}})


def _no_data():
    return HTTPException(404, {"code": "no_data", "params": {}})


@router.get("/config")
def config(request: Request):
    conn = _conn(request)
    queues: dict[str, Queue] = request.app.state.queues
    return {
        "queues": {
            q.id: {"team_size": q.team_size, "slots": q.slots, "stats_fallback": q.stats_fallback, "default": q.default}
            for q in queues.values()
        },
        "modes": {"quick": "0", "competitive": "2"},
        "ranks": RANKS,
        "roles": ["tank", "damage", "support"],
        "regions": list(nexon.REGIONS),
        "bans": _bans_config(request.app.state.bans),
        "last_collected": {r: db.last_collected(conn, region=r) for r in nexon.REGIONS},
        "collecting": collect.LOCK.locked(),
    }


@router.get("/heroes")
def heroes(request: Request, lang: str = "ko"):
    return db.list_heroes(_conn(request), lang)


@router.get("/maps")
def maps(request: Request, lang: str = "ko", region: Region = "korea", rq: str = "2", rank: str = "all"):
    conn = _conn(request)
    with_data = db.maps_with_data(conn, **stat_filters(region, rq, rank))
    return [{**m, "has_data": m["map_id"] in with_data} for m in db.list_maps(conn, lang)]


@router.get("/meta")
def meta_tiers(request: Request, map: str = "all", region: Region = "korea", rq: str = "2", rank: str = "all"):
    fetched_at, stats = db.latest_stats(_conn(request), **stat_filters(region, rq, rank), map=map)
    if not stats:
        raise _no_data()
    return {"fetched_at": fetched_at, "heroes": meta.score_heroes(stats)}


@router.get("/trends")
def trends(
    request: Request,
    map: str = "all",
    region: Region = "korea",
    rq: str = "2",
    rank: str = "all",
    since: Literal["prev", "7d", "30d"] = "prev",
):
    conn = _conn(request)
    f = {**stat_filters(region, rq, rank), "map": map}
    cur_at, cur = db.latest_stats(conn, **f)
    if not cur:
        raise _no_data()
    # 비교 기준: 지난 수집 / 7일 전 / 30일 전 (그 시점 이전의 가장 최근 수집)
    if since == "prev":
        before = cur_at
    else:
        days = int(since[:-1])
        before = (datetime.fromisoformat(cur_at) - timedelta(days=days)).isoformat(timespec="seconds")
    prev_at, prev = db.latest_stats(conn, **f, before=before)
    # 스파크라인용 승률 추이 (최근 30회)
    series: dict[str, list[float | None]] = {}
    hist = db.history(conn, **f)
    for _, rows in hist:
        by = {r["hero_id"]: r["win_rate"] for r in rows}
        for h in cur:
            series.setdefault(h["hero_id"], []).append(by.get(h["hero_id"]))
    return {
        "current": cur_at,
        "previous": prev_at,
        "changes": meta.compare(cur, prev) if prev else [],
        "series": series,
    }


@router.get("/heroes/{hero_id}/detail")
def hero_detail(hero_id: str, request: Request, region: Region = "korea", rq: str = "2", rank: str = "all"):
    detail = insights.hero_detail(
        _conn(request), hero_id, **_no_input(stat_filters(region, rq, rank)), matchups=request.app.state.matchups
    )
    if detail is None:
        raise _no_data()
    return detail


@router.get("/maps/{map_id}/image")
def map_image(map_id: str, request: Request):
    # 우리 맵 목록에 있는 id만 (임의의 주소를 대신 받아 오지 않게)
    if map_id not in {m["map_id"] for m in db.list_maps(_conn(request))}:
        raise HTTPException(404, {"code": "unknown_map", "params": {}})
    path = map_images.image_path(map_id)
    if path is None:
        raise HTTPException(404, {"code": "image_unavailable", "params": {}})
    return FileResponse(
        path, media_type=map_images.MEDIA_TYPES[path.suffix], headers={"Cache-Control": "public, max-age=604800"}
    )


@router.get("/app/latest")
def app_latest():
    """데스크톱 앱 최신 버전과 내려받을 파일 (아직 없으면 404)."""
    info = downloads.latest()
    if info is None:
        raise HTTPException(404, {"code": "no_download", "params": {}})
    return JSONResponse(info, headers={"Cache-Control": "no-cache"})


@router.get("/app/download/{name}")
def app_download(name: str):
    path = downloads.file_path(name)
    if path is None:
        raise HTTPException(404, {"code": "no_download", "params": {}})
    return FileResponse(
        path,
        media_type="application/octet-stream",
        filename=name,
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.get("/ranks/{rank}/image")
def rank_image(rank: str):
    path = map_images.rank_image_path(rank)
    if path is None:
        raise HTTPException(404, {"code": "image_unavailable", "params": {}})
    return FileResponse(
        path, media_type=map_images.MEDIA_TYPES[path.suffix], headers={"Cache-Control": "public, max-age=604800"}
    )


@router.get("/maps/insights")
def maps_insights(request: Request, region: Region = "korea", rq: str = "2", rank: str = "all"):
    f = stat_filters(region, rq, rank)
    return insights.map_specialists(_conn(request), region=f["region"], rq=f["rq"], rank=f["rank"])


def _bans_config(rules: BanRules) -> dict:
    return {
        "modes": [COMPETITIVE],
        "per_team": rules.per_team,
        "lobby": rules.lobby,
        "total": rules.total,
        "max_per_role": rules.max_per_role,
        "votes": list(rules.votes),
        "high_ban_rate": rules.high_ban_rate,
    }


def _team_comps(ctx: Context, body: Situation) -> dict:
    """두 팀의 조합 유형 (다이브·포킹·러쉬·앵커, 뚜렷하지 않으면 None). 2명 이상 정해졌을 때만"""

    def comp(team: list[str]) -> str | None:
        return ctx.comps.dominant(team) if ctx.comps and len(team) >= 2 else None

    return {"allies": comp(body.allies), "enemies": comp(body.enemies)}


class Situation(BaseModel):
    region: Region = "korea"
    rq: Id = "2"
    rank: RankId = "all"
    map: Id = "all"
    bans: HeroList = []
    queue: Id = "role_queue"
    allies: HeroList = []
    enemies: HeroList = []
    preferred_only: bool = False
    # 이번 판에 로비 밴(5번째 금지)이 있었는지
    lobby_ban: bool = False
    # 위험 플레이어(유난히 잘하는 상대)로 표시한 적 영웅
    threats: HeroList = []


def _context(body: Situation, request: Request) -> tuple[Context, Queue, bool]:
    queues: dict[str, Queue] = request.app.state.queues
    if body.queue not in queues:
        raise InvalidSituation("unknown_queue", queue=body.queue)
    conn = _conn(request)
    f = stat_filters(body.region, body.rq, body.rank)
    _, overall = db.latest_stats(conn, **f, map="all")
    if not overall:
        raise _no_data()
    on_map = db.latest_stats(conn, **f, map=body.map)[1] if body.map != "all" else []
    # 밴은 경쟁전에만 있다. 밴이 다 정해지기 전에는 밴률 높은 추천에 경고를 붙인다
    rules: BanRules | None = request.app.state.bans if body.rq == COMPETITIVE else None
    ban_warn = rules.high_ban_rate if rules and len(body.bans) < rules.total_with(body.lobby_ban) else None
    ctx = Context.build(
        overall,
        on_map,
        request.app.state.matchups,
        request.app.state.weights,
        banned=body.bans,
        ban_warn=ban_warn,
        threats=[h for h in body.threats if h in body.enemies],
        comps=request.app.state.comps,
        map=body.map,
    )
    validate_bans(ctx, rules, body.bans, body.allies + body.enemies, body.lobby_ban)
    return ctx, queues[body.queue], bool(on_map) or body.map == "all"


class RecommendRequest(Situation):
    role: Role | None = None
    preferred: Annotated[list[Id], Field(max_length=100)] = []
    top: int = Field(5, ge=1, le=20)


@router.post("/recommend")
def recommend_heroes(body: RecommendRequest, request: Request):
    ctx, queue, map_has_data = _context(body, request)
    recs = recommend(
        ctx,
        queue=queue,
        role=body.role,
        allies=body.allies,
        enemies=body.enemies,
        preferred=set(body.preferred),
        preferred_only=body.preferred_only,
        top=body.top,
    )
    return {
        "map_has_data": map_has_data,
        "stats_fallback": queue.stats_fallback,
        "comps": _team_comps(ctx, body),
        "recommendations": recs,
    }


class MemberIn(BaseModel):
    key: Id
    role: Role | None = None
    preferred: Annotated[list[Id], Field(max_length=100)] = []
    preferred_roles: list[Role] = Field(default=[], max_length=3)
    # 이 사람에게는 선호 영웅만 추천 (없으면 요청 전체의 preferred_only를 따른다)
    preferred_only: bool | None = None


class PartyRequest(Situation):
    members: list[MemberIn] = Field(..., min_length=1, max_length=6)
    top: int = Field(3, ge=1, le=10)


@router.post("/party")
def party(body: PartyRequest, request: Request):
    ctx, queue, map_has_data = _context(body, request)
    members = [
        Member(
            m.key,
            m.role,
            set(m.preferred),
            list(m.preferred_roles),
            body.preferred_only if m.preferred_only is None else m.preferred_only,
        )
        for m in body.members
    ]
    result = recommend_party(
        ctx,
        queue=queue,
        members=members,
        allies=body.allies,
        enemies=body.enemies,
        top=body.top,
    )
    return {
        "map_has_data": map_has_data,
        "stats_fallback": queue.stats_fallback,
        "comps": _team_comps(ctx, body),
        **result,
    }


class BansRequest(Situation):
    # 우리가 하고 싶은 영웅 (나·파티원의 선호 영웅). 이 영웅들은 밴 추천에서 빼고, 이들을 카운터하는 영웅을 위로
    protect: Annotated[list[Id], Field(max_length=200)] = []
    # 우리 파티 인원(나 포함). 적을수록 다른 팀원도 표를 줄 만한(밴률 높은) 영웅을 크게 본다
    party_size: int = Field(1, ge=1, le=6)
    top: int = Field(3, ge=1, le=10)


@router.post("/bans")
def bans(body: BansRequest, request: Request):
    if body.rq != COMPETITIVE:
        raise InvalidSituation("bans_not_allowed")
    ctx, queue, map_has_data = _context(body, request)
    rules: BanRules = request.app.state.bans
    party_size = min(body.party_size, queue.team_size)
    popularity, threat = rules.weights_for((party_size - 1) / max(queue.team_size - 1, 1))
    recs = recommend_bans(
        ctx,
        rules,
        protect=set(body.protect),
        allies=body.allies,
        enemies=body.enemies,
        banned=body.bans,
        party_size=party_size,
        team_size=queue.team_size,
        top=body.top,
    )
    return {
        "map_has_data": map_has_data,
        "weights": {"party_size": party_size, "team_size": queue.team_size, "popularity": popularity, "threat": threat},
        "recommendations": recs,
    }
