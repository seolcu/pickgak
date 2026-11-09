# Team-building principles

How PickGak judges a team beyond single-hero matchups. The rules below are community conventions. Each one nudges the score a little and shows up as a reason chip, so a pick that breaks a rule can still win.

The data lives in `backend/data/comps.yaml` and the weights in `backend/data/weights.yaml`.

## 1. Pair main and sub in damage and support

In role queue (1 tank, 2 damage, 2 support), the usual pattern is one "main" and one "sub" per role. Two mains together tends to lose efficiency ([namu.wiki: 오버워치/조합](https://namu.wiki/w/%EC%98%A4%EB%B2%84%EC%9B%8C%EC%B9%98/%EC%A1%B0%ED%95%A9)).

- **Main damage**: steady sustained damage from mid or long range. These are mostly hitscan, played near the team.
  - Sojourn, Soldier: 76, Sierra, Ashe, Emre, Widowmaker, Cassidy, Torbjörn, Freja, Hanzo
- **Sub damage**: burst and utility, flanking the enemy and making plays.
  - Genji, Reaper, Mei, Vendetta, Venture, Symmetra, Shion, Anran, Echo, Junkrat, Tracer, Pharah
- **Main healer**: stable, sustained healing.
  - Lifeweaver, Lúcio, Mercy, Mizuki, Brigitte, Wuyang, Juno
- **Sub healer**: burst healing or utility that changes fights.
  - Doctrine, Moira, Baptiste, Sombra, Ana, Illari, Jetpack Cat, Zenyatta, Kiriko

**In PickGak**, each of these pairs is a mild penalty with a chip. They can still be right in specific cases.

| Pair | Chip |
| --- | --- |
| Two main damage | "메인딜 둘" / "Two main DPS" |
| Two sub damage | "서브딜 둘" / "Two flex DPS" |
| Two main healers (they lack utility) | "메인힐 둘" / "Two main healers" |

Two sub healers is allowed, because their utilities can combine.

## 2. At least one support who heals the group alone

With a single tank, supports carry more pressure. One of the two supports must be able to keep the main group alive alone; the other is then free to pick for utility or to counter the enemy ([namu.wiki](https://namu.wiki/w/%EC%98%A4%EB%B2%84%EC%9B%8C%EC%B9%98/%EC%A1%B0%ED%95%A9), [squadb](https://www.squadb.com.br/en/blog/overwatch-team-composition-5v5/)). The tiers below follow a high-rank coach's composition guide ([옵치토크쇼, 중급 가이드 2편 조합, 2026-09-30](https://www.youtube.com/watch?v=23Oo2N_idfY)) and the patch reviews listed under "Sources".

| Value | Supports | Why |
| --- | --- | --- |
| 0.9 | Ana, Baptiste, Juno, Kiriko, Doctrine | heal the main group alone |
| 0.75 | Wuyang, Moira, Lifeweaver, Mercy | decent healing, not a solo healer |
| 0.65 | Illari, Mizuki | a step lower |
| 0.55 | Jetpack Cat | heals fine, but plays wide and aggressive |
| 0.45 | Lúcio, Brigitte | high numbers, but Lúcio has area healing only and Brigitte cannot heal at range |
| 0.35 | Sombra | since the October 2026 rework a damage-leaning support for dive |
| 0.3 | Zenyatta | picked for damage, not healing |

**In PickGak**:
- Heroes without a value use their official subrole default: medic 0.85, survivor 0.6, tactician 0.5.
- If the two supports add up to less than 1.2, the pick that completes the pair is penalized and gets a "힐량 부족" / "Not enough healing" chip.
  - Lúcio + Brigitte (0.9) and Zenyatta + Wuyang (1.05) are short.
  - Ana + Zenyatta (1.2) and Sombra + Doctrine (1.25) are fine.

## 2b. Map and shared weaknesses in damage pairs

- **Main-damage maps**: on Circuit Royal and Havana, two main damage heroes is a normal pick, so the "메인딜 둘" penalty does not apply there.
- **Shared weaknesses**: two damage heroes whose weaknesses stack fall to one answer. Genji + Widowmaker both lack firepower; Reaper + Junkrat cannot hit flyers. Chip "단점이 겹치는 딜러 조합" / "Damage pair with shared weaknesses".

## 3. Archetypes and the triangle

Teams tend to form one of four archetypes ([namu.wiki](https://namu.wiki/w/%EC%98%A4%EB%B2%84%EC%9B%8C%EC%B9%98/%EC%A1%B0%ED%95%A9), [GuildOrder](https://guildorder.com/games/overwatch/guides/composition-archetypes), [ProSettings](https://prosettings.net/blog/overwatch-team-comps-explained/)):

| Archetype | Idea | Strong into | Weak into |
| --- | --- | --- | --- |
| Dive (다이브) | Mobile heroes jump the backline together | Poke | Rush |
| Rush (러쉬) | Move as one group and win close fights with sustain | Dive | Poke |
| Poke (포킹) | Win at range from safe angles before the fight starts | Rush, Anchor | Dive |
| Anchor (앵커) | Hold one area and take the enemy's engage | – | Poke |

**In PickGak**:
- **Archetype fit**: each hero fits one or more archetypes (0–1). A team "is" an archetype when one archetype makes up at least half of its total and at least 1.0.
- **Team fit**: with two or more allies of one clear archetype, heroes that fit it get a bonus (chip "다이브 조합에 맞음").
- **Counter fit**: with two or more enemies of one clear archetype, heroes of an archetype that beats it get a smaller bonus (chip "상대 다이브 조합에 강함").
- **Comp label**: both teams' archetypes show next to the team names.
- **Neutral heroes**: heroes whose kit fit isn't documented have no archetype tags and don't move the result.

## 4. The tank leads

The comp is built around the tank, and the damage and supports fill around it ([GuildOrder](https://guildorder.com/games/overwatch/guides/composition-archetypes)). A mobile diving tank with static supports leaves the tank alone ([namu.wiki](https://namu.wiki/w/%EC%98%A4%EB%B2%84%EC%9B%8C%EC%B9%98/%EC%A1%B0%ED%95%A9)).

**In PickGak**: the tank counts toward the team's archetype like any ally, so once the tank is set, the rest of the recommendations lean toward fitting it.

## 5. Threat players

A much stronger enemy player (a smurf) changes the game more than their hero alone. Mark that enemy slot with the flame button:
- Matchups against that hero count double.
- Picks that the hero strongly counters get an extra penalty.
- Chips "위험 플레이어(…) 카운터" / "…에게 약함" explain the effect.

## Sources from recent videos

Checked in October 2026 (auto-generated Korean subtitles), all from the 장지수 해설 channel:
- [중급 가이드 2편 조합](https://www.youtube.com/watch?v=23Oo2N_idfY) (2026-09-30): healer tiers, main/sub damage, main-damage maps, shared weaknesses, tanks by map.
- [5시즌 패치노트](https://www.youtube.com/watch?v=kiQNz1wT28Q) (2026-10-07): Doctrine heals the group alone after the nerfs; D.Mon with Ana's nano and speed boost.
- [호그 솜브라 리워크 후기](https://www.youtube.com/watch?v=BH25us25AWE) (2026-10-08): Sombra is a damage-leaning support for dive comps; Sombra + Doctrine is the popular pair.

Archetype tags added from these: D.Mon (rush, a melee brawler for narrow maps) and Jetpack Cat (dive). Synergies added: Ana + D.Mon, Sombra + Doctrine.

### 장문철tv, episodes 742-813 (2026-07-04 to 2026-10-29)

In each episode a viewer sends in a replay of a lost match, and the host explains which picks and swaps would have won it. All 72 episodes were checked through their auto-generated Korean subtitles.

Most of the host's counter calls already agree with the counterwatch ratings in `data/matchups.json`. Examples:
- Brigitte into D.Va
- Echo and Ashe into Pharah
- Winston into Widowmaker
- Roadhog into Wrecking Ball

Ratings stay the base. A pair listed in `data/counters.yaml` adds 0.3 on top of its rating (enough to show as a counter when the rating is neutral), and a pair without a rating uses the list alone. These pairs had no rating and were added to the list:

| Pick | Into | Why | Episodes |
| --- | --- | --- | --- |
| Sojourn | Domina | breaks the segmented barrier from range | 743, 757, 763 |
| Sigma | Mauga | Kinetic Grasp absorbs the Cardiac Overdrive turn | 790 |
| D.Va | Mauga | Defense Matrix, the other standard answer; this cancels the older `mauga: [dva]` to neutral | 790 |
| Sigma | Bastion | "don't play Bastion into Sigma or D.Va" | 783 |
| Orisa | Wrecking Ball | ball can't play into Orisa, Sombra, Cassidy and Mizuki | 799 |
| Sierra | Reaper, Orisa | long range against short-range, large, slow heroes | 761 |
| Wuyang | Orisa | same reason | 761 |
| Ana, Illari | Jetpack Cat | long-range hitscan support against a flying healer | 751 |
| Jetpack Cat | Echo | "once Cat is out, flying heroes have a hard time" | 810 |

Synergies added:
- Kiriko + Mauga: Kitsune Rush and Suzu cover his Cage Fight turn; "nearly required" (770).
- Mauga + Reaper: a close-range damage hero who fights inside the Overdrive buff (770, 773).
- Zarya + Genji: they dive behind her bubbles (799).
- Ana + Zenyatta: "a scary healer pair" (756).

The host also repeated points that PickGak already models:
- Kiriko is now a main-group healer, so her heal value is 0.9 (755, 785).
- Moira is a poor pick in poke fights, where her archetype is only rush (748, 771).
- Genji + Widowmaker has no safe floor, which is the `weak_pair` rule (791).

What was left out:
- Advice about how to play: positioning, holding resources, not trading for nothing.
- One-off map remarks, such as Zenyatta + Mercy being poor on Rialto (755).
- "Pick an easy, strong tank" at low ranks, because it is about skill, not the matchup.

## What PickGak does not judge (yet)

- **Communication and coordination**: dive and rush need the whole team to commit, which is harder in solo queue ([ProSettings](https://prosettings.net/blog/overwatch-team-comps-explained/)).
- **Map geometry**: high ground favors dive, flat maps favor rush and anchor. Map win rates already cover part of this.
- **Ultimate economy and combos.**
