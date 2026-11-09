import { ROLES, type Player, type PlayerInput } from "./api";
import { loadLocal, saveLocal } from "./storage";

/**
 * 비회원의 플레이어 프로필: 이 브라우저(localStorage)에만 둔다.
 * 서버(회원) 저장과 같은 규칙을 지킨다. '나'는 한 명, 세 역할 모두 = 상관없음(빈 목록).
 */
const KEY = "pickgak.players";

/** 부계정 닉네임: 서버와 같은 규칙. 공백을 빼고, 이름이나 앞의 닉네임과 겹치면 버린다 (대소문자 무시) */
export function cleanAliases(name: string, aliases: string[]): string[] {
  const seen = new Set([name.trim().toLowerCase()]);
  const out: string[] = [];
  for (const raw of aliases) {
    const a = raw.trim().slice(0, 40);
    if (!a || seen.has(a.toLowerCase())) continue;
    seen.add(a.toLowerCase());
    out.push(a);
  }
  return out.slice(0, 10);
}

const normalize = (p: PlayerInput): PlayerInput => ({
  ...p,
  name: p.name.trim().slice(0, 40),
  aliases: cleanAliases(p.name, p.aliases ?? []),
  preferred_roles: ROLES.every((r) => p.preferred_roles.includes(r))
    ? []
    : ROLES.filter((r) => p.preferred_roles.includes(r)),
  heroes: [...new Set(p.heroes)].sort(),
});

const sorted = (list: Player[]) => [...list].sort((a, b) => Number(b.is_me) - Number(a.is_me) || a.id - b.id);

export const localPlayers = {
  list(): Player[] {
    const v = loadLocal<Player[]>(KEY, []);
    return Array.isArray(v) ? sorted(v) : [];
  },
  save(id: number | undefined, data: PlayerInput): Player {
    const list = localPlayers.list();
    const p = normalize(data);
    const nextId = Math.max(0, ...list.map((x) => x.id)) + 1;
    const saved: Player = { ...p, id: id ?? nextId };
    let next = id === undefined ? [...list, saved] : list.map((x) => (x.id === id ? saved : x));
    if (saved.is_me) next = next.map((x) => (x.id === saved.id ? x : { ...x, is_me: false }));
    saveLocal(KEY, next);
    return saved;
  },
  remove(id: number) {
    saveLocal(
      KEY,
      localPlayers.list().filter((x) => x.id !== id),
    );
  },
};
