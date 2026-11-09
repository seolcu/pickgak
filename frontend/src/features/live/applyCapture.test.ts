import { describe, expect, it } from "vitest";
import type { AppConfig, QueueConfig, Role } from "../../lib/api";
import { newBoard, switchQueue, type Board } from "../pick/board";
import { applyCapture, type CaptureInput } from "./applyCapture";
import { NO_AUTO_QUEUE } from "./autoQueue";
import type { Capture } from "./LiveBar";

const RQ: QueueConfig = { team_size: 5, slots: { tank: 1, damage: 2, support: 2 }, stats_fallback: false, default: true };
const OQ: QueueConfig = { team_size: 6, slots: null, stats_fallback: true, default: false };
const OTHER: QueueConfig = { team_size: 5, slots: null, stats_fallback: true, default: false };
const CONFIG = {
  queues: { role_queue: RQ, open_queue: OQ, other: OTHER },
  modes: { quick: "0", competitive: "2" },
  bans: { modes: ["2"], per_team: 2, lobby: 1, total: 4, max_per_role: 2, votes: [], high_ban_rate: 0 },
} as unknown as AppConfig;
const ROLES: Record<string, Role> = {
  reinhardt: "tank",
  dva: "tank",
  ashe: "damage",
  mei: "damage",
  genji: "damage",
  tracer: "damage",
  ana: "support",
  kiriko: "support",
  lucio: "support",
  mercy: "support",
  hanzo: "damage",
  sojourn: "damage",
  winston: "tank",
  moira: "support",
};

const ALLY = ["reinhardt", "ashe", "mei", "ana", "kiriko"];
const ENEMY = ["dva", "genji", "tracer", "lucio", "mercy"];

function capture(over: Partial<Capture> = {}, rows?: Partial<Capture["rows"][number]>[]): Capture {
  const base = [...ALLY, ...ENEMY].map((label, i) => ({
    team: (i < 5 ? "ally" : "enemy") as "ally" | "enemy",
    label,
    score: 1,
    crop: "",
    name: null,
    name_crop: null,
  }));
  return {
    id: 1,
    at: 0,
    scoreboard: true,
    map: null,
    bans: [],
    ranks: [],
    rows: base.map((r, i) => ({ ...r, ...(rows?.[i] ?? {}) })),
    me: 2,
    sane: true,
    stats: null,
    grab_ms: 0,
    thumb: "",
    debug: { window: "", process_ms: 0, ocr_ms: 0, saved: true, table: null, row_h: 0, portraits: [], party: [], bans: [], ranks: [], map_text: null },
    width: 2560,
    height: 1440,
    ...over,
  };
}

function input(board: Board, over: Partial<CaptureInput> = {}): CaptureInput {
  return {
    board,
    seen: null,
    map: "all",
    filters: { region: "korea", rq: "0", rank: "all" },
    config: CONFIG,
    bansActive: false,
    roleOf: (h) => ROLES[h],
    autoMode: { match: 0, set: null, locked: false },
    autoQueue: NO_AUTO_QUEUE,
    switchQueue: (b, q) => switchQueue(b, q, CONFIG.queues[q], new Map(), []),
    matchStart: 0,
    now: 1000,
    dismissedSmurfs: new Set(),
    dismissedParty: new Set(),
    ...over,
  };
}

const empty = () => newBoard("role_queue", RQ, undefined, null);

