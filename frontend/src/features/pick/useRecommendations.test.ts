import { describe, expect, it } from "vitest";
import type { Player, QueueConfig } from "../../lib/api";
import { addMember, newBoard, slotOf, updateSlot } from "./board";
import { buildRequest } from "./useRecommendations";

const RQ: QueueConfig = {
  team_size: 5,
  slots: { tank: 1, damage: 2, support: 2 },
  stats_fallback: false,
  default: true,
};
const player = (id: number, role: Player["preferred_roles"][number], isMe = false): Player => ({
  id,
  name: `p${id}`,
  is_me: isMe,
  preferred_roles: [role],
  heroes: [],
  only_preferred: false,
});

describe("recommendation request", () => {
  it("keeps party members in the party request even after they picked, without locking their hero", () => {
    const me = player(1, "support", true);
    const friend = player(2, "tank");
    let board = newBoard("role_queue", RQ, undefined, me);
    // the friend already picked Winston; a random teammate has Ana
    board = addMember(board, { kind: "player", id: friend.id }, "tank", ["tank"]);
    const friendSlot = slotOf(board, friend.id)!;
    board = updateSlot(board, "allies", friendSlot.id, { hero: "winston" });
    const randomSlot = board.allies.find((s) => !s.isMe && s.playerId === null)!;
    board = updateSlot(board, "allies", randomSlot.id, { hero: "ana" });

    const { members, base, currentAllies } = buildRequest(
      board,
      [me, friend],
      me,
      { region: "korea", rq: "2", rank: "all" },
      "all",
      false,
    );
    // the friend is still a party member (a combo may suggest another hero), not a fixed ally
    expect(members.map((m) => m.slot.id)).toContain(friendSlot.id);
    expect(members).toHaveLength(2);
    expect(base.allies).toEqual(["ana"]);
    // the personal recommendation sees the board as it is now
    expect([...currentAllies].sort()).toEqual(["ana", "winston"]);
  });
});
