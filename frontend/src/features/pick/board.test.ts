import { describe, expect, it } from "vitest";
import type { Player, QueueConfig, Role } from "../../lib/api";
import {
  applyBans,
  diffReading,
  addMember,
  applyPicks,
  applyReading,
  banRulesFor,
  setLobbyBan,
  swapSlots,
  threatHeroes,
  toggleThreat,
  assignRole,
  chosenRole,
  heroCount,
  inBanPhase,
  isAutoRole,
  newMatch,
  placeHero,
  toggleBan,
  whyDisabled,
  movePerson,
  newBoard,
  removeMember,
  roleOf,
  onlyPreferredFor,
  preferredBy,
  sanitize,
  setOnlyPreferred,
  slotOf,
  switchQueue,
  toggleAllyWant,
  updateSlot,
} from "./board";

const RQ: QueueConfig = { team_size: 5, slots: { tank: 1, damage: 2, support: 2 }, stats_fallback: false, default: true };
const OQ: QueueConfig = { team_size: 6, slots: null, stats_fallback: true, default: false };
const OTHER: QueueConfig = { team_size: 5, slots: null, stats_fallback: true, default: false };
const player = (id: number, preferred_roles: Player["preferred_roles"] = [], is_me = false): Player => ({
  id,
  name: `p${id}`,
  is_me,
  preferred_roles,
  heroes: [],
  only_preferred: false,
});
const ME = { kind: "me" } as const;
const P = (id: number) => ({ kind: "player", id }) as const;

describe("party placement (role queue)", () => {
  it("starts me in my preferred role", () => {
    const b = newBoard("role_queue", RQ, undefined, player(1, ["support"], true));
    expect(roleOf(b, ME)).toBe("support");
  });

  it("adds a member directly into the chosen role", () => {
    let b = newBoard("role_queue", RQ);
    b = addMember(b, P(2), "support");
    expect(slotOf(b, 2)?.role).toBe("support");
  });

  it("uses the single preferred role when no role is chosen", () => {
    const b = addMember(newBoard("role_queue", RQ), P(2), null, ["tank"]);
    expect(roleOf(b, P(2))).toBe("tank");
  });

  it("changing role moves to that role and swaps with a party member already there", () => {
    let b = newBoard("role_queue", RQ); // 나 = 공격
    b = addMember(b, P(2), "tank");
    b = assignRole(b, ME, "tank"); // 탱커는 1자리뿐 → 맞바꾸기
    expect(roleOf(b, ME)).toBe("tank");
    expect(roleOf(b, P(2))).toBe("damage");
  });

  it("prefers an empty slot over a random teammate who already picked a hero", () => {
    let b = newBoard("role_queue", RQ);
    b = updateSlot(b, "allies", "allies-3", { hero: "ana" }); // 지원1 = 랜덤 팀원(아나)
    b = addMember(b, P(2), "support");
    expect(slotOf(b, 2)?.id).toBe("allies-4");
  });

  it("moving a new member onto my slot pushes me to a free slot instead of dropping me", () => {
    let b = newBoard("role_queue", RQ);
    const mine = b.allies.find((s) => s.isMe)!.id;
    b = movePerson(b, P(2), mine);
    expect(slotOf(b, 2)?.id).toBe(mine);
    expect(b.allies.filter((s) => s.isMe)).toHaveLength(1);
  });

  it("removing a member keeps the hero as a random teammate", () => {
    let b = addMember(newBoard("role_queue", RQ), P(2), "support");
    const slot = slotOf(b, 2)!;
    b = updateSlot(b, "allies", slot.id, { hero: "kiriko" });
    b = removeMember(b, 2);
    expect(slotOf(b, 2)).toBeUndefined();
    expect(b.allies.find((s) => s.id === slot.id)?.hero).toBe("kiriko");
  });
});