describe("applyCapture", () => {
  it("fills the board from the first reading", () => {
    const r = applyCapture(capture(), input(empty()));
    expect(r.board.enemies.map((s) => s.hero)).toEqual(ENEMY);
    expect(r.filled).toBeGreaterThan(0);
    expect(r.newMatch).toBe(false);
  });

  it("does not undo a manual edit when the same screen comes again", () => {
    const first = applyCapture(capture(), input(empty()));
    const edited = { ...first.board, enemies: first.board.enemies.map((s, i) => (i === 1 ? { ...s, hero: "tracer" } : s)) };
    const again = applyCapture(capture(), input(edited, { seen: first.seen }));
    expect(again.board.enemies[1].hero).toBe("tracer");
    expect(again.changed).toBe(false);
  });

  it("follows a newly read map once, and leaves a map the user picked afterwards alone", () => {
    const first = applyCapture(capture({ map: "colosseo" }), input(empty()));
    expect(first.map).toBe("colosseo");
    // the user switched the stats filter to another map: the same reading must not switch it back
    const again = applyCapture(capture({ map: "colosseo" }), input(first.board, { seen: first.seen, map: "samoa" }));
    expect(again.map).toBeNull();
  });

  it("keeps the last known map while OCR is still reading, so a map change still means a new match", () => {
    const first = applyCapture(capture({ map: "route-66" }), input(empty()));
    // same match, OCR pending on a repeat capture: the known map is kept
    const pending = applyCapture(capture({ map: null }), input(first.board, { seen: first.seen, map: "route-66" }));
    expect(pending.seen.map).toBe("route-66");
    expect(pending.newMatch).toBe(false);
    // OCR then reads another map: that is the next match
    const next = applyCapture(capture({ map: "colosseo" }), input(pending.board, { seen: pending.seen, map: "route-66" }));
    expect(next.newMatch).toBe(true);
    expect(next.map).toBe("colosseo");
  });

  it("sets the map again after a new match even when it equals the old filter", () => {
    const stats = (n: number) => Array.from({ length: 10 }, () => [n, 0, 0, 0, 0, 0]);
    const first = applyCapture(capture({ map: "samoa", stats: stats(3) }), input(empty()));
    const next = applyCapture(capture({ map: "samoa", stats: stats(0) }), input(first.board, { seen: first.seen, map: "samoa" }));
    expect(next.newMatch).toBe(true);
    expect(next.map).toBe("samoa");
  });

  it("switches to competitive from the ban strip once per match, and stops after a manual change", () => {
    const comp = capture({ bans: ["ana", "genji", "mei", "dva"] });
    const first = applyCapture(comp, input(empty()));
    expect(first.filters?.rq).toBe("2");
    expect(first.filterNote).toBe("competSet");
    // the user goes back to quick play in the same match
    const again = applyCapture(comp, input(first.board, { seen: first.seen, autoMode: first.autoMode, filters: { region: "korea", rq: "0", rank: "all" } }));
    expect(again.filters).toBeNull();
    expect(again.autoMode.locked).toBe(true);
  });

  it("assigns a party member only from a confirmed name on a green row", () => {
    const known = { player: 7, name: "파티원", score: 0.97, known: true, candidates: [] };
    const party = [false, true, false, false, false];
    const c = capture({ debug: { ...capture().debug, party } }, [{}, { name: known }]);
    const r = applyCapture(c, input(empty()));
    const ashe = r.board.allies.find((s) => s.hero === "ashe");
    expect(ashe?.playerId).toBe(7);
    expect(ashe?.playerAuto).toBe(true);
    // a known row is not a question
    expect(r.partyNeeds).toEqual([]);

    // the same name without the green marker is not a party member
    const notParty = applyCapture(capture({}, [{}, { name: known }]), input(empty()));
    expect(notParty.board.allies.find((s) => s.hero === "ashe")?.playerId).toBeNull();
  });

  it("asks about a green row with a suggestion unless it was dismissed this match", () => {
    const guess = { player: 7, name: "파티원", score: 0.7, known: false, candidates: [] };
    const party = [false, true, false, false, false];
    const c = capture({ debug: { ...capture().debug, party } }, [{}, { name: guess }]);
    const r = applyCapture(c, input(empty()));
    expect(r.partyNeeds.map((n) => n.suggestion?.player)).toEqual([7]);
    expect(r.board.allies.find((s) => s.hero === "ashe")?.playerId).toBeNull();
    const dismissed = applyCapture(c, input(empty(), { dismissedParty: new Set(["p7"]) }));
    expect(dismissed.partyNeeds).toEqual([]);
  });
  it("keeps a party member for the match when a later capture does not recognize the name", () => {
    const known = { player: 7, name: "파티원", score: 0.97, known: true, candidates: [] };
    const party = [false, true, false, false, false];
    const debug = { ...capture().debug, party };
    const first = applyCapture(capture({ debug }, [{}, { name: known }]), input(empty()));
    const next = (rows: Partial<Capture["rows"][number]>[]) =>
      applyCapture(capture({ id: 2, debug }, rows), input(first.board, { seen: first.seen }));
    const ashe = (b: Board) => b.allies.find((s) => s.hero === "ashe");

    // the name is not read on this frame (the scoreboard is fading in)
    const unread = next([{}, { name: null }]);
    expect(ashe(unread.board)?.playerId).toBe(7);
    expect(unread.partyNeeds).toEqual([]);

    // the same name, drawn a little differently, is only a suggestion for the same player
    const same = { player: 7, name: "파티원", score: 0.86, known: false, candidates: [{ player: 7, name: "파티원", score: 0.86 }] };
    const close = next([{}, { name: same }]);
    expect(ashe(close.board)?.playerId).toBe(7);
    expect(close.partyNeeds).toEqual([]);

    // a name that points at someone else frees the row and asks again
    const other = { player: 9, name: "MIDNIGHTSUN", score: 0.7, known: false, candidates: [{ player: 9, name: "MIDNIGHTSUN", score: 0.7 }] };
    const wrong = next([{}, { name: other }]);
    expect(ashe(wrong.board)?.playerId).toBeNull();
    expect(wrong.partyNeeds.map((n) => n.suggestion?.player)).toEqual([9]);

    // compared with every registered name and nothing came close
    const nobody = next([{}, { name: null, name_tried: true }]);
    expect(ashe(nobody.board)?.playerId).toBeNull();
  });
});

