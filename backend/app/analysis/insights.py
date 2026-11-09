"""영웅 상세와 전장 분석.

통계 사이트들(owtics, ow-athena)이 보여 주는 맵별·모드별·등급별 지표에 더해,
픽각은 상성(유리/불리)과 시너지까지 한 화면에 묶는다.
"""

from statistics import pstdev

from app import db
from app.analysis.meta import score_heroes
from app.recommend.engine import MATCHUP_SHOWN, Matchups

# 픽률이 너무 낮은 영웅은 맵별 수치가 흔들리므로 맵 특화 순위에서 뺀다
MIN_PICK_FOR_MAP = 1.0


def _find(rows: list[dict], hero_id: str) -> dict | None:
    return next((r for r in rows if r["hero_id"] == hero_id), None)


def hero_detail(conn, hero_id: str, *, region: str, rq: str, rank: str, matchups: Matchups) -> dict | None:
    f = {"region": region, "rq": rq, "rank": rank, "input": "pc"}
    at, overall = db.latest_stats(conn, **f, map="all")
    scored = {h["hero_id"]: h for h in score_heroes(overall)}
    me = scored.get(hero_id)
    if not me:
        return None

    _, prev = db.latest_stats(conn, **f, map="all", before=at)
    p = _find(prev, hero_id)
    delta = (
        {"win": round(me["win_rate"] - p["win_rate"], 2), "pick": round(me["pick_rate"] - p["pick_rate"], 2)}
        if p and p["win_rate"] is not None and p["pick_rate"] is not None
        else None
    )

    # 맵별: 이 영웅의 승률·픽률, 전체 대비 승률 차이와 픽률 배율
    maps = []
    for map_id, (_, rows) in db.latest_by(conn, "map", region=region, rq=rq, rank=rank).items():
        r = _find(rows, hero_id)
        if map_id == "all" or not r or r["win_rate"] is None or r["pick_rate"] is None:
            continue
        maps.append(
            {
                "map_id": map_id,
                "win_rate": r["win_rate"],
                "pick_rate": r["pick_rate"],
                "win_diff": round(r["win_rate"] - me["win_rate"], 2),
                "pick_ratio": round(r["pick_rate"] / me["pick_rate"], 2) if me["pick_rate"] else None,
            }
        )
    maps.sort(key=lambda m: -m["win_rate"])
    mode_of = {m["map_id"]: m["mode"] for m in db.list_maps(conn)}
    modes: dict[str, list[dict]] = {}
    for m in maps:
        modes.setdefault(mode_of.get(m["map_id"], "other"), []).append(m)
    by_mode = [
        {
            "mode": mode,
            # 픽률 가중 평균 승률 (많이 한 맵에 무게)
            "win_rate": round(sum(x["win_rate"] * x["pick_rate"] for x in ms) / sum(x["pick_rate"] for x in ms), 2)
            if sum(x["pick_rate"] for x in ms)
            else None,
            "maps": len(ms),
        }
        for mode, ms in modes.items()
    ]
    wins = [m["win_rate"] for m in maps]
    # 숨은 강맵: 승률은 평소보다 높은데 덜 골라지는 맵
    hidden = [m for m in maps if m["win_diff"] >= 1.5 and (m["pick_ratio"] or 1) < 1]
    hidden.sort(key=lambda m: (-m["win_diff"], m["pick_ratio"] or 1))

    # 등급별 (경쟁전만 등급이 있다)
    ranks = []
    if rq == "2":
        for rk, (_, rows) in db.latest_by(conn, "rank", region=region, rq=rq, map="all").items():
            r = _find(rows, hero_id)
            if rk != "all" and r:
                ranks.append(
                    {"rank": rk, "win_rate": r["win_rate"], "pick_rate": r["pick_rate"], "ban_rate": r["ban_rate"]}
                )

    hist = [
        {"at": t, "win_rate": r["win_rate"], "pick_rate": r["pick_rate"], "ban_rate": r["ban_rate"]}
        for t, rows in db.history(conn, **f)
        if (r := _find(rows, hero_id))
    ]

    known = set(scored) - {hero_id}
    edge = {h: matchups.matchup(hero_id, h) for h in known}
    return {
        "fetched_at": at,
        "summary": {**me, "delta": delta},
        "maps": maps,
        "modes": sorted(by_mode, key=lambda m: -(m["win_rate"] or 0)),
        "map_spread": {
            "sigma": round(pstdev(wins), 2) if len(wins) > 1 else None,
            "min": min(wins) if wins else None,
            "max": max(wins) if wins else None,
        },
        "hidden_strong": hidden[:3],
        "ranks": ranks,
        "history": hist,
        "matchups": {
            # 상성이 강한 순서로
            "strong_vs": sorted((h for h in known if edge[h] >= MATCHUP_SHOWN), key=lambda h: -edge[h]),
            "weak_vs": sorted((h for h in known if edge[h] <= -MATCHUP_SHOWN), key=lambda h: edge[h]),
            "synergy": sorted(h for h in known if matchups.synergizes(hero_id, h)),
        },
    }


def map_specialists(conn, *, region: str, rq: str, rank: str, top: int = 5) -> dict:
    """맵마다 평소보다 훨씬 많이 골라지는(픽률 배율) 영웅과 승률 차이."""
    groups = db.latest_by(conn, "map", region=region, rq=rq, rank=rank)
    overall = {r["hero_id"]: r for r in groups.get("all", (None, []))[1]}
    out = []
    for map_id, (at, rows) in groups.items():
        if map_id == "all":
            continue
        specialists = []
        for r in rows:
            base = overall.get(r["hero_id"])
            if not base or not base["pick_rate"] or r["pick_rate"] is None or base["pick_rate"] < MIN_PICK_FOR_MAP:
                continue
            specialists.append(
                {
                    "hero_id": r["hero_id"],
                    "role": r["role"],
                    "pick_rate": r["pick_rate"],
                    "win_rate": r["win_rate"],
                    "pick_ratio": round(r["pick_rate"] / base["pick_rate"], 2),
                    "win_diff": round((r["win_rate"] or 0) - (base["win_rate"] or 0), 2),
                }
            )
        specialists.sort(key=lambda s: -s["pick_ratio"])
        out.append({"map_id": map_id, "fetched_at": at, "specialists": specialists[:top]})
    out.sort(key=lambda m: -(m["specialists"][0]["pick_ratio"] if m["specialists"] else 0))
    return {"maps": out}
