"""상황(큐, 맵, 역할, 아군, 적, 선호 영웅)에 맞는 영웅 추천.

이유(reasons)는 문장이 아니라 코드와 값으로 돌려준다. 문장은 프론트엔드가 언어별로 만든다.
"""

import json
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from app.analysis.meta import score_heroes

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"
ROLES = ("tank", "damage", "support")


# 상성 평점 10 ≈ 크게 유리 = 1.0. 극단적인 평점이 점수를 독차지하지 않도록 상한을 둔다
RATING_SCALE = 10.0
MATCHUP_CAP = 1.5
# 이 이상(|값|)이어야 '유리/불리' 이유로 보여준다 (평점 약 3)
MATCHUP_SHOWN = 0.3
# 손으로 정리한 상성은 평점이 있는 짝에도 이만큼 더한다. 평점이 중립(0)이어도 '유리' 이유로 보일 만큼이다.
# 평점은 1:1 대결 결과라 디바가 파라 미사일을 지우는 것처럼 대결 수치에 덜 잡히는 상성이 약하게 나온다
# (디바 > 파라 평점 0.42, 파라 상대 유리한 영웅 중 17번째)
HAND_BONUS = MATCHUP_SHOWN


@dataclass
class Matchups:
    """상성과 시너지.

    - ratings: 데이터 기반 상성 평점 (data/matchups.json, counterwatch 5v5). ratings[target][counter]
    - counters: 손으로 정리한 상성 (data/counters.yaml). 평점이 없는 짝은 이것만, 있으면 평점에 HAND_BONUS를 더한다
    - synergy: 손으로 정리한 시너지 쌍
    """

    counters: dict[str, set[str]] = field(default_factory=dict)
    synergy: set[frozenset[str]] = field(default_factory=set)
    ratings: dict[str, dict[str, float]] = field(default_factory=dict)

    @classmethod
    def load(
        cls, path: Path = DATA_DIR / "counters.yaml", ratings_path: Path | None = DATA_DIR / "matchups.json"
    ) -> Matchups:
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        ratings = {}
        if ratings_path and ratings_path.exists():
            ratings = json.loads(ratings_path.read_text(encoding="utf-8")).get("ratings", {})
        return cls(
            counters={k: set(v or []) for k, v in (raw.get("counters") or {}).items()},
            synergy={frozenset(p) for p in (raw.get("synergy") or []) if len(p) == 2},
            ratings=ratings,
        )

    def matchup(self, hero: str, enemy: str) -> float:
        """hero가 enemy 상대로 얼마나 유리한지. +면 유리, -면 불리 (대략 -1.5 ~ +1.5).

        평점 데이터가 있으면 양쪽 방향 평점의 평균에 손으로 정리한 상성을 HAND_BONUS만큼 더하고,
        없으면 손으로 정리한 상성(±1)만 쓴다. 서로 상대를 적어 둔 짝은 상쇄돼 평점만 남는다.
        """
        hand = (enemy in self.counters.get(hero, ())) - (hero in self.counters.get(enemy, ()))
        a = self.ratings.get(enemy, {}).get(hero)  # hero가 enemy의 카운터로서 받은 평점
        b = self.ratings.get(hero, {}).get(enemy)  # enemy가 hero의 카운터로서 받은 평점
        if a is not None or b is not None:
            vals = [v for v in (a, -b if b is not None else None) if v is not None]
            v = sum(vals) / len(vals) / RATING_SCALE + hand * HAND_BONUS
            return max(-MATCHUP_CAP, min(MATCHUP_CAP, round(v, 3)))
        return float(hand)

    def synergizes(self, a: str, b: str) -> bool:
        return frozenset((a, b)) in self.synergy


@dataclass(frozen=True)
class Queue:
    id: str
    team_size: int
    slots: dict[str, int] | None = None
    stats_fallback: bool = False
    default: bool = False


