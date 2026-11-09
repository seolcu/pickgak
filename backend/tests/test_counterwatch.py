from app.collector import counterwatch


def row(slug, rating, conf="High", players=400):
    return (
        '<li><div class="group flex items-stretch border-l-2">'
        f'<a href="/stats/overwatch/heroes/{slug}">x</a>'
        f'<span class="text-lg font-semibold tabular-nums leading-none text-primary">{rating}</span>'
        f'<abbr title="{conf} confidence: {players} players contributed">i</abbr></div></li>'
    )


def test_parse_filters_and_maps_slugs():
    page = "".join(
        [
            row("symmetra", "+10.3"),
            row("anran", "+8.0", "Very high", "1,564"),  # 두 단어 등급 + 쉼표 숫자
            row("soldier76", "-4.0", "Good"),
            row("ana", "+8.0", "Low"),  # 신뢰도 낮음 → 제외
            row("mercy", "+1.2"),  # 미미함 → 제외
            row("domina", "+9.9"),  # 자기 자신 → 제외
        ]
    )
    assert counterwatch.parse(page, "domina") == {"symmetra": 10.3, "anran": 8.0, "soldier-76": -4.0}