describe("party placement (open queue)", () => {
  it("records the role for this match without moving", () => {
    let b = newBoard("open_queue", OQ);
    b = addMember(b, P(2), "support");
    expect(roleOf(b, P(2))).toBe("support");
    b = assignRole(b, P(2), null);
    expect(roleOf(b, P(2))).toBeNull();
  });

  it("keeps roles when switching from role queue to open queue and back", () => {
    let b = addMember(newBoard("role_queue", RQ), P(2), "tank");
    b = switchQueue(b, "open_queue", OQ, new Map(), [player(2, [])]);
    expect(roleOf(b, P(2))).toBe("tank");
    b = switchQueue(b, "role_queue", RQ, new Map(), [player(2, [])]);
    expect(roleOf(b, P(2))).toBe("tank");
  });
});

describe("other queue", () => {
  it("has five slots without roles, so a third damage hero fits", () => {
    let b = newBoard("other", OTHER);
    expect(b.enemies.map((s) => s.role)).toEqual([null, null, null, null, null]);
    for (const h of ["genji", "tracer", "sojourn"]) {
      const r = placeHero(b, "enemies", h, "damage");
      if (!("board" in r)) throw new Error("asked");
      b = r.board;
    }
    expect(b.enemies.filter((s) => s.hero).length).toBe(3);
  });
});

describe("ally wants", () => {
  it("toggles and survives queue switches; unknown heroes are dropped", () => {
    let b = toggleAllyWant(newBoard("role_queue", RQ), "ana");
    expect(b.allyWants).toEqual(["ana"]);
    b = switchQueue(b, "open_queue", OQ, new Map(), []);
    expect(b.allyWants).toEqual(["ana"]);
    expect(sanitize(b, new Set(["kiriko"]), null).allyWants).toEqual([]);
    expect(toggleAllyWant(b, "ana").allyWants).toEqual([]);
  });
});

describe("only preferred", () => {
  const me: Player = { id: 1, name: "me", is_me: true, preferred_roles: [], heroes: ["genji"], only_preferred: false };
  const friend: Player = { ...me, id: 2, is_me: false, heroes: ["mercy"], only_preferred: true };
  it("uses the profile default, overridable per match, and is off without preferred heroes", () => {
    let b = newBoard("role_queue", RQ);
    expect(onlyPreferredFor(b, ME, me)).toBe(false);
    expect(onlyPreferredFor(b, P(2), friend)).toBe(true);
    b = setOnlyPreferred(b, P(2), false);
    expect(onlyPreferredFor(b, P(2), friend)).toBe(false);
    b = setOnlyPreferred(b, ME, true);
    expect(onlyPreferredFor(b, ME, { ...me, heroes: [] })).toBe(false);
  });

  it("stars only the preference of the row's own player", () => {
    const me: Player = { id: 1, name: "me", is_me: true, preferred_roles: [], heroes: ["genji"], only_preferred: false };
    const friend: Player = { ...me, id: 2, is_me: false, heroes: ["pharah"], only_preferred: false };
    // 내 목록에서 파티원이 선호하는 파라에 내 별이 붙으면 안 된다
    expect(preferredBy(me, "pharah")).toBe(false);
    expect(preferredBy(friend, "pharah")).toBe(true);
    expect(preferredBy(me, "genji")).toBe(true);
    expect(preferredBy(null, "genji")).toBe(false);
    expect(preferredBy(me, null)).toBe(false);
  });
});

