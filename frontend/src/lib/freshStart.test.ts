import { beforeEach, describe, expect, it, vi } from "vitest";
import { BOARD_KEY } from "../features/pick/board";
import { startFresh } from "./freshStart";

const board = {
  queue: "role_queue",
  allies: [{ id: "a1", role: "tank", hero: "dva", playerId: 3, threat: false }],
  enemies: [{ id: "e1", role: "tank", hero: "orisa", playerId: null, threat: true }],
  bans: ["ana"],
  allyWants: [],
  lobbyBan: true,
};

/** 테스트 환경에는 브라우저 저장소가 없어 Map으로 흉내 낸다 */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

describe("startFresh", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("sessionStorage", memoryStorage());
    localStorage.setItem(BOARD_KEY, JSON.stringify(board));
    localStorage.setItem("pickgak.map", JSON.stringify("ilios"));
  });

  it("새로 켜면 영웅·금지·전장을 비우고 사람은 남긴다", () => {
    startFresh();
    const b = JSON.parse(localStorage.getItem(BOARD_KEY)!);
    expect(b.allies[0]).toMatchObject({ hero: null, playerId: 3 });
    expect(b.enemies[0]).toMatchObject({ hero: null, threat: false });
    expect(b.bans).toEqual([]);
    expect(b.lobbyBan).toBe(false);
    expect(JSON.parse(localStorage.getItem("pickgak.map")!)).toBe("all");
  });

  it("같은 세션의 새로고침에서는 그대로 둔다", () => {
    sessionStorage.setItem("pickgak.session", "1");
    startFresh();
    expect(JSON.parse(localStorage.getItem(BOARD_KEY)!).allies[0].hero).toBe("dva");
    expect(JSON.parse(localStorage.getItem("pickgak.map")!)).toBe("ilios");
  });

  it("비울 수 없는 판은 버린다", () => {
    localStorage.setItem(BOARD_KEY, JSON.stringify({ queue: "x" }));
    startFresh();
    expect(localStorage.getItem(BOARD_KEY)).toBeNull();
  });
});
