import { describe, expect, it } from "vitest";
import { rankFromRange } from "./ranks";

describe("rank range", () => {
  it("merges every tier the range spans", () => {
    expect(rankFromRange(["bronze", "silver"])).toBe("bronze+silver");
    expect(rankFromRange(["silver", "silver"])).toBe("silver");
    expect(rankFromRange(["gold", "diamond"])).toBe("gold+platinum+emerald+diamond");
    expect(rankFromRange(["master"])).toBe("master");
    expect(rankFromRange(["grandmaster", "champion"])).toBe("grandmaster");
  });
  it("gives up on unread emblems or none (placement matches)", () => {
    expect(rankFromRange([])).toBeNull();
    expect(rankFromRange(["bronze", null])).toBeNull();
  });
});
