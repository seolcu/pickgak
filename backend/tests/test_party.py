import pytest

from app.recommend.engine import Context, InvalidSituation, Matchups, load_queues, load_weights
from app.recommend.party import Member, recommend_party, role_assignments
from tests.test_engine import STATS

QUEUES = load_queues()
RQ, OQ = QUEUES["role_queue"], QUEUES["open_queue"]


@pytest.fixture
def ctx():
    return Context.build(STATS, [], Matchups.load(ratings_path=None), load_weights())


def picked(combo):
    return {p["member"]: p["hero_id"] for p in combo["picks"]}


def test_duo_picks_synergy_pair(ctx):
    # 탱커 + 지원 듀오: 시너지 쌍(라인하르트+루시우 등)이 함께 뽑혀야 한다
    members = [Member("a", "tank"), Member("b", "support")]
    res = recommend_party(ctx, queue=RQ, members=members, allies=[], enemies=[])
    best = res["combos"][0]
    assert best["synergies"], best
    pair = set(picked(best).values())
    assert ctx.matchups.synergizes(*pair)


def test_no_duplicate_heroes_in_combo(ctx):
    members = [Member("a", "damage"), Member("b", "damage")]
    for combo in recommend_party(ctx, queue=RQ, members=members, allies=[], enemies=[])["combos"]:
        heroes = list(picked(combo).values())
        assert len(set(heroes)) == len(heroes)


def test_unassigned_roles_respect_slots(ctx):
    # 아군에 탱커가 이미 있으면, 역할 미정 파티원 3명은 딜/힐 슬롯에만 배정된다
    members = [Member("a"), Member("b"), Member("c")]
    res = recommend_party(ctx, queue=RQ, members=members, allies=["reinhardt"], enemies=[])
    for combo in res["combos"]:
        roles = [p["role"] for p in combo["picks"]]
        assert "tank" not in roles
        assert roles.count("damage") <= 2 and roles.count("support") <= 2


def test_role_assignments():
    free = {"tank": 1, "damage": 2, "support": 2}
    assert len(role_assignments([Member("a", "tank"), Member("b")], free)) == 2  # b는 딜 또는 힐
    with pytest.raises(InvalidSituation):
        role_assignments([Member("a", "tank"), Member("b", "tank")], free)
    assert role_assignments([Member("a"), Member("b")], None) == [(None, None)]


def test_member_preferences(ctx):
    members = [Member("a", "support", preferred={"mercy"}), Member("b", "damage", preferred={"pharah"})]
    best = recommend_party(ctx, queue=RQ, members=members, allies=[], enemies=[])["combos"][0]
    assert picked(best) == {"a": "mercy", "b": "pharah"}  # 선호 + 메르시·파라 시너지


def test_preferred_role_assignment(ctx):
    members = [Member("a", preferred_roles=["support"]), Member("b", preferred_roles=["damage"])]
    best = recommend_party(ctx, queue=RQ, members=members, allies=[], enemies=[])["combos"][0]
    roles = {p["member"]: p["role"] for p in best["picks"]}
    assert roles == {"a": "support", "b": "damage"}


def test_open_queue_party(ctx):
    members = [Member("a"), Member("b"), Member("c")]
    res = recommend_party(ctx, queue=OQ, members=members, allies=["reinhardt", "winston", "dva"], enemies=[])
    assert res["combos"] and res["alternatives"].keys() == {"a", "b", "c"}


def test_open_queue_respects_preferred_role(ctx):
    # 자유 큐: 역할 슬롯이 없어도 선호 역할(지원)이 반영되어야 한다
    members = [Member("a"), Member("b", preferred_roles=["support"])]
    for combo in recommend_party(ctx, queue=OQ, members=members, allies=[], enemies=[])["combos"]:
        assert next(p for p in combo["picks"] if p["member"] == "b")["role"] == "support"


def test_preferred_role_falls_back_when_full(ctx):
    # 탱커 선호인데 아군 탱커 자리가 이미 찼으면 다른 역할로 배정
    members = [Member("a", preferred_roles=["tank"])]
    best = recommend_party(ctx, queue=RQ, members=members, allies=["reinhardt"], enemies=[])["combos"][0]
    assert best["picks"][0]["role"] != "tank"


def test_preferred_only_per_member(ctx):
    # 친구는 선호 영웅(메르시)만, 나는 아무거나
    members = [
        Member("me", "damage", preferred={"genji"}, preferred_only=False),
        Member("friend", "support", preferred={"mercy"}, preferred_only=True),
    ]
    res = recommend_party(ctx, queue=RQ, members=members, allies=[], enemies=[])
    for combo in res["combos"]:
        assert picked(combo)["friend"] == "mercy"
    assert {picked(c)["me"] for c in res["combos"]} > {"genji"}  # 나는 선호 밖 영웅도 나온다
    assert {a["hero_id"] for a in res["alternatives"]["friend"]} == {"mercy"}