describe("hero input", () => {
  const empty = () => newBoard("role_queue", RQ);
  const placed = (r: ReturnType<typeof placeHero>) => {
    if (!("board" in r)) throw new Error("asked");
    return r.board;
  };
  const heroes = (b: ReturnType<typeof empty>, team: "allies" | "enemies") => b[team].map((s) => s.hero);

  it("puts a hero into the first empty slot of its role, and a second tap removes it", () => {
    let b = placed(placeHero(empty(), "enemies", "ana", "support"));
    expect(heroes(b, "enemies")).toEqual([null, null, null, "ana", null]);
    b = placed(placeHero(b, "enemies", "ana", "support"));
    expect(heroes(b, "enemies")).toEqual([null, null, null, null, null]);
  });

  it("fills random-teammate ally slots before my slot", () => {
    // 나 = 첫 공격 칸 (allies-1)
    const b = placed(placeHero(empty(), "allies", "genji", "damage"));
    expect(b.allies.find((s) => s.id === "allies-2")?.hero).toBe("genji");
  });

  it("replaces directly when the role has a single slot, asks when it has two", () => {
    let b = placed(placeHero(empty(), "enemies", "dva", "tank"));
    b = placed(placeHero(b, "enemies", "winston", "tank"));
    expect(heroes(b, "enemies")[0]).toBe("winston");
    b = placed(placeHero(b, "enemies", "ana", "support"));
    b = placed(placeHero(b, "enemies", "kiriko", "support"));
    expect(placeHero(b, "enemies", "lucio", "support")).toEqual({ ask: "support" });
    b = placed(placeHero(b, "enemies", "lucio", "support", "enemies-3"));
    expect(heroes(b, "enemies")).toEqual(["winston", null, null, "lucio", "kiriko"]);
  });

  it("puts the hero into a focused slot of the right role", () => {
    const b = placed(placeHero(empty(), "enemies", "ana", "support", "enemies-4"));
    expect(heroes(b, "enemies")[4]).toBe("ana");
  });

  it("explains why a hero can't go somewhere", () => {
    const rules = { total: 4, max_per_role: 2 };
    const role = (h: string) => (["ana", "kiriko", "lucio"].includes(h) ? "support" : "damage") as "support" | "damage";
    let b = { ...empty(), bans: ["ana", "kiriko"] };
    expect(whyDisabled(b, "bans", "lucio", "support", role, rules)).toBe("banRoleFull");
    expect(whyDisabled(b, "enemies", "ana", "support", role, rules)).toBe("banned");
    expect(whyDisabled(b, "enemies", "ana", "support", role, null)).toBeNull(); // 빠른 대전: 금지 없음
    b = placed(placeHero(b, "enemies", "genji", "damage"));
    expect(whyDisabled(b, "bans", "genji", "damage", role, rules)).toBe("picked");
    expect(toggleBan(b, "ana").bans).toEqual(["kiriko"]);
  });

  it("a new match keeps the party and roles but clears heroes, bans and this-match settings", () => {
    let b = addMember(empty(), P(2), "tank");
    b = setOnlyPreferred(b, P(2), true);
    b = assignRole(b, ME, null);
    b = placed(placeHero({ ...b, bans: ["ana"] }, "enemies", "genji", "damage"));
    expect(inBanPhase(b, { total: 4, max_per_role: 2 })).toBe(false);
    const n = newMatch(b);
    expect(roleOf(n, P(2))).toBe("tank");
    expect(isAutoRole(n, ME)).toBe(true);
    expect(n.onlyPreferred).toBeUndefined();
    expect(heroCount(n)).toBe(0);
    expect(n.bans).toEqual([]);
    expect(inBanPhase(n, { total: 4, max_per_role: 2 })).toBe(true);
  });
});

describe("auto role (role queue)", () => {
  it("auto keeps the slot; applying a pick of another role moves the person there", () => {
    let b = assignRole(newBoard("role_queue", RQ), ME, null);
    expect(chosenRole(b, ME)).toBeNull();
    expect(roleOf(b, ME)).toBe("damage");
    const mine = b.allies.find((s) => s.isMe)!.id;
    b = applyPicks(b, [{ slotId: mine, hero: "ana", role: "support" }]);
    expect(roleOf(b, ME)).toBe("support");
    expect(b.allies.find((s) => s.isMe)?.hero).toBe("ana");
    expect(isAutoRole(b, ME)).toBe(true);
    // 역할을 직접 고르면 자동이 꺼진다
    expect(isAutoRole(assignRole(b, ME, "tank"), ME)).toBe(false);
  });

  it("applies a party combo that swaps two auto members' roles", () => {
    let b = addMember(newBoard("role_queue", RQ), P(2), "support"); // 나 공격, 친구 지원
    b = assignRole(assignRole(b, ME, null), P(2), null);
    const mine = slotOf(b, 2)!.id;
    const meId = b.allies.find((s) => s.isMe)!.id;
    b = applyPicks(b, [
      { slotId: meId, hero: "kiriko", role: "support" },
      { slotId: mine, hero: "genji", role: "damage" },
    ]);
    expect(roleOf(b, ME)).toBe("support");
    expect(roleOf(b, P(2))).toBe("damage");
    expect(slotOf(b, 2)?.hero).toBe("genji");
    expect(b.allies.find((s) => s.isMe)?.hero).toBe("kiriko");
  });
});

