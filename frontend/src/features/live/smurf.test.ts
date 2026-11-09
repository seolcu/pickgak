import { describe, expect, it } from "vitest";
import { suspectSmurfs } from "./smurf";

// 녹화 14:45의 TAB 수치 (처치, 도움, 죽음, 피해, 치유, 경감)
const LATE = [
  [9, 1, 5, 8614, 907, 6864], [11, 2, 5, 5416, 85, 2043], [7, 1, 6, 8032, 0, 274], [2, 9, 3, 1173, 6373, 586], [8, 9, 6, 2847, 6275, 640],
  [8, 2, 4, 4373, 245, 7332], [8, 1, 3, 6744, 0, 279], [20, 0, 5, 9618, 0, 0], [3, 7, 2, 1892, 6362, 456], [8, 5, 4, 3344, 9540, 294],
];

describe("smurf suspicion", () => {
  it("flags the enemy who stands far above the same-role players", () => {
    const s = suspectSmurfs(LATE);
    expect(s.map((x) => x.row)).toEqual([7]); // 처치 20 · K/D 4.0 (같은 역할 중앙값 처치 8)
    expect(s[0]).toMatchObject({ elims: 20, deaths: 5, kd: 4 });
  });

  it("stays quiet early in the match and with unread cells", () => {
    const early = LATE.map((r) => [Math.min(r[0], 2), r[1], r[2], r[3], r[4], r[5]]);
    expect(suspectSmurfs(early)).toEqual([]);
    const unread = LATE.map((r, i) => (i === 7 ? [null, 0, 5, 9618, 0, 0] : r));
    expect(suspectSmurfs(unread)).toEqual([]);
  });

  it("does not flag a balanced lobby", () => {
    const even = LATE.map((r) => [8, r[1], 5, 6000, r[4] ? 6000 : 0, r[5]]);
    expect(suspectSmurfs(even)).toEqual([]);
  });
});