@dataclass
class Comps:
    """팀 조합 유형(다이브·포킹·러쉬·앵커)과 영웅별 적합도 (data/comps.yaml)."""

    archetypes: tuple[str, ...] = ()
    heroes: dict[str, dict[str, float]] = field(default_factory=dict)
    min_strength: float = 1.0
    min_share: float = 0.4
    # 역할 안의 균형 (docs/team-building.md): 메인·서브 짝, 서포터 힐량
    heal: dict[str, float] = field(default_factory=dict)
    heal_by_subrole: dict[str, float] = field(default_factory=dict)
    min_pair_heal: float = 1.1
    main_dps: frozenset[str] = frozenset()
    main_heal: frozenset[str] = frozenset()
    pair_penalty: dict[str, float] = field(default_factory=dict)
    # 메인딜 둘이 정석인 맵 (메인딜 둘 감점 없음)
    main_dps_maps: frozenset[str] = frozenset()
    # 단점이 겹치는 딜러 짝 (한 가지 대처에 둘 다 무력해짐)
    weak_pairs: frozenset[frozenset[str]] = frozenset()
    # 조합 유형 상성: beats[a] = a가 강한 유형들
    beats: dict[str, tuple[str, ...]] = field(default_factory=dict)

    @classmethod
    def load(cls, path: Path = DATA_DIR / "comps.yaml") -> Comps:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        bal = raw.get("balance") or {}
        return cls(
            tuple(raw["archetypes"]),
            {h: {k: float(v) for k, v in w.items()} for h, w in (raw.get("heroes") or {}).items()},
            float(raw.get("min_strength", 1.0)),
            float(raw.get("min_share", 0.4)),
            {h: float(v) for h, v in (bal.get("heal") or {}).items()},
            {k: float(v) for k, v in (bal.get("heal_by_subrole") or {}).items()},
            float(bal.get("min_pair_heal", 1.1)),
            frozenset(bal.get("main_dps") or ()),
            frozenset(bal.get("main_heal") or ()),
            {k: float(v) for k, v in (bal.get("pair_penalty") or {}).items()},
            frozenset(bal.get("main_dps_maps") or ()),
            frozenset(frozenset(p) for p in bal.get("weak_pairs") or ()),
            {k: tuple(v or ()) for k, v in (raw.get("beats") or {}).items()},
        )

    def heal_of(self, hero: str, subrole: str | None) -> float:
        return self.heal.get(hero, self.heal_by_subrole.get(subrole or "", 0.6))

    def balance_issues(self, team: list[str], role_of, subrole_of, map_id: str | None = None) -> list[dict]:
        """팀 안의 역할 균형 문제 (docs/team-building.md).
        - low_heal: 서포터 두 명의 힐량 합이 모자람 (혼자 본대를 받칠 힐러가 최소 한 명 필요)
        - double_main_dps / double_sub_dps: 딜러가 메인끼리(메인딜 맵 제외), 서브끼리
        - double_main_heal: 메인 힐러끼리 (유틸 부족)
        - weak_pair: 단점이 겹치는 딜러 짝
        """
        issues = []
        supports = [h for h in team if role_of(h) == "support"][:2]
        damage = [h for h in team if role_of(h) == "damage"][:2]
        if len(supports) == 2:
            total = sum(self.heal_of(h, subrole_of(h)) for h in supports)
            if total < self.min_pair_heal:
                issues.append({"kind": "low_heal", "deficit": round(self.min_pair_heal - total, 2)})
            if all(h in self.main_heal for h in supports):
                issues.append({"kind": "double_main_heal", "deficit": self.pair_penalty.get("double_main_heal", 0.15)})
        if len(damage) == 2:
            mains = sum(h in self.main_dps for h in damage)
            if mains == 2 and map_id not in self.main_dps_maps:
                issues.append({"kind": "double_main_dps", "deficit": self.pair_penalty.get("double_main_dps", 0.25)})
            elif mains == 0:
                issues.append({"kind": "double_sub_dps", "deficit": self.pair_penalty.get("double_sub_dps", 0.15)})
            if frozenset(damage) in self.weak_pairs:
                issues.append({"kind": "weak_pair", "deficit": self.pair_penalty.get("weak_pair", 0.15)})
        return issues

    def fit(self, hero: str, archetype: str) -> float:
        return self.heroes.get(hero, {}).get(archetype, 0.0)

    def dominant(self, team: list[str]) -> str | None:
        """팀이 뚜렷하게 한 유형이면 그 유형, 섞였거나 정보가 적으면 None"""
        totals = {a: sum(self.fit(h, a) for h in team) for a in self.archetypes}
        overall = sum(totals.values())
        if not overall:
            return None
        best = max(totals, key=totals.get)
        if totals[best] >= self.min_strength and totals[best] / overall >= self.min_share:
            return best
        return None


