"""픽률·승률로 메타 점수와 티어를 계산한다."""

from statistics import mean, pstdev

# 픽률(%)이 낮을수록 승률을 50%쪽으로 당긴다. 픽률 PRIOR_PICK%일 때 원래 승률과 50%를 반반 섞는 셈.
PRIOR_PICK = 2.0
WIN_WEIGHT = 0.7
PICK_WEIGHT = 0.3
TIERS = [("S", 0.90), ("A", 0.70), ("B", 0.40), ("C", 0.15), ("D", 0.0)]


def adjusted_win_rate(win: float, pick: float, prior: float = PRIOR_PICK) -> float:
    return (win * pick + 50.0 * prior) / (pick + prior)


def adjusted_pick_rate(pick: float, ban: float | None) -> float:
    """밴 때문에 못 고른 판을 빼고 본 픽률: 픽률 ÷ (1 − 밴률). 밴이 많은 강한 영웅이 픽률만 보고 저평가되지 않게."""
    ban = min(max(ban or 0.0, 0.0), 95.0)  # 밴률이 100%에 가까우면 값이 폭주하므로 상한
    return pick / (1 - ban / 100)


def zscores(values: list[float]) -> list[float]:
    if len(values) < 2:
        return [0.0] * len(values)
    mu, sd = mean(values), pstdev(values)
    return [0.0 if sd == 0 else (v - mu) / sd for v in values]


def score_heroes(stats: list[dict]) -> list[dict]:
    """역할별로 z-점수를 내서(역할마다 픽률 분포가 다르므로) 메타 점수와 티어를 붙인다."""
    valid = [dict(h) for h in stats if h["win_rate"] is not None and h["pick_rate"] is not None]
    for h in valid:
        h["adj_win_rate"] = round(adjusted_win_rate(h["win_rate"], h["pick_rate"]), 2)
        h["adj_pick_rate"] = round(adjusted_pick_rate(h["pick_rate"], h.get("ban_rate")), 2)

    out = []
    for role in sorted({h["role"] for h in valid}):
        group = [h for h in valid if h["role"] == role]
        zw = zscores([h["adj_win_rate"] for h in group])
        zp = zscores([h["adj_pick_rate"] for h in group])
        for h, w, p in zip(group, zw, zp, strict=True):
            h["win_z"], h["pick_z"] = round(w, 3), round(p, 3)
            h["meta_score"] = round(WIN_WEIGHT * w + PICK_WEIGHT * p, 3)
        ranked = sorted(group, key=lambda h: h["meta_score"])
        n = len(ranked)
        for i, h in enumerate(ranked):
            pct = i / (n - 1) if n > 1 else 0.5
            h["tier"] = next(t for t, cut in TIERS if pct >= cut)
        out.extend(group)
    return sorted(out, key=lambda h: -h["meta_score"])


def compare(current: list[dict], previous: list[dict]) -> list[dict]:
    """두 스냅샷 사이 승률·픽률 변화."""
    prev = {h["hero_id"]: h for h in previous}
    rows = []
    for h in current:
        p = prev.get(h["hero_id"])
        if not p or None in (h["win_rate"], h["pick_rate"], p["win_rate"], p["pick_rate"]):
            continue
        rows.append(
            {
                "hero_id": h["hero_id"],
                "name": h["name"],
                "role": h["role"],
                "win_rate": h["win_rate"],
                "pick_rate": h["pick_rate"],
                "win_delta": round(h["win_rate"] - p["win_rate"], 2),
                "pick_delta": round(h["pick_rate"] - p["pick_rate"], 2),
            }
        )
    return sorted(rows, key=lambda r: -abs(r["win_delta"]))
