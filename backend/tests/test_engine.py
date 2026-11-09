import pytest

from app.recommend.engine import (
    Context,
    InvalidSituation,
    Matchups,
    load_queues,
    load_weights,
    recommend,
)
from tests.conftest import hero

QUEUES = load_queues()
RQ, OQ, OTHER = QUEUES["role_queue"], QUEUES["open_queue"], QUEUES["other"]

# 메타 점수가 모두 같도록 동일한 통계를 준다 → 순위는 상성·시너지·선호로만 갈린다
STATS = [
    hero("reinhardt", "tank"),
    hero("winston", "tank"),
    hero("dva", "tank"),
    hero("cassidy", "damage"),
    hero("soldier-76", "damage"),
    hero("junkrat", "damage"),
    hero("genji", "damage"),
    hero("pharah", "damage"),
    hero("ana", "support"),
    hero("kiriko", "support"),
    hero("mercy", "support"),
    hero("lucio", "support"),
]


@pytest.fixture
def ctx():
    return Context.build(STATS, [], Matchups.load(ratings_path=None), load_weights())


def ids(recs):
    return [r["hero_id"] for r in recs]


def test_queue_config():
    assert RQ.team_size == 5 and RQ.slots == {"tank": 1, "damage": 2, "support": 2} and RQ.default
    assert OQ.team_size == 6 and OQ.slots is None and OQ.stats_fallback


def test_hitscan_vs_pharah(ctx):
    recs = recommend(ctx, queue=RQ, role="damage", allies=[], enemies=["pharah"], top=10)
    assert set(ids(recs)[:2]) == {"cassidy", "soldier-76"}
    assert ids(recs)[-1] == "junkrat"  # 파라가 정크랫 카운터
    assert any(r["kind"] == "counter" and r["enemy"] == "pharah" for r in recs[0]["reasons"])


def test_role_queue_limits_to_free_slots(ctx):
    # 아군에 탱커가 있으면 역할 미지정 추천에서 탱커는 제외
    recs = recommend(ctx, queue=RQ, role=None, allies=["reinhardt"], enemies=[], top=20)
    assert "tank" not in {r["role"] for r in recs}
    with pytest.raises(InvalidSituation) as e:
        recommend(ctx, queue=RQ, role="tank", allies=["reinhardt"], enemies=[])
    assert e.value.code == "role_full"


def test_role_queue_rejects_two_enemy_tanks(ctx):
    with pytest.raises(InvalidSituation) as e:
        recommend(ctx, queue=RQ, role="damage", allies=[], enemies=["reinhardt", "winston"])
    assert e.value.code == "too_many_role" and e.value.params == {"team": "enemies", "role": "tank", "limit": 1}


def test_open_queue_allows_stacking_and_six(ctx):
    enemies = ["reinhardt", "winston", "dva", "ana", "kiriko", "mercy"]
    recs = recommend(ctx, queue=OQ, role=None, allies=["reinhardt", "winston"], enemies=enemies, top=20)
    assert "tank" in {r["role"] for r in recs}  # 자유 큐는 탱커 3명째도 가능
    with pytest.raises(InvalidSituation):
        recommend(ctx, queue=RQ, role=None, allies=[], enemies=enemies)  # 역할 고정은 5명까지


def test_other_queue_allows_three_damage_and_five(ctx):
    enemies = ["genji", "pharah", "junkrat", "ana", "kiriko"]
    recs = recommend(ctx, queue=OTHER, role=None, allies=["genji", "pharah", "junkrat"], enemies=enemies, top=20)
    assert "damage" in {r["role"] for r in recs}  # 기타는 공격 4명째도 가능
    with pytest.raises(InvalidSituation):
        recommend(ctx, queue=RQ, role=None, allies=[], enemies=enemies)  # 역할 고정은 공격 2명까지
    with pytest.raises(InvalidSituation):
        recommend(ctx, queue=OTHER, role=None, allies=[], enemies=[*enemies, "mercy"])  # 기타도 5명까지


