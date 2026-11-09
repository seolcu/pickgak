from pathlib import Path

import pytest

from app.collector import nexon

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="session")
def parsed():
    return nexon.parse_page((FIXTURES / "nexon_korea_comp_gold_ilios.html").read_text(encoding="utf-8"))


def hero(hid, role, win=50.0, pick=8.0, name=None):
    return {"hero_id": hid, "name": name or hid, "role": role, "win_rate": win, "pick_rate": pick}