describe("slot swap", () => {
  it("swaps whole slots within a role, keeps people with their heroes, and survives applying a pick", () => {
    let b = newBoard("role_queue", RQ); // 나 = allies-1 (공격 왼쪽)
    b = updateSlot(b, "allies", "allies-2", { hero: "tracer" });
    b = swapSlots(b, "allies", "allies-1", "allies-2");
    expect(b.allies.find((s) => s.isMe)?.id).toBe("allies-2");
    expect(b.allies.find((s) => s.id === "allies-1")?.hero).toBe("tracer");
    b = applyPicks(b, [{ slotId: "allies-2", hero: "genji", role: "damage" }]);
    expect(b.allies.map((s) => s.hero)).toEqual([null, "tracer", "genji", null, null]);
    // 다른 역할 칸끼리는 바꾸지 않는다
    expect(swapSlots(b, "allies", "allies-0", "allies-1")).toBe(b);
  });
});

describe("lobby ban", () => {
  const cfg = { total: 4, lobby: 1, max_per_role: 2 };
  const role = (h: string) => (["winston", "dva", "reinhardt", "sigma"].includes(h) ? "tank" : "support") as "tank" | "support";

  it("adds a 5th slot that may exceed the role limit once", () => {
    let b = { ...newBoard("role_queue", RQ), bans: ["winston", "dva"] };
    expect(whyDisabled(b, "bans", "reinhardt", "tank", role, banRulesFor(cfg, false))).toBe("banRoleFull");
    b = setLobbyBan(b, true, cfg, role);
    expect(whyDisabled(b, "bans", "reinhardt", "tank", role, banRulesFor(cfg, true))).toBeNull();
    b = toggleBan(b, "reinhardt");
    expect(whyDisabled(b, "bans", "sigma", "tank", role, banRulesFor(cfg, true))).toBe("banRoleFull");
    // 끄면 넘친 금지를 뺀다
    expect(setLobbyBan(b, false, cfg, role).bans).toEqual(["winston", "dva"]);
    expect(newMatch(b).lobbyBan).toBe(false);
  });
});

describe("threat player", () => {
  it("is marked per enemy slot, follows swaps and hero changes, and resets on a new match", () => {
    let b = updateSlot(newBoard("role_queue", RQ), "enemies", "enemies-1", { hero: "genji" });
    b = toggleThreat(b, "enemies-1");
    expect(threatHeroes(b)).toEqual(["genji"]);
    b = updateSlot(b, "enemies", "enemies-1", { hero: "tracer" }); // 같은 플레이어가 영웅을 바꿈
    expect(threatHeroes(b)).toEqual(["tracer"]);
    b = swapSlots(b, "enemies", "enemies-1", "enemies-2");
    expect(b.enemies.find((s) => s.id === "enemies-2")?.threat).toBe(true);
    expect(threatHeroes(newMatch(b))).toEqual([]);
  });
});