def test_team_size_and_duplicates(ctx):
    with pytest.raises(InvalidSituation) as e:
        recommend(ctx, queue=RQ, role=None, allies=["ana", "ana"], enemies=[])
    assert e.value.code == "duplicate_hero"
    with pytest.raises(InvalidSituation) as e:
        recommend(ctx, queue=RQ, role=None, allies=["reinhardt", "cassidy", "genji", "ana", "kiriko"], enemies=[])
    assert e.value.code == "team_too_large"


def test_allies_excluded_but_mirror_allowed(ctx):
    recs = recommend(ctx, queue=RQ, role="support", allies=["ana"], enemies=["kiriko"], top=10)
    assert "ana" not in ids(recs) and "kiriko" in ids(recs)


def test_preferred_bonus_and_filter(ctx):
    recs = recommend(ctx, queue=RQ, role="support", allies=[], enemies=[], preferred={"mercy"}, top=10)
    assert ids(recs)[0] == "mercy"
    assert {"kind": "preferred"} in recs[0]["reasons"]
    only = recommend(ctx, queue=RQ, role="support", allies=[], enemies=[], preferred={"mercy"}, preferred_only=True)
    assert ids(only) == ["mercy"]
    # 선호가 비어 있으면 필터를 걸어도 전체가 후보
    assert len(recommend(ctx, queue=RQ, role="support", allies=[], enemies=[], preferred_only=True, top=10)) == 4


def test_synergy_with_allies(ctx):
    recs = recommend(ctx, queue=RQ, role="support", allies=["reinhardt"], enemies=[], top=10)
    assert ids(recs)[0] == "lucio"  # 라인하르트-루시우 시너지
    assert {"kind": "synergy", "ally": "reinhardt"} in recs[0]["reasons"]


def test_counters_yaml_uses_known_ids(parsed):
    known = {h["hero_id"] for h in parsed["heroes"]}
    m = Matchups.load(ratings_path=None)
    used = set(m.counters) | {e for v in m.counters.values() for e in v} | {h for p in m.synergy for h in p}
    assert not used - known, used - known


def test_rating_matchups_are_antisymmetric_and_hand_counters_add_to_them():
    m = Matchups(
        counters={"cassidy": {"pharah"}, "dva": {"pharah"}, "mauga": {"dva"}},
        ratings={
            "pharah": {"echo": 10.0, "dva": 4.2},
            "echo": {"pharah": -6.0},
            "winston": {"roadhog": 30.0},
            "dva": {"mauga": 2.0},
        },
    )
    # 평점: 에코가 파라 상대로 +10, 파라가 에코의 카운터로서 -6 → 평균 8 → 0.8
    assert m.matchup("echo", "pharah") == 0.8
    assert m.matchup("pharah", "echo") == -0.8
    assert m.matchup("roadhog", "winston") == 1.5  # 상한
    assert m.matchup("cassidy", "pharah") == 1.0  # 평점이 없는 짝은 손으로 정리한 상성
    # 평점이 약해도 손으로 적은 카운터는 '유리'로 보일 만큼 오른다 (디바 > 파라)
    assert m.matchup("dva", "pharah") == 0.72
    assert m.matchup("pharah", "dva") == -0.72
    # 한쪽만 적은 짝은 평점에 더한다
    assert m.matchup("mauga", "dva") == 0.5


def test_matchups_json_is_valid(parsed):
    known = {h["hero_id"] for h in parsed["heroes"]}
    m = Matchups.load()
    assert set(m.ratings) <= known
    assert all(set(row) <= known for row in m.ratings.values())
    values = [v for row in m.ratings.values() for v in row.values()]
    assert len(values) > 300 and all(-40 < v < 40 for v in values)
    # 평점 기반 상성이 실제로 쓰이는지 (윈스턴은 로드호그에게 크게 불리하다는 데이터)
    assert m.matchup("roadhog", "winston") > 0.5


