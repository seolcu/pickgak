import pytest

from app.analysis.meta import adjusted_pick_rate, score_heroes
from app.recommend.bans import recommend_bans
from app.recommend.engine import (
    Context,
    InvalidSituation,
    Matchups,
    load_bans,
    load_queues,
    load_weights,
    recommend,
    validate_bans,
)
from tests.conftest import hero
from tests.test_engine import STATS

RULES = load_bans()
RQ = load_queues()["role_queue"]


def ctx_with(**kw):
    return Context.build(STATS, [], Matchups.load(ratings_path=None), load_weights(), **kw)


def test_rules_config():
    assert (RULES.per_team, RULES.total, RULES.max_per_role, RULES.votes) == (2, 4, 2, (7, 5, 3))


def test_adjusted_pick_rate():
    assert adjusted_pick_rate(10, 0) == 10
    assert adjusted_pick_rate(10, 50) == 20
    assert adjusted_pick_rate(10, 100) == pytest.approx(200)  # 상한 95%


def test_ban_suppressed_pick_rate_not_underrated():
    # 픽률이 같아도 밴률이 높은 영웅(밴 때문에 덜 골라진 영웅)이 메타 점수에서 앞선다
    stats = [hero("a", "tank", 52, 5), hero("b", "tank", 52, 5), hero("c", "tank", 48, 5)]
    stats[0]["ban_rate"] = 50
    scored = {h["hero_id"]: h for h in score_heroes(stats)}
    assert scored["a"]["meta_score"] > scored["b"]["meta_score"]


def test_banned_heroes_excluded():
    ctx = ctx_with(banned={"cassidy"})
    recs = recommend(ctx, queue=RQ, role="damage", allies=[], enemies=[], top=10)
    assert "cassidy" not in {r["hero_id"] for r in recs}


def test_validate_bans():
    ctx = ctx_with()
    validate_bans(ctx, RULES, ["ana", "kiriko", "genji", "winston"], [])
    with pytest.raises(InvalidSituation) as e:
        validate_bans(ctx, RULES, ["ana", "kiriko", "mercy"], [])  # 지원 3명
    assert e.value.code == "too_many_role_bans"
    with pytest.raises(InvalidSituation) as e:
        validate_bans(ctx, RULES, ["ana", "genji", "winston", "dva", "cassidy"], [])
    assert e.value.code == "too_many_bans"
    with pytest.raises(InvalidSituation) as e:
        validate_bans(ctx, RULES, ["ana"], ["ana"])
    assert e.value.code == "banned_hero_picked"
    with pytest.raises(InvalidSituation) as e:
        validate_bans(ctx, None, ["ana"], [])
    assert e.value.code == "bans_not_allowed"


def test_ban_suggestions_target_threats_to_our_heroes():
    ctx = ctx_with()
    # 우리가 파라를 하고 싶으면, 파라를 카운터하는 히트스캔(캐서디·솔저)을 밴하라고 해야 한다
    recs = recommend_bans(ctx, RULES, protect={"pharah"}, allies=[], banned=[])
    top2 = {r["hero_id"] for r in recs[:2]}
    assert top2 <= {"cassidy", "soldier-76", "widowmaker", "ashe", "dva"}
    assert all(r["hero_id"] != "pharah" for r in recs)  # 우리 영웅은 추천하지 않음
    assert [r["votes"] for r in recs] == [7, 5, 3]
    assert any(x == {"kind": "threatens", "hero": "pharah"} for x in recs[0]["reasons"])


def test_ban_suggestions_skip_full_roles():
    ctx = ctx_with()
    recs = recommend_bans(ctx, RULES, protect=set(), allies=[], banned=["ana", "kiriko"], top=10)
    assert "support" not in {r["role"] for r in recs}  # 지원은 이미 2명 금지


def test_ban_risk_warning():
    stats = [dict(h) for h in STATS]
    next(h for h in stats if h["hero_id"] == "ana")["ban_rate"] = 40
    ctx = Context.build(stats, [], Matchups.load(ratings_path=None), load_weights(), ban_warn=RULES.high_ban_rate)
    recs = recommend(ctx, queue=RQ, role="support", allies=[], enemies=[], top=10)
    ana = next(r for r in recs if r["hero_id"] == "ana")
    assert {"kind": "ban_risk", "ban_rate": 40} in ana["reasons"]


def test_ban_suggestions_skip_picked_heroes():
    ctx = ctx_with()
    recs = recommend_bans(ctx, RULES, protect={"pharah"}, allies=[], enemies=["cassidy"], banned=[], top=10)
    assert "cassidy" not in {r["hero_id"] for r in recs}


def test_party_size_shifts_ban_priorities():
    # 파라를 지키고 싶다. 캐서디는 파라 카운터지만 밴률 0%, 겐지는 카운터가 아니지만 밴률 60%
    stats = [dict(h) for h in STATS]
    for h in stats:
        h["ban_rate"] = 60 if h["hero_id"] == "genji" else 0
    ctx = Context.build(stats, [], Matchups(counters={"cassidy": {"pharah"}}), load_weights())
    solo = recommend_bans(ctx, RULES, protect={"pharah"}, allies=[], banned=[], party_size=1, top=10)
    full = recommend_bans(ctx, RULES, protect={"pharah"}, allies=[], banned=[], party_size=5, top=10)
    ids = lambda recs: [r["hero_id"] for r in recs]  # noqa: E731
    # 혼자: 다른 팀원도 표를 줄 겐지가 먼저 / 5인큐: 우리 영웅 카운터인 캐서디가 먼저
    assert ids(solo).index("genji") < ids(solo).index("cassidy")
    assert ids(full).index("cassidy") < ids(full).index("genji")


def test_weights_for_interpolates():
    assert RULES.weights_for(0) == (3.0, 0.35)
    assert RULES.weights_for(1) == (0.5, 1.5)
    pop, thr = RULES.weights_for(0.5)
    assert 0.5 < pop < 3.0 and 0.35 < thr < 1.5