describe("TAB reading", () => {
  const roles: Record<string, Role> = {
    "junker-queen": "tank", vendetta: "damage", genji: "damage", sombra: "support", hanzo: "damage",
    junkrat: "damage", ana: "support", tracer: "damage", dmon: "tank",
  };
  const roleOf = (h: string) => roles[h];

  it("fills heroes by row, keeps unknown rows, and moves me to my highlighted row", () => {
    let b = newBoard("role_queue", RQ); // 나 = allies-1
    b = swapSlots(b, "allies", "allies-1", "allies-2"); // 앱에서는 오른쪽 칸에 있었다
    const allies = ["junker-queen", "vendetta", "genji", null, "sombra"];
    const enemies = ["__unknown__", "junkrat", null, "ana", "__dead__"];
    const { board, filled } = applyReading(b, allies, enemies, 1, roleOf);
    expect(board.allies.find((s) => s.isMe)?.id).toBe("allies-1");
    expect(board.allies.map((s) => s.hero)).toEqual(["junker-queen", "vendetta", "genji", null, "sombra"]);
    expect(board.enemies.map((s) => s.hero)).toEqual([null, "junkrat", null, "ana", null]);
    expect(filled).toBe(6);
  });

  it("practice range: my row is on top whatever my role; the bot goes to a slot of its role", () => {
    const b = newBoard("role_queue", RQ);
    const empty = ["__empty__", "__empty__", "__empty__", "__empty__"];
    const tank = applyReading(b, ["dmon", ...empty], ["tracer"], 0, roleOf);
    expect(tank.board.allies[0].hero).toBe("dmon");
    expect(tank.board.allies[0].isMe).toBe(true);
    expect(tank.board.enemies.filter((s) => s.hero).map((s) => [s.hero, s.role])).toEqual([["tracer", "damage"]]);
    // 공격 영웅이 맨 위 줄이면 공격 칸으로 보내고, 내 자리도 그 칸으로 옮긴다
    const dmg = applyReading(b, ["hanzo", ...empty], ["tracer"], 0, roleOf);
    expect(dmg.board.allies[0].hero).toBeNull();
    const mine = dmg.board.allies.find((s) => s.isMe)!;
    expect(mine.hero).toBe("hanzo");
    expect(mine.role).toBe("damage");
    expect(dmg.filled).toBe(2); // 한조 + 봇 트레이서
  });

  it("practice range: switching heroes keeps my slot and replaces the bot", () => {
    const empty = ["__empty__", "__empty__", "__empty__", "__empty__"];
    let b = newBoard("role_queue", RQ);
    b = applyReading(b, ["hanzo", ...empty], ["tracer"], 0, roleOf).board;
    const slot = b.allies.find((s) => s.isMe)!.id;
    expect(b.enemies.find((s) => s.hero)?.hero).toBe("tracer");
    // 같은 역할로 바꾸면 같은 칸
    b = applyReading(b, ["vendetta", ...empty], ["dmon"], 0, roleOf).board;
    expect(b.allies.find((s) => s.isMe)!.id).toBe(slot);
    expect(b.allies.filter((s) => s.hero).map((s) => s.hero)).toEqual(["vendetta"]);
    expect(b.enemies.filter((s) => s.hero).map((s) => s.hero)).toEqual(["dmon"]);
    // 다른 역할이면 그 역할 칸으로 옮기고 예전 영웅은 지운다
    b = applyReading(b, ["junker-queen", ...empty], ["dmon"], 0, roleOf).board;
    expect(b.allies.find((s) => s.isMe)!.role).toBe("tank");
    expect(b.allies.filter((s) => s.hero).map((s) => s.hero)).toEqual(["junker-queen"]);
  });

  it("skips heroes with no free slot of their role, and duplicates", () => {
    const b = newBoard("role_queue", RQ);
    // 공격 영웅 셋: 공격 칸은 둘뿐
    const three = applyReading(b, ["tracer", "genji", "vendetta", null, null], [], null, roleOf);
    expect(three.board.allies.filter((s) => s.hero).length).toBe(2);
    const dup = applyReading(b, [null, "genji", "genji", null, null], [], null, roleOf);
    expect(dup.board.allies.every((s) => !s.hero)).toBe(true);
  });
});

