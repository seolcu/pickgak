import { describe, expect, it } from "vitest";
import { ASK_SNOOZE_MS, isSnoozed, parseSnooze, snooze, unsnooze } from "./askSnooze";

describe("party question snooze", () => {
  it("does not ask the same person again for a while, across matches and restarts", () => {
    const s = snooze({}, "p7", 1000);
    expect(isSnoozed(s, "p7", 1000 + 60 * 60 * 1000)).toBe(true);
    // 저장했다가 다시 읽어도 같다 (앱을 다시 켠 경우)
    expect(isSnoozed(parseSnooze(JSON.parse(JSON.stringify(s))), "p7", 5000)).toBe(true);
    expect(isSnoozed(s, "p8", 5000)).toBe(false);
  });

  it("asks again once the time is up, and drops expired entries", () => {
    const s = snooze({}, "p7", 0);
    expect(isSnoozed(s, "p7", ASK_SNOOZE_MS + 1)).toBe(false);
    expect(Object.keys(snooze(s, "p8", ASK_SNOOZE_MS + 1))).toEqual(["p8"]);
  });

  it("ignores a malformed saved value", () => {
    expect(parseSnooze(null)).toEqual({});
    expect(parseSnooze([1, 2])).toEqual({});
    expect(parseSnooze({ p1: "x", p2: 5 })).toEqual({ p2: 5 });
  });

  it("asks again on the next TAB when the answer could not be saved", () => {
    const s = snooze(snooze({}, "p7", 0), "p8", 0);
    expect(isSnoozed(unsnooze(s, "p7"), "p7", 1)).toBe(false);
    expect(isSnoozed(unsnooze(s, "p7"), "p8", 1)).toBe(true);
  });
});