@dataclass(frozen=True)
class BanRules:
    per_team: int
    lobby: int
    max_per_role: int
    votes: tuple[int, ...]
    high_ban_rate: float
    # 파티 비율 0(혼자)~1(풀 파티)에 따른 가중치 (solo, full)
    popularity: tuple[float, float] = (3.0, 0.5)
    threat: tuple[float, float] = (0.35, 1.5)

    def weights_for(self, party_share: float) -> tuple[float, float]:
        """파티 비율에 따른 (밴률 가중치, 카운터 배수). 비율 0 = 혼자, 1 = 팀 전원이 파티."""
        s = min(max(party_share, 0.0), 1.0)
        lerp = lambda pair: pair[0] + (pair[1] - pair[0]) * s  # noqa: E731
        return round(lerp(self.popularity), 3), round(lerp(self.threat), 3)

    @property
    def total(self) -> int:
        """로비 밴을 뺀 기본 금지 칸 수"""
        return self.per_team * 2

    def total_with(self, lobby_ban: bool) -> int:
        return self.total + (self.lobby if lobby_ban else 0)


def load_bans(path: Path = DATA_DIR / "bans.yaml") -> BanRules:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    c = raw["competitive"]
    w = raw.get("weights", {})
    pop = w.get("popularity", {"solo": 3.0, "full": 0.5})
    thr = w.get("threat", {"solo": 0.35, "full": 1.5})
    return BanRules(
        c["per_team"],
        c.get("lobby", 0),
        c["max_per_role"],
        tuple(c["votes"]),
        raw["high_ban_rate"],
        (pop["solo"], pop["full"]),
        (thr["solo"], thr["full"]),
    )


def load_weights(path: Path = DATA_DIR / "weights.yaml") -> dict[str, float]:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def load_queues(path: Path = DATA_DIR / "queues.yaml") -> dict[str, Queue]:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    return {k: Queue(id=k, **v) for k, v in raw.items()}


class InvalidSituation(ValueError):
    """프론트엔드가 번역할 수 있게 code와 params를 담는다."""

    def __init__(self, code: str, **params):
        super().__init__(code)
        self.code = code
        self.params = params


@dataclass
class Context:
    """요청 하나에서 여러 번 쓰는 점수표."""

    overall: dict[str, dict]
    on_map: dict[str, dict]
    matchups: Matchups
    weights: dict[str, float]
    banned: frozenset[str] = frozenset()
    # 밴이 아직 끝나지 않았을 때, 이 밴률(%) 이상인 추천에 "밴될 수 있음" 경고를 붙인다. None이면 경고 안 함
    ban_warn: float | None = None
    # 위험 플레이어(유난히 잘하는 상대)로 표시한 적 영웅: 카운터를 더 크게 보고, 그에게 약한 픽은 피한다
    threats: frozenset[str] = frozenset()
    comps: Comps | None = None
    # 고른 전장 (메인딜 맵 등 전장에 따라 달라지는 균형 판단용). 전장을 안 골랐으면 "all"
    map: str = "all"

    @classmethod
    def build(
        cls,
        overall_stats,
        map_stats,
        matchups,
        weights,
        *,
        banned=(),
        ban_warn=None,
        threats=(),
        comps=None,
        map="all",
    ) -> Context:
        return cls(
            overall={h["hero_id"]: h for h in score_heroes(overall_stats)},
            on_map={h["hero_id"]: h for h in score_heroes(map_stats)} if map_stats else {},
            matchups=matchups,
            weights=weights,
            banned=frozenset(banned),
            ban_warn=ban_warn,
            threats=frozenset(threats),
            comps=comps,
            map=map,
        )

    def role_of(self, hero_id: str) -> str | None:
        h = self.overall.get(hero_id)
        return h["role"] if h else None

    def subrole_of(self, hero_id: str) -> str | None:
        h = self.overall.get(hero_id)
        return h.get("subrole") if h else None

    def balance_issues(self, team: list[str]) -> list[dict]:
        return self.comps.balance_issues(team, self.role_of, self.subrole_of, self.map) if self.comps else []

    def balance_penalty(self, team: list[str]) -> float:
        return sum(i["deficit"] for i in self.balance_issues(team))