/** 팀별 줄로 TAB 화면을 만든다 (훈련장 5+1줄, 자유 6+6줄 등) */
function board(ally: string[], enemy: string[], over: Partial<Capture> = {}): Capture {
  const rows = [...ally.map((label) => ({ team: "ally" as const, label })), ...enemy.map((label) => ({ team: "enemy" as const, label }))];
  return capture({
    ...over,
    rows: rows.map((r) => ({ ...r, score: 1, crop: "", name: null, name_crop: null })),
    me: 0,
  });
}

describe("auto queue", () => {
  it("picks other in the practice range (5 ally rows, 1 bot row)", () => {
    // 실제 훈련장 캡처(2026-11-02): 한조, 트레이서, 시에라 + 기다리는 줄 둘, 상대는 트레이서 봇
    const range = board(["hanzo", "tracer", "sojourn", "__empty__", "__empty__"], ["tracer"]);
    const r = applyCapture(range, input(empty()));
    expect(r.queueSet).toBe("other");
    expect(r.board.queue).toBe("other");
    expect(r.board.allies.map((s) => s.hero).filter(Boolean)).toEqual(["hanzo", "tracer", "sojourn"]);
  });

  it("picks other when three damage heroes stay on a 5v5 board for two screens", () => {
    const ai = board(ALLY, ["dva", "genji", "tracer", "mei", "mercy"]);
    const first = applyCapture(ai, input(empty()));
    expect(first.queueSet).toBeNull(); // 한 장으로는 바꾸지 않는다
    const second = applyCapture(ai, input(first.board, { seen: first.seen, autoQueue: first.autoQueue }));
    expect(second.queueSet).toBe("other");
    expect(second.board.enemies.map((s) => s.hero).sort()).toEqual(["dva", "genji", "mei", "mercy", "tracer"]);
  });

  it("does not switch on one misread portrait", () => {
    const first = applyCapture(capture(), input(empty()));
    const misread = board(ALLY, ["dva", "genji", "tracer", "mei", "mercy"]);
    const r = applyCapture(misread, input(first.board, { seen: first.seen, autoQueue: first.autoQueue }));
    expect(r.queueSet).toBeNull(); // mei는 직전 화면에서 lucio였다
  });

  it("keeps the queue the user picked for this match", () => {
    const ai = board(ALLY, ["dva", "genji", "tracer", "mei", "mercy"]);
    const first = applyCapture(ai, input(empty()));
    const second = applyCapture(ai, input(first.board, { seen: first.seen, autoQueue: first.autoQueue }));
    const back = switchQueue(second.board, "role_queue", RQ, new Map(), []);
    const third = applyCapture(ai, input(back, { seen: second.seen, autoQueue: second.autoQueue }));
    expect(third.queueSet).toBeNull();
    expect(third.board.queue).toBe("role_queue");
  });

  it("picks open queue on a 6v6 board and role queue again on 5v5", () => {
    const six = board([...ALLY, "lucio"], [...ENEMY, "winston"]);
    const r = applyCapture(six, input(empty()));
    expect(r.queueSet).toBe("open_queue");
    const five = applyCapture(capture({ bans: ["ana"] }), input(r.board, { autoQueue: r.autoQueue }));
    expect(five.queueSet).toBe("role_queue");
  });

  it("goes back to role queue after an automatic other, only on a fully read legal board", () => {
    const range = applyCapture(board(["hanzo", "tracer", "sojourn", "__empty__", "__empty__"], ["tracer"]), input(empty()));
    const partial = board(["reinhardt", "__dead__", "mei", "ana", "kiriko"], ENEMY);
    // 같은 판에서는 1-2-2에 맞아도 그대로 둔다
    const same = applyCapture(capture(), input(range.board, { autoQueue: range.autoQueue }));
    expect(same.queueSet).toBeNull();
    // 다음 판: 일부만 읽힌 화면으로는 되돌리지 않는다
    const p = applyCapture(partial, input(same.board, { autoQueue: same.autoQueue, matchStart: 5000 }));
    expect(p.queueSet).toBeNull();
    const full = applyCapture(capture(), input(p.board, { autoQueue: p.autoQueue, matchStart: 5000 }));
    expect(full.queueSet).toBe("role_queue");
  });

  it("leaves an other picked by hand alone on a legal board", () => {
    const mine = switchQueue(empty(), "other", OTHER, new Map(), []);
    const r = applyCapture(capture(), input(mine));
    expect(r.queueSet).toBeNull();
    expect(r.board.queue).toBe("other");
  });
});
