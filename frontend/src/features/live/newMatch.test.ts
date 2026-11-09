import { describe, expect, it } from "vitest";
import { elimsTotal, isNewMatch, type Reading } from "./newMatch";

const reading = (over: Partial<Reading> = {}): Reading => ({
  map: "ilios",
  bans: "",
  rank: null,
  elims: 20,
  ...over,
});

const stats = (elims: (number | null)[]) =>
  elims.map((e) => [e, 0, 0, 0, 0, 0] as (number | null)[]);

describe("new match detection", () => {
  it("keeps one match while the totals only grow", () => {
    expect(isNewMatch(reading({ elims: 20 }), reading({ elims: 25 }))).toBe(false);
    expect(isNewMatch(reading({ elims: 20 }), reading({ elims: 20 }))).toBe(false);
  });

  it("sees the reset when the total eliminations drop", () => {
    expect(isNewMatch(reading({ elims: 30 }), reading({ elims: 4 }))).toBe(true);
    // 2줄 차이는 오독으로 본다
    expect(isNewMatch(reading({ elims: 30 }), reading({ elims: 28 }))).toBe(false);
    // 판 초반 숫자는 믿지 않는다
    expect(isNewMatch(reading({ elims: 6 }), reading({ elims: 2 }))).toBe(false);
  });

  it("uses the map, bans and rank range", () => {
    expect(isNewMatch(reading({ map: "ilios" }), reading({ map: "busan" }))).toBe(true);
    expect(isNewMatch(reading({ bans: "sombra,reaper" }), reading({ bans: "genji,ana" }))).toBe(true);
    expect(isNewMatch(reading({ rank: "gold+platinum" }), reading({ rank: "silver+gold" }))).toBe(true);
    // 못 읽은 값은 신호로 쓰지 않는다
    expect(isNewMatch(reading({ map: "ilios" }), reading({ map: null }))).toBe(false);
    expect(isNewMatch(reading({ bans: "sombra" }), reading({ bans: "" }))).toBe(false);
  });

  it("ignores captures whose numbers weren't read", () => {
    expect(isNewMatch(reading({ elims: 30 }), reading({ elims: null }))).toBe(false);
    expect(isNewMatch(null, reading())).toBe(false);
  });

  it("only totals when enough rows were read", () => {
    expect(elimsTotal(null)).toBeNull();
    expect(elimsTotal(stats([1, 2, 3, 4, 5, 6, 7, null]))).toBeNull();
    expect(elimsTotal(stats([1, 2, 3, 4, 5, 6, 7, 8]))).toBe(36);
    expect(elimsTotal(stats([1, null, 3, 4, 5, 6, 7, 8, 9, 10]))).toBe(53);
  });
});
