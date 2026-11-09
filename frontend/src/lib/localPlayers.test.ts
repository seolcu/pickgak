import { beforeEach, describe, expect, it } from "vitest";
import { cleanAliases, localPlayers } from "./localPlayers";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  } as Storage;
});

const base = { is_me: false, preferred_roles: [], heroes: [], only_preferred: false };

describe("guest players (this browser only)", () => {
  it("keeps a single 'me', normalizes roles, and edits/removes by id", () => {
    const a = localPlayers.save(undefined, { ...base, name: " 나 ", is_me: true, preferred_roles: ["support", "tank", "damage"] });
    expect(a).toMatchObject({ id: 1, name: "나", preferred_roles: [] });
    const b = localPlayers.save(undefined, { ...base, name: "친구", is_me: true, heroes: ["ana", "ana"] });
    expect(localPlayers.list().map((p) => [p.name, p.is_me])).toEqual([["친구", true], ["나", false]]);
    expect(b.heroes).toEqual(["ana"]);
    localPlayers.save(a.id, { ...base, name: "나2", preferred_roles: ["support", "tank"] });
    expect(localPlayers.list().find((p) => p.id === a.id)?.preferred_roles).toEqual(["tank", "support"]);
    localPlayers.remove(b.id);
    expect(localPlayers.list().map((p) => p.name)).toEqual(["나2"]);
  });
});

describe("alt account nicknames", () => {
  it("trims, drops blanks and duplicates of the name or each other, ignoring case", () => {
    expect(cleanAliases("Main", [" Alt ", "", "main", "ALT", "Smurf"])).toEqual(["Alt", "Smurf"]);
    const p = localPlayers.save(undefined, { ...base, name: "Main", aliases: ["Alt", "alt"] });
    expect(p.aliases).toEqual(["Alt"]);
  });
});