describe("TAB bans", () => {
  const cfg = { total: 4, lobby: 1 };
  it("fills bans from the strip, with the lobby ban when there are five", () => {
    const b = newBoard("role_queue", RQ);
    expect(applyBans(b, ["ana", "zarya", "winston", "kiriko"], cfg).bans).toEqual(["ana", "zarya", "winston", "kiriko"]);
    const five = applyBans(b, ["ana", "zarya", "winston", "kiriko", "sombra"], cfg);
    expect(five.bans.length).toBe(5);
    expect(five.lobbyBan).toBe(true);
    // 투표가 모자라면 금지가 3개 이하일 수도 있다
    const three = applyBans(b, ["ana", "zarya", "winston"], cfg);
    expect(three.bans).toEqual(["ana", "zarya", "winston"]);
    expect(three.lobbyBan).toBe(false);
  });
  it("leaves bans alone when an icon wasn't recognized or there are too many", () => {
    const b = newBoard("role_queue", RQ);
    expect(applyBans(b, ["ana", null, "winston"], cfg)).toBe(b);
    expect(applyBans(b, ["a", "b", "c", "d", "e", "f"], cfg)).toBe(b);
    expect(applyBans(b, [], cfg)).toBe(b);
  });
});

describe("repeated TAB readings", () => {
  const roles: Record<string, Role> = { genji: "damage", tracer: "damage", ana: "support", "junker-queen": "tank" };
  const roleOf = (h: string) => roles[h];
  it("keeps a manual correction while the screen shows the same thing", () => {
    const reading = ["junker-queen", "genji", null, "ana", null];
    let b = applyReading(newBoard("role_queue", RQ), reading, [], null, roleOf).board;
    expect(b.allies[1].hero).toBe("genji");
    // 사용자가 겐지를 트레이서로 고쳤다
    b = { ...b, allies: b.allies.map((s, i) => (i === 1 ? { ...s, hero: "tracer" } : s)) };
    // 같은 화면이 다시 와도 그대로
    const again = applyReading(b, diffReading(reading, reading), [], null, roleOf);
    expect(again.board.allies[1].hero).toBe("tracer");
    expect(again.filled).toBe(0);
    // 게임에서 실제로 바뀌면 반영
    const changed = ["junker-queen", "genji", "tracer", "ana", null];
    expect(diffReading(reading, changed)).toEqual([null, null, "tracer", null, null]);
  });
  it("treats a different row count as all new", () => {
    expect(diffReading(["a"], ["a", "b"])).toEqual(["a", "b"]);
    expect(diffReading(null, ["a"])).toEqual(["a"]);
  });
});

describe("reading my row", () => {
  const roles: Record<string, Role> = { mei: "support", ashe: "damage", orisa: "tank", kiriko: "support" };
  const roleOf = (h: string) => roles[h];
  const reading = (meRow: number, rows: (string | null)[]) =>
    applyReading(newBoard("role_queue", RQ, undefined, player(1, ["damage"], true)), rows, [], meRow, roleOf);

  it("moves the me flag with the actual hero instead of leaving it on a damage slot", () => {
    // my profile slot is damage, but I am playing Mei (support)
    const { board } = reading(0, ["mei", "ashe", "__empty__", "__empty__", "__empty__"]);
    const me = board.allies.find((s) => s.isMe)!;
    expect(me.hero).toBe("mei");
    expect(me.role).toBe("support");
    // Ashe is on a damage slot, not on my slot
    expect(board.allies.find((s) => s.hero === "ashe")?.role).toBe("damage");
    expect(board.allies.filter((s) => s.isMe)).toHaveLength(1);
  });

  it("never lets another row fill my slot while my hero is unknown", () => {
    // my row is mid-animation/dead: the hero is unread. My slot had Mei from the previous capture.
    let b = newBoard("role_queue", RQ, undefined, player(1, ["damage"], true));
    b = updateSlot(b, "allies", "allies-1", { hero: "mei" });
    const { board } = applyReading(b, [null, "ashe", "__empty__", "__empty__", "__empty__"], [], 0, roleOf);
    expect(board.allies.find((s) => s.isMe)?.hero).toBe("mei");
    expect(board.allies.find((s) => s.hero === "ashe")?.isMe).toBe(false);
  });

  it("keeps the me flag when my hero is already in my role slot", () => {
    const b = newBoard("role_queue", RQ, undefined, player(1, ["support"], true));
    const { board } = applyReading(b, ["mei", "ashe", "__empty__", "__empty__", "__empty__"], [], 0, roleOf);
    const me = board.allies.find((s) => s.isMe)!;
    expect(me.role).toBe("support");
    expect(me.hero).toBe("mei");
  });
});