def validate_team(ctx: Context, queue: Queue, heroes: list[str], team: str, max_size: int) -> None:
    if len(heroes) > max_size:
        raise InvalidSituation("team_too_large", team=team, limit=max_size)
    dup = [h for h, n in Counter(heroes).items() if n > 1]
    if dup:
        raise InvalidSituation("duplicate_hero", team=team, hero=dup[0])
    unknown = [h for h in heroes if h not in ctx.overall]
    if unknown:
        raise InvalidSituation("unknown_hero", team=team, hero=unknown[0])
    if queue.slots:
        counts = Counter(ctx.role_of(h) for h in heroes)
        for role, n in counts.items():
            if n > queue.slots.get(role, 0):
                raise InvalidSituation("too_many_role", team=team, role=role, limit=queue.slots.get(role, 0))


def validate_bans(
    ctx: Context, rules: BanRules | None, bans: list[str], picked: list[str], lobby_ban: bool = False
) -> None:
    """금지 규칙 확인. 로비 밴이 있으면 칸이 하나 늘고, 그 한 명은 같은 역할 한도를 넘어도 된다"""
    if not bans:
        return
    if rules is None:
        raise InvalidSituation("bans_not_allowed")
    total = rules.total_with(lobby_ban)
    if len(bans) > total:
        raise InvalidSituation("too_many_bans", limit=total)
    validate_team(ctx, Queue("bans", team_size=total), bans, "bans", total)
    over = {
        r: n - rules.max_per_role for r, n in Counter(ctx.role_of(h) for h in bans).items() if n > rules.max_per_role
    }
    allowed = rules.lobby if lobby_ban else 0
    if sum(over.values()) > allowed:
        role = max(over, key=over.get)
        raise InvalidSituation("too_many_role_bans", role=role, limit=rules.max_per_role)
    clash = [h for h in picked if h in set(bans)]
    if clash:
        raise InvalidSituation("banned_hero_picked", hero=clash[0])


def free_slots(ctx: Context, queue: Queue, allies: list[str]) -> dict[str, int] | None:
    """역할 고정 큐에서 아군이 차지하고 남은 역할별 자리. 역할 제한이 없는 큐는 None."""
    if not queue.slots:
        return None
    counts = Counter(ctx.role_of(h) for h in allies)
    return {r: queue.slots.get(r, 0) - counts.get(r, 0) for r in ROLES}


