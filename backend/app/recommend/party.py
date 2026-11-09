"""파티(듀오·트리오 등) 공동 추천.

파티원마다 개인 추천 점수 상위 K명을 후보로 두고, 조합 전체(개인 점수 합 + 파티원끼리 시너지
+ 선호 역할 보너스)가 가장 높은 픽 세트를 완전 탐색으로 찾는다.
"""

import heapq
import itertools
from dataclasses import dataclass, field

from app.recommend.engine import (
    ROLES,
    Context,
    InvalidSituation,
    Queue,
    candidates,
    free_slots,
    validate_team,
)


@dataclass
class Member:
    key: str  # 프론트엔드가 쓰는 식별자 (플레이어 id나 슬롯 번호)
    role: str | None = None  # 역할 고정 큐에서 슬롯이 정해졌으면 그 역할
    preferred: set[str] = field(default_factory=set)
    preferred_roles: list[str] = field(default_factory=list)
    # 이 사람에게는 선호 영웅만 (선호 영웅이 없으면 무시)
    preferred_only: bool = False


def _assignments(options: list[list[str | None]], free: dict[str, int]) -> list[tuple[str | None, ...]]:
    out = []
    for combo in itertools.product(*options):
        need = {r: combo.count(r) for r in ROLES}
        if all(need[r] <= free[r] for r in ROLES):
            out.append(combo)
    return out


def role_assignments(members: list[Member], free: dict[str, int] | None) -> list[tuple[str | None, ...]]:
    """역할 고정 큐면 남은 슬롯 안에서 가능한 역할 배정을 모두 만든다. 자유 큐는 정해진 역할 그대로.

    역할이 안 정해진 파티원은 선호 역할 안에서만 배정한다. 그렇게는 슬롯이 안 맞으면 모든 역할로 넓힌다.
    """
    if free is None:
        return [tuple(m.role for m in members)]
    preferred = [[m.role] if m.role else (list(m.preferred_roles) or list(ROLES)) for m in members]
    out = _assignments(preferred, free) or _assignments([[m.role] if m.role else list(ROLES) for m in members], free)
    if not out:
        raise InvalidSituation("no_role_assignment")
    return out


def recommend_party(
    ctx: Context,
    *,
    queue: Queue,
    members: list[Member],
    allies: list[str],
    enemies: list[str],
    k: int = 8,
    top: int = 3,
) -> dict:
    if not members:
        raise InvalidSituation("no_members")
    validate_team(ctx, queue, enemies, "enemies", queue.team_size)
    validate_team(ctx, queue, allies, "allies", queue.team_size - len(members))

    w = ctx.weights
    free = free_slots(ctx, queue, allies)
    cache: dict[tuple[str, str | None], list[dict]] = {}

    def pool(i: int, role: str | None) -> list[dict]:
        key = (members[i].key, role)
        if key not in cache:
            m = members[i]
            cache[key] = candidates(
                ctx,
                roles={role} if role else set(ROLES),
                allies=allies,
                enemies=enemies,
                preferred=m.preferred,
                preferred_only=m.preferred_only,
            )
        return cache[key]

    def top_k(i: int, role: str | None) -> list[dict]:
        if role:
            return pool(i, role)[:k]
        # 역할 제한이 없는 큐: 선호 역할이 있으면 그 안에서만, 없으면 역할마다 상위 몇 명씩 섞는다
        roles = members[i].preferred_roles or list(ROLES)
        per_role = max(1, k // len(roles))
        mixed = [c for r in roles for c in [x for x in pool(i, None) if x["role"] == r][:per_role]]
        return sorted(mixed, key=lambda c: -c["score"])

    best: list[tuple[float, int, dict]] = []  # 최소 힙: (점수, 순번, 조합)
    seq = itertools.count()
    for assignment in role_assignments(members, free):
        pools = [top_k(i, r) for i, r in enumerate(assignment)]
        if any(not p for p in pools):
            continue
        for picks in itertools.product(*pools):
            ids = [p["hero_id"] for p in picks]
            if len(set(ids)) < len(ids):
                continue
            pairs = [(a, b) for a, b in itertools.combinations(ids, 2) if ctx.matchups.synergizes(a, b)]
            score = sum(p["score"] for p in picks) + w["synergy"] * len(pairs)
            # 파티원끼리의 역할 균형 (개인 점수는 고정 아군과의 균형만 봤다): 남은 부분만 더 뺀다
            if ctx.comps:
                team = [*allies, *ids]
                total = ctx.balance_penalty(team)
                base = ctx.balance_penalty(list(allies))
                counted = sum(ctx.balance_penalty([*allies, i]) - base for i in ids)
                extra = total - base - counted
                if extra > 0:
                    score -= w.get("balance", 2.0) * extra
            # 파티원 픽까지 합친 우리 팀이 한 조합 유형으로 맞춰지면 가산 (개인 점수는 고정 아군만 봤다)
            comp = ctx.comps.dominant([*allies, *ids]) if ctx.comps and len(allies) + len(ids) >= 3 else None
            if comp:
                score += w.get("comp", 0.3) * sum(ctx.comps.fit(i, comp) for i in ids) * 0.5
            combo = {
                "score": round(score, 3),
                "comp": comp,
                "picks": [
                    {"member": m.key, "role": r or p["role"], **p}
                    for m, r, p in zip(members, assignment, picks, strict=True)
                ],
                "synergies": [list(p) for p in pairs],
            }
            item = (combo["score"], next(seq), combo)
            if len(best) < top:
                heapq.heappush(best, item)
            elif item[0] > best[0][0]:
                heapq.heapreplace(best, item)

    combos = [c for _, _, c in sorted(best, key=lambda t: -t[0])]
    if not combos:
        return {"combos": [], "alternatives": {}}

    # 최선 조합의 역할 배정 기준으로, 파티원별 대안(다른 파티원 픽과 겹치지 않는 것)
    alternatives = {}
    for i, pick in enumerate(combos[0]["picks"]):
        others = {p["hero_id"] for j, p in enumerate(combos[0]["picks"]) if j != i}
        alts = [c for c in pool(i, pick["role"] if free is not None else members[i].role) if c["hero_id"] not in others]
        alternatives[members[i].key] = alts[:5]
    return {"combos": combos, "alternatives": alternatives}