def test_lobby_ban_adds_a_slot_that_may_exceed_the_role_limit(ctx):
    from app.recommend.engine import load_bans, validate_bans

    rules = load_bans()
    assert rules.total == 4 and rules.total_with(True) == 5
    three_tanks = ["winston", "dva", "reinhardt"]
    with pytest.raises(InvalidSituation):
        validate_bans(ctx, rules, three_tanks, [])  # 로비 밴 없이 같은 역할 3명은 안 된다
    validate_bans(ctx, rules, three_tanks, [], lobby_ban=True)
    with pytest.raises(InvalidSituation):  # 한도를 넘을 수 있는 건 한 명뿐
        validate_bans(ctx, rules, ["genji", "cassidy", "soldier-76", "junkrat"], [], lobby_ban=True)
    five = ["ana", "kiriko", "genji", "pharah", "winston"]
    with pytest.raises(InvalidSituation):
        validate_bans(ctx, rules, five, [])
    validate_bans(ctx, rules, five, [], lobby_ban=True)


def test_threat_player_boosts_counters_and_avoids_weak_picks():
    def scores(**kw):
        ctx = Context.build(STATS, [], Matchups.load(ratings_path=None), load_weights(), **kw)
        recs = recommend(ctx, queue=RQ, role="damage", allies=[], enemies=["pharah"], top=10)
        return {r["hero_id"]: r for r in recs}

    plain, marked = scores(), scores(threats=["pharah"])
    # 카운터(캐서디)는 더 올라가고, 파라에게 약한 정크랫은 더 내려간다
    assert marked["cassidy"]["score"] > plain["cassidy"]["score"]
    assert marked["junkrat"]["score"] < plain["junkrat"]["score"]
    assert any(x["kind"] == "threat_counter" for x in marked["cassidy"]["reasons"])
    assert any(x["kind"] == "threat_weak" for x in marked["junkrat"]["reasons"])


def test_comp_fit_needs_two_allies():
    from app.recommend.engine import Comps

    comps = Comps.load()
    assert comps.dominant(["winston", "genji"]) == "dive"
    assert comps.dominant(["reinhardt", "widowmaker"]) is None  # 섞인 조합
    ctx = Context.build(STATS, [], Matchups.load(ratings_path=None), load_weights(), comps=comps)

    def support(allies):
        return {r["hero_id"]: r for r in recommend(ctx, queue=RQ, role="support", allies=allies, enemies=[], top=10)}

    assert "comp" not in support(["winston"])["kiriko"]["parts"]  # 아군 1명이면 판단하지 않는다
    two = support(["winston", "genji"])
    assert two["kiriko"]["parts"]["comp"] > two["mercy"]["parts"].get("comp", 0)
    assert any(x["kind"] == "comp_fit" and x["comp"] == "dive" for x in two["kiriko"]["reasons"])


def test_comps_data_only_names_known_archetypes_and_heroes():
    from app.recommend.engine import Comps

    comps = Comps.load()
    assert set(comps.archetypes) == {"dive", "poke", "rush", "anchor"}
    for hero_id, fits in comps.heroes.items():
        assert set(fits) <= set(comps.archetypes), hero_id
        assert all(0 < v <= 1 for v in fits.values()), hero_id


def test_role_balance_principles():
    from app.recommend.engine import Comps

    comps = Comps.load()
    roles = {"zenyatta": "support", "wuyang": "support", "ana": "support", "lucio": "support", "mercy": "support"}
    roles |= {"cassidy": "damage", "ashe": "damage", "genji": "damage", "tracer": "damage"}

    def kinds(team):
        return {i["kind"] for i in comps.balance_issues(team, roles.get, lambda h: None)}

    assert "low_heal" in kinds(["zenyatta", "wuyang"])  # 고HPS 힐러가 없다
    assert kinds(["ana", "zenyatta"]) == set()  # 메인·서브 짝, 힐량 충분
    assert "double_main_heal" in kinds(["lucio", "mercy"])
    assert "double_main_dps" in kinds(["cassidy", "ashe"])
    assert "double_sub_dps" in kinds(["genji", "tracer"])
    assert kinds(["cassidy", "genji"]) == set()


