"""밴(영웅 금지) 투표 추천.

경쟁전에서는 각자 3명에게 투표(가중치 7/5/3)하고 팀마다 많이 받은 영웅이 금지된다.
"우리에게 가장 위협적인" 영웅을 1~3순위로 추천한다.

점수 = 그 영웅의 메타 점수(전장 포함)
     + 카운터 배수 × 우리 쪽 영웅(선호 영웅·이미 고른 아군)을 카운터하는 정도
     + 밴률 가중치 × 밴률 (다른 팀원도 표를 줄 만한 영웅인지)
카운터 배수와 밴률 가중치는 파티 인원에 따라 바뀐다(bans.yaml weights):
혼자·듀오는 표가 모일 영웅(밴률)을, 풀 파티는 우리 영웅의 카운터를 크게 본다.
우리 선호 영웅과 이미 금지된 영웅, 이미 고른 영웅, 역할당 금지 한도가 찬 역할은 제외한다.
"""

from collections import Counter

from app.recommend.engine import MATCHUP_SHOWN, BanRules, Context


def recommend_bans(
    ctx: Context,
    rules: BanRules,
    *,
    protect: set[str],
    allies: list[str],
    banned: list[str],
    enemies: list[str] = (),
    party_size: int = 1,
    team_size: int = 5,
    top: int = 3,
) -> list[dict]:
    w = ctx.weights
    pop_w, threat_x = rules.weights_for((party_size - 1) / max(team_size - 1, 1))
    ours = set(protect) | set(allies)
    picked = set(allies) | set(enemies)  # 이미 고른 영웅은 금지할 수 없다
    role_full = {r for r, n in Counter(ctx.role_of(h) for h in banned).items() if n >= rules.max_per_role}

    out = []
    for hid, h in ctx.overall.items():
        if hid in ours or hid in picked or hid in banned or h["role"] in role_full:
            continue
        m = ctx.on_map.get(hid)
        parts = {"overall_meta": w["overall_meta"] * h["meta_score"]}
        if m:
            parts["map_meta"] = w["map_meta"] * m["meta_score"]
        edges = {x: ctx.matchups.matchup(hid, x) for x in ours}
        threatened = sorted((x for x, v in edges.items() if v >= MATCHUP_SHOWN), key=lambda x: -edges[x])
        parts["threat"] = threat_x * w["counter"] * sum(v for v in edges.values() if v > 0)
        ban_rate = h.get("ban_rate") or 0
        parts["popularity"] = pop_w * ban_rate / 100

        reasons = [{"kind": "meta", "tier": h["tier"], "win_rate": h["win_rate"], "pick_rate": h["pick_rate"]}]
        reasons += [{"kind": "threatens", "hero": x} for x in threatened]
        if ban_rate:
            reasons.append({"kind": "ban_rate", "ban_rate": ban_rate})
        out.append(
            {
                "hero_id": hid,
                "role": h["role"],
                "tier": h["tier"],
                "ban_rate": ban_rate,
                "score": round(sum(parts.values()), 3),
                "parts": {k: round(v, 3) for k, v in parts.items()},
                "reasons": reasons,
            }
        )
    out.sort(key=lambda r: -r["score"])

    # 투표 순위별 표 수를 붙인다 (1순위 7표, 2순위 5표, 3순위 3표 …)
    for i, r in enumerate(out[:top]):
        r["votes"] = rules.votes[i] if i < len(rules.votes) else 0
    return out[:top]