def score_hero(ctx: Context, hero_id: str, *, allies: list[str], enemies: list[str], preferred: set[str]) -> dict:
    w = ctx.weights
    h = ctx.overall[hero_id]
    parts: dict[str, float] = {"overall_meta": w["overall_meta"] * h["meta_score"]}
    reasons: list[dict] = []

    m = ctx.on_map.get(hero_id)
    if m:
        parts["map_meta"] = w["map_meta"] * m["meta_score"]
        reasons.append(
            {
                "kind": "map",
                "win_rate": m["win_rate"],
                "pick_rate": m["pick_rate"],
                "win_diff": round(m["win_rate"] - h["win_rate"], 1),
                "tier": m["tier"],
            }
        )
    reasons.append({"kind": "meta", "tier": h["tier"], "win_rate": h["win_rate"], "pick_rate": h["pick_rate"]})

    counter_sum = 0.0
    threat = 0.0
    for e in enemies:
        v = ctx.matchups.matchup(hero_id, e)
        counter_sum += v
        if e in ctx.threats:
            # 위험 플레이어: 상성을 배수만큼 더 크게 보고, 크게 불리하면 추가로 깎는다
            threat += v * (w.get("threat_counter", 2.0) - 1)
            if v <= -0.5:
                threat += v * w.get("threat_avoid", 1.5)
            if v >= MATCHUP_SHOWN:
                reasons.append({"kind": "threat_counter", "enemy": e})
            elif v <= -0.5:
                reasons.append({"kind": "threat_weak", "enemy": e})
        if abs(v) >= MATCHUP_SHOWN and e not in ctx.threats:
            reasons.append({"kind": "counter" if v > 0 else "countered", "enemy": e, "strength": round(abs(v), 2)})
    parts["counter"] = w["counter"] * counter_sum
    if threat:
        parts["threat"] = w["counter"] * threat

    # 역할 안의 균형: 이 영웅이 들어가서 새로 생기는 문제만 (힐량 부족, 메인딜 둘)
    if ctx.comps:
        before = ctx.balance_issues(allies)
        after_issues = ctx.balance_issues([*allies, hero_id])
        added = sum(i["deficit"] for i in after_issues) - sum(i["deficit"] for i in before)
        if added > 0:
            parts["balance"] = -w.get("balance", 2.0) * added
            known = {i["kind"] for i in before}
            reasons.extend({"kind": i["kind"]} for i in after_issues if i["kind"] not in known)

    # 상대 조합 유형에 강한 유형의 영웅 (상대 2명 이상이 한 유형으로 뚜렷할 때)
    if ctx.comps and len(enemies) >= 2:
        enemy_arch = ctx.comps.dominant(enemies)
        if enemy_arch:
            good = [a for a, beaten in ctx.comps.beats.items() if enemy_arch in beaten]
            fit = max((ctx.comps.fit(hero_id, a) for a in good), default=0.0)
            if fit > 0:
                parts["comp_counter"] = w.get("comp_counter", 0.2) * fit
                if fit >= 0.5:
                    reasons.append({"kind": "comp_counter", "comp": enemy_arch})

    # 우리 팀 조합 유형에 맞는 영웅 (아군 2명 이상일 때만, 아니면 유형을 판단하기 이르다)
    if ctx.comps and len(allies) >= 2:
        arch = ctx.comps.dominant(allies)
        fit = ctx.comps.fit(hero_id, arch) if arch else 0.0
        if fit > 0:
            parts["comp"] = w.get("comp", 0.3) * fit
            if fit >= 0.5:
                reasons.append({"kind": "comp_fit", "comp": arch})

    syn = [a for a in allies if ctx.matchups.synergizes(hero_id, a)]
    parts["synergy"] = w["synergy"] * len(syn)
    reasons.extend({"kind": "synergy", "ally": a} for a in syn)

    if hero_id in preferred:
        parts["preferred"] = w["preferred"]
        reasons.append({"kind": "preferred"})

    ban_rate = h.get("ban_rate") or 0
    if ctx.ban_warn is not None and ban_rate >= ctx.ban_warn:
        reasons.append({"kind": "ban_risk", "ban_rate": ban_rate})

    return {
        "hero_id": hero_id,
        "role": h["role"],
        "tier": h["tier"],
        "score": round(sum(parts.values()), 3),
        "parts": {k: round(v, 3) for k, v in parts.items()},
        "reasons": reasons,
    }


def candidates(
    ctx: Context,
    *,
    roles: set[str],
    allies: list[str],
    enemies: list[str],
    preferred: set[str],
    preferred_only: bool = False,
) -> list[dict]:
    """주어진 역할 안에서 점수순 후보 전체."""
    taken = set(allies) | ctx.banned  # 같은 팀은 영웅 중복 불가 (상대 팀과는 겹쳐도 된다), 금지 영웅 제외
    out = []
    for hid, h in ctx.overall.items():
        if h["role"] not in roles or hid in taken:
            continue
        if preferred_only and preferred and hid not in preferred:
            continue
        out.append(score_hero(ctx, hid, allies=allies, enemies=enemies, preferred=preferred))
    out.sort(key=lambda r: -r["score"])
    return out


def recommend(
    ctx: Context,
    *,
    queue: Queue,
    role: str | None,
    allies: list[str],
    enemies: list[str],
    preferred: set[str] = frozenset(),
    preferred_only: bool = False,
    top: int = 5,
) -> list[dict]:
    validate_team(ctx, queue, enemies, "enemies", queue.team_size)
    validate_team(ctx, queue, allies, "allies", queue.team_size - 1)

    free = free_slots(ctx, queue, allies)
    if free is None:
        roles = {role} if role else set(ROLES)
    elif role:
        if free[role] <= 0:
            raise InvalidSituation("role_full", role=role)
        roles = {role}
    else:
        roles = {r for r, n in free.items() if n > 0}

    return candidates(
        ctx, roles=roles, allies=allies, enemies=enemies, preferred=preferred, preferred_only=preferred_only
    )[:top]