def test_guide_based_balance():
    """docs/team-building.md: 혼자 본대를 받치는 힐러, 메인딜 맵, 단점이 겹치는 딜러 짝"""
    from app.recommend.engine import Comps

    comps = Comps.load()
    support = ["lucio", "brigitte", "kiriko", "sombra", "doctrine", "illari", "ana", "zenyatta"]
    roles = {h: "support" for h in support} | {h: "damage" for h in ["cassidy", "ashe", "genji", "widowmaker"]}

    def kinds(team, map_id=None):
        return {i["kind"] for i in comps.balance_issues(team, roles.get, lambda h: None, map_id)}

    # 루시우·브리기테는 힐량이 높아도 혼자 본대를 못 받친다
    assert "low_heal" in kinds(["lucio", "brigitte"])
    assert "low_heal" in kinds(["illari", "brigitte"])
    assert "low_heal" not in kinds(["kiriko", "lucio"])
    assert "low_heal" not in kinds(["sombra", "doctrine"])
    assert "low_heal" not in kinds(["ana", "zenyatta"])
    # 서킷 로얄·하바나에서는 메인딜 둘이 정석
    assert "double_main_dps" in kinds(["cassidy", "ashe"], "kings-row")
    assert "double_main_dps" not in kinds(["cassidy", "ashe"], "circuit-royal")
    # 겐지+위도우: 둘 다 화력이 약하다
    assert "weak_pair" in kinds(["genji", "widowmaker"])
    assert "weak_pair" not in kinds(["genji", "cassidy"])


def test_jang_mooncheol_matchups():
    """docs/team-building.md: 장문철tv 72편에서 평점 데이터가 비어 있던 짝과 시너지"""
    m = Matchups.load()
    # 평점이 없는 짝은 손으로 정리한 상성이 채운다
    assert m.matchup("sojourn", "domina") > 0
    assert m.matchup("sigma", "mauga") > 0
    assert m.matchup("ana", "jetpack-cat") > 0
    assert m.matchup("jetpack-cat", "echo") > 0
    # 매트릭스와 마우가는 서로 맞서서 중립
    assert m.matchup("dva", "mauga") == 0
    assert m.synergizes("mauga", "kiriko")
    assert m.synergizes("zenyatta", "ana")


def test_balance_steers_the_second_support():
    from app.recommend.engine import Comps

    stats = [hero("zenyatta", "support"), hero("wuyang", "support"), hero("ana", "support"), hero("winston", "tank")]
    ctx = Context.build(stats, [], Matchups.load(ratings_path=None), load_weights(), comps=Comps.load())
    recs = {r["hero_id"]: r for r in recommend(ctx, queue=RQ, role="support", allies=["zenyatta"], enemies=[], top=5)}
    assert recs["ana"]["score"] > recs["wuyang"]["score"]
    assert recs["wuyang"]["parts"]["balance"] < 0
    assert any(x["kind"] == "low_heal" for x in recs["wuyang"]["reasons"])


def test_comp_counter_prefers_the_archetype_that_beats_the_enemy():
    from app.recommend.engine import Comps

    ctx = Context.build(STATS, [], Matchups.load(ratings_path=None), load_weights(), comps=Comps.load())
    # 상대가 다이브(윈스턴·겐지)면 다이브에 강한 러쉬형(라인하르트)이 가산된다
    recs = recommend(ctx, queue=RQ, role="tank", allies=[], enemies=["winston", "genji"], top=5)
    bonus = {r["hero_id"]: r["parts"].get("comp_counter", 0) for r in recs}
    assert bonus["reinhardt"] > bonus["dva"] >= 0
    rein = next(r for r in recs if r["hero_id"] == "reinhardt")
    assert any(x["kind"] == "comp_counter" for x in rein["reasons"])
