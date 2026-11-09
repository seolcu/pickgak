from app.analysis.meta import adjusted_win_rate, compare, score_heroes
from tests.conftest import hero


def test_adjusted_win_rate_shrinks_low_pick():
    assert adjusted_win_rate(70, 0.1) < adjusted_win_rate(70, 10) < 70
    assert adjusted_win_rate(50, 5) == 50


def test_score_heroes_tiers():
    stats = [hero(f"t{i}", "tank", 45 + i, 5 + i) for i in range(6)] + [hero("x", "tank", None, None)]
    scored = score_heroes(stats)
    assert scored[0]["hero_id"] == "t5" and scored[0]["tier"] == "S"
    assert scored[-1]["tier"] == "D"
    assert "x" not in {h["hero_id"] for h in scored}


def test_compare():
    rows = compare([hero("a", "tank", 52, 10)], [hero("a", "tank", 49, 12)])
    assert rows[0]["win_delta"] == 3 and rows[0]["pick_delta"] == -2
