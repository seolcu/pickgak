import type { Hero, Player, QueueConfig, QueueId, Role } from "../../lib/api";
import { ROLES } from "../../lib/api";

export type Team = "allies" | "enemies";

export interface Slot {
  id: string;
  /** 역할 고정 큐에서는 슬롯 역할, 자유 큐에서는 null */
  role: Role | null;
  hero: string | null;
  /** 아군 슬롯에 지정된 파티원 프로필 */
  playerId: number | null;
  /** 이름으로 자동 지정한 파티원 (사용자가 직접 고른 사람은 false/없음) */
  playerAuto?: boolean;
  isMe: boolean;
  /** 자유 큐(슬롯에 역할이 없음)에서 이 사람이 이번 판에 할 역할. null이면 자동 */
  wantRole?: Role | null;
  /** 상대 칸: 유난히 잘하는 위험 플레이어 (이 영웅을 더 강하게 카운터하고, 약한 픽은 피한다) */
  threat?: boolean;
}

export interface Board {
  queue: QueueId;
  allies: Slot[];
  enemies: Slot[];
  /** 금지(밴)된 영웅. 경쟁전에서만 쓴다 */
  bans: string[];
  /** 파티가 아닌 아군이 하려는 영웅 (밴 추천에서 빼고, 이 영웅의 카운터를 밴 후보로 올린다) */
  allyWants?: string[];
  /** @deprecated 사람별 설정(onlyPreferred)으로 바뀜. 예전 저장값 호환용 */
  preferredOnly: boolean;
  /** 이번 판에 '선호 영웅만' 설정을 프로필 기본값과 다르게 쓴 사람 (키: personKey) */
  onlyPreferred?: Record<string, boolean>;
  /** @deprecated 사람별 autoRole로 바뀜 */
  autoRoles?: boolean;
  /** 역할 고정 큐에서 이번 판 역할을 추천이 정하는 사람 (키: personKey) */
  autoRole?: Record<string, boolean>;
  /** 이번 판에 로비 밴(5번째 금지)이 있었는지 */
  lobbyBan?: boolean;
}

export function slotRoles(q: QueueConfig): (Role | null)[] {
  if (!q.slots) return Array(q.team_size).fill(null);
  return ROLES.flatMap((r) => Array(q.slots![r]).fill(r));
}

function makeTeam(team: Team, q: QueueConfig): Slot[] {
  return slotRoles(q).map((role, i) => ({ id: `${team}-${i}`, role, hero: null, playerId: null, isMe: false }));
}

/** 새 판. "나"는 내 선호 역할의 첫 슬롯, 선호 역할이 없으면 첫 딜러 슬롯(자유 큐는 첫 칸) */
export function newBoard(
  queue: QueueId,
  q: QueueConfig,
  prev?: Pick<Board, "preferredOnly">,
  me?: Player | null,
): Board {
  const allies = makeTeam("allies", q);
  const prefer = me?.preferred_roles.length ? me.preferred_roles : (["damage"] as Role[]);
  const meIdx = Math.max(0, allies.findIndex((s) => s.role !== null && prefer.includes(s.role)));
  allies[meIdx] = { ...allies[meIdx], isMe: true };
  return {
    queue,
    allies,
    enemies: makeTeam("enemies", q),
    bans: [],
    preferredOnly: prev?.preferredOnly ?? false,
  };
}

/**
 * 큐를 바꿀 때 기존 영웅·파티원·"나"를 새 슬롯 구조로 최대한 옮긴다.
 * 영웅이 있으면 그 영웅의 역할 자리, 없으면 그 사람의 선호 역할 자리를 먼저 찾는다.
 */
export function switchQueue(
  board: Board,
  queue: QueueId,
  q: QueueConfig,
  heroes: Map<string, Hero>,
  players: Player[] = [],
): Board {
  const next = newBoard(queue, q, board);
  next.bans = board.bans;
  next.allyWants = board.allyWants;
  next.onlyPreferred = board.onlyPreferred;
  next.lobbyBan = board.lobbyBan;
  next.autoRole = board.autoRole;
  next.allies.forEach((s) => (s.isMe = false));
  const me = players.find((p) => p.is_me);
  const wanted = (s: Slot): Role[] => {
    const heroRole = s.hero ? heroes.get(s.hero)?.role : undefined;
    if (heroRole) return [heroRole];
    if (s.wantRole) return [s.wantRole];
    const person = s.isMe ? me : players.find((p) => p.id === s.playerId);
    if (person?.preferred_roles.length) return person.preferred_roles;
    return s.role ? [s.role] : [];
  };
  const place = (from: Slot[], to: Slot[]) => {
    // "나" → 파티원 → 일반 순서로 배치해서 중요한 정보가 먼저 자리를 잡게 한다
    const order = [...from].sort((a, b) => Number(b.isMe) - Number(a.isMe) || Number(!!b.playerId) - Number(!!a.playerId));
    for (const s of order) {
      if (!s.hero && !s.playerId && !s.isMe) continue;
      const roles = wanted(s);
      const free = to.filter((t) => !t.hero && !t.playerId && !t.isMe);
      const target =
        free.find((t) => t.role === null || roles.includes(t.role)) ??
        // 영웅이 정해진 슬롯은 역할이 맞는 자리에만 (다른 역할 자리에 넣으면 규칙 위반)
        (s.hero ? undefined : free[0]);
      // 역할 고정 → 자유로 갈 때는 원래 슬롯 역할을 '이번 판 역할'로 이어 간다
      if (target)
        Object.assign(target, {
          hero: s.hero,
          playerId: s.playerId,
          isMe: s.isMe,
          wantRole: target.role === null ? (s.wantRole ?? s.role ?? null) : null,
        });
    }
  };
  place(board.allies, next.allies);
  place(board.enemies, next.enemies);
  if (!next.allies.some((s) => s.isMe)) next.allies[0].isMe = true;
  return next;
}

export function updateSlot(board: Board, team: Team, id: string, patch: Partial<Slot>): Board {
  return { ...board, [team]: board[team].map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}

export function toggleAllyWant(board: Board, hero: string): Board {
  const cur = board.allyWants ?? [];
  return { ...board, allyWants: cur.includes(hero) ? cur.filter((h) => h !== hero) : [...cur, hero] };
}

/** 저장된 판이 현재 큐 설정과 맞는지 (설정 파일이 바뀌면 버린다) */
export function isCompatible(board: Board, q: QueueConfig | undefined): boolean {
  if (!q) return false;
  const roles = slotRoles(q);
  return (
    board.allies.length === roles.length &&
    board.enemies.length === roles.length &&
    board.allies.every((s, i) => s.role === roles[i]) &&
    board.allies.filter((s) => s.isMe).length === 1
  );
}

/* ---------- 사람(나·파티원) 배치 ----------
 * 슬롯의 영웅은 자리에 붙어 있고, 사람 표시(나/파티원)만 자리 사이를 옮겨 다닌다.
 * 역할 고정 큐에서는 같은 역할의 슬롯끼리는 차이가 없으므로, 사용자는 '자리'보다 '역할'을 고른다.
 */

export type Person = { kind: "me" } | { kind: "player"; id: number };

export const personKey = (p: Person) => (p.kind === "me" ? "me" : `p${p.id}`);

/** 이 사람에게 선호 영웅만 추천할지: 이번 판 설정 > 프로필 기본값. 선호 영웅이 없으면 항상 false */
export function onlyPreferredFor(b: Board, p: Person, player: Player | null | undefined): boolean {
  if (!player?.heroes.length) return false;
  return b.onlyPreferred?.[personKey(p)] ?? player.only_preferred ?? false;
}

export function setOnlyPreferred(b: Board, p: Person, value: boolean): Board {
  return { ...b, onlyPreferred: { ...b.onlyPreferred, [personKey(p)]: value } };
}

/**
 * 이 영웅이 그 사람의 선호인지. 오버레이 별은 그 줄의 주인만 봐야 한다.
 * 예전에는 파티원 전원의 선호를 합집합으로 만들어, 내가 선호하지 않는 영웅에도 내 별이 붙었다.
 */
export function preferredBy(player: { heroes: string[] } | null | undefined, hero: string | null | undefined): boolean {
  return !!hero && !!player && player.heroes.includes(hero);
}

const holds = (s: Slot, p: Person) => (p.kind === "me" ? s.isMe : s.playerId === p.id);
const occupied = (s: Slot) => s.isMe || s.playerId !== null;
const personIn = (s: Slot): Person | null =>
  s.isMe ? { kind: "me" } : s.playerId !== null ? { kind: "player", id: s.playerId } : null;
const put = (s: Slot, p: Person | null, wantRole: Role | null = null): Slot => ({
  ...s,
  isMe: p?.kind === "me",
  playerId: p?.kind === "player" ? p.id : null,
  playerAuto: false,
  wantRole: s.role === null ? wantRole : null,
});

export const slotOfPerson = (b: Board, p: Person) => b.allies.find((s) => holds(s, p));
export const slotOf = (b: Board, playerId: number) => slotOfPerson(b, { kind: "player", id: playerId });

/** 사람이 없는 자리가 하나라도 있으면 파티원을 더 넣을 수 있다 (랜덤 팀원 자리는 파티원이 대신한다) */
export const canAddMember = (b: Board) => b.allies.some((s) => !occupied(s));

/**
 * p를 target 자리로 옮긴다. target에 다른 사람이 있으면 서로 자리를 바꾼다.
 * p가 아직 파티에 없던 사람이면, 밀려난 사람은 빈 자리로 가고 빈 자리가 없으면 파티에서 빠진다('나'는 빠질 수 없음).
 */
export function movePerson(b: Board, p: Person, targetId: string): Board {
  const from = slotOfPerson(b, p);
  const target = b.allies.find((s) => s.id === targetId);
  if (!target || from?.id === targetId) return b;
  const other = personIn(target);
  let allies = b.allies.map((s) => {
    if (s.id === targetId) return put(s, p, from?.wantRole ?? null);
    if (from && s.id === from.id) return put(s, other, target.wantRole ?? null);
    return s;
  });
  if (other && !from) {
    const free = allies.filter((s) => !occupied(s));
    const spot = free.find((s) => !s.hero) ?? free[0];
    if (spot) allies = allies.map((s) => (s.id === spot.id ? put(s, other, target.wantRole ?? null) : s));
    else if (other.kind === "me") return b;
  }
  return { ...b, allies };
}

/**
 * p가 이번 판에 role을 하도록 한다.
 * - 역할 고정 큐: 그 역할의 자리로 옮긴다. 빈 자리 → 랜덤 팀원 자리(영웅 없는 곳 먼저) → 다른 파티원과 맞바꾸기 순.
 * - 자유 큐: 자리는 그대로 두고 '이번 판 역할'만 바꾼다 (null = 자동).
 */
export function assignRole(b: Board, p: Person, role: Role | null): Board {
  let from = slotOfPerson(b, p);
  const roleQueue = b.allies.some((s) => s.role !== null);
  if (!roleQueue) {
    if (!from) {
      const spot = b.allies.find((s) => !occupied(s) && !s.hero) ?? b.allies.find((s) => !occupied(s));
      if (!spot) return b;
      b = movePerson(b, p, spot.id);
      from = slotOfPerson(b, p)!;
    }
    return updateSlot(b, "allies", from.id, { wantRole: role });
  }
  // 역할 고정 큐의 '자동': 자리는 그대로 두고 추천이 역할을 정한다
  if (!role) return setAutoRole(from ? b : addMember(b, p, null), p, true);
  b = setAutoRole(b, p, false);
  if (from?.role === role) return b;
  const cands = b.allies.filter((s) => s.role === role && s.id !== from?.id);
  const target =
    cands.find((s) => !occupied(s) && !s.hero) ?? cands.find((s) => !occupied(s)) ?? cands.find(occupied);
  return target ? movePerson(b, p, target.id) : b;
}

/** 파티에 넣기. role을 주면 그 역할로, 없으면 선호 역할이 하나뿐일 때 그 역할, 아니면 아무 빈 자리 */
export function addMember(b: Board, p: Person, role: Role | null, preferred: Role[] = []): Board {
  if (slotOfPerson(b, p)) return role ? assignRole(b, p, role) : b;
  const r = role ?? (preferred.length === 1 ? preferred[0] : null);
  if (r) return assignRole(b, p, r);
  const free = b.allies.filter((s) => !occupied(s));
  const spot =
    free.find((s) => !s.hero && s.role !== null && preferred.includes(s.role)) ??
    free.find((s) => !s.hero) ??
    free[0];
  return spot ? movePerson(b, p, spot.id) : b;
}

/** 파티에서 빼기 (그 자리는 랜덤 팀원 자리가 된다. 이미 고른 영웅은 남긴다) */
export function removeMember(b: Board, playerId: number): Board {
  return { ...b, allies: b.allies.map((s) => (s.playerId === playerId ? put(s, null) : s)) };
}

/** 그 사람이 지금 맡은 역할 (역할 고정 큐는 슬롯 역할, 자유 큐는 이번 판 역할) */
export function roleOf(b: Board, p: Person): Role | null {
  const s = slotOfPerson(b, p);
  return s ? (s.role ?? s.wantRole ?? null) : null;
}

/** 더는 없는 영웅·플레이어를 가리키는 슬롯을 비운 판 (저장된 판을 불러올 때) */
export function sanitize(board: Board, heroIds: Set<string> | null, playerIds: Set<number> | null): Board {
  const fix = (s: Slot): Slot => ({
    ...s,
    hero: s.hero && heroIds && !heroIds.has(s.hero) ? null : s.hero,
    playerId: s.playerId !== null && playerIds && !playerIds.has(s.playerId) ? null : s.playerId,
    playerAuto:
      s.playerId === null || (playerIds && !playerIds.has(s.playerId)) ? false : s.playerAuto,
  });
  const bans = (board.bans ?? []).filter((h) => !heroIds || heroIds.has(h));
  const allyWants = (board.allyWants ?? []).filter((h) => !heroIds || heroIds.has(h));
  const changed =
    bans.length !== board.bans?.length ||
    allyWants.length !== (board.allyWants ?? []).length ||
    [...board.allies, ...board.enemies].some((s) => {
      const f = fix(s);
      return f.hero !== s.hero || f.playerId !== s.playerId;
    });
  return changed
    ? { ...board, bans, allyWants, allies: board.allies.map(fix), enemies: board.enemies.map(fix) }
    : board;
}

/** 영웅 상세의 '이 영웅으로 픽 보드'에서: 내 자리에 그 영웅을 넣는다. 역할이 안 맞으면 그 역할의 빈 자리로 '나'를 옮긴다 */
export function pickForMe(board: Board, heroId: string, role: Role): Board {
  let next = board;
  const me = next.allies.find((s) => s.isMe)!;
  if (me.role !== null && me.role !== role) {
    const target = next.allies.find((s) => s.role === role && !s.hero && s.playerId === null);
    if (!target) return board;
    next = movePerson(next, { kind: "me" }, target.id);
  }
  const mine = next.allies.find((s) => s.isMe)!;
  // 같은 팀에 이미 있으면 그 자리는 비운다 (같은 팀 중복 불가)
  next = { ...next, allies: next.allies.map((s) => (s.hero === heroId && !s.isMe ? { ...s, hero: null } : s)) };
  return updateSlot(next, "allies", mine.id, { hero: heroId });
}

/* ---------- 이번 판 역할 '자동' (역할 고정 큐) ---------- */

export const isAutoRole = (b: Board, p: Person) => !!b.autoRole?.[personKey(p)];

function setAutoRole(b: Board, p: Person, v: boolean): Board {
  if (isAutoRole(b, p) === v) return b;
  return { ...b, autoRole: { ...b.autoRole, [personKey(p)]: v } };
}

/** 화면에 보여줄 이번 판 역할: 자동이면 null */
export function chosenRole(b: Board, p: Person): Role | null {
  return isAutoRole(b, p) ? null : roleOf(b, p);
}

/* ---------- 영웅 입력 ----------
 * 영웅을 한 번 누르면 알맞은 칸에 들어간다. 역할 고정 큐에서는 영웅의 역할이 곧 자리를 정한다.
 */

export type Target = Team | "bans";

export type PlaceResult =
  | { board: Board }
  /** 그 역할 자리가 2칸 이상 다 찼다: 바꿀 칸을 골라야 한다 */
  | { ask: Role };

const isRoleQueue = (b: Board) => b.allies.some((s) => s.role !== null);

/**
 * team에 hero를 넣는다.
 * 1. 이미 그 팀에 있으면 뺀다 (토글)
 * 2. focus 칸이 주어지고 역할이 맞으면 그 칸에 넣는다 (교체)
 * 3. 역할 고정 큐: 그 역할의 빈 칸 (아군은 랜덤 팀원 칸을 먼저, '나'·파티원 칸은 나중에)
 *    다 찼으면 1칸뿐인 역할은 바로 교체하고, 2칸 이상이면 ask
 * 4. 자유 큐: 빈 칸 (다 찼으면 ask 없이 그대로 두고 화면에서 비활성)
 */
export function placeHero(b: Board, team: Team, hero: string, role: Role, focus?: string | null): PlaceResult {
  const slots = b[team];
  const there = slots.find((s) => s.hero === hero);
  if (there && !focus) return { board: updateSlot(b, team, there.id, { hero: null }) };
  // 다른 칸에 같은 영웅이 있으면 비운다 (같은 팀 중복 불가)
  const clean = (x: Board) => (there ? updateSlot(x, team, there.id, { hero: null }) : x);
  const f = focus ? slots.find((s) => s.id === focus) : undefined;
  if (f && (f.role === null || f.role === role)) return { board: updateSlot(clean(b), team, f.id, { hero }) };

  const fits = slots.filter((s) => s.role === null || s.role === role);
  if (isRoleQueue(b) && !fits.length) return { board: b };
  const empty = fits
    .filter((s) => !s.hero)
    .sort((x, y) => Number(occupied(x)) - Number(occupied(y)));
  if (empty.length) return { board: updateSlot(clean(b), team, empty[0].id, { hero }) };
  if (!isRoleQueue(b)) return { board: b };
  if (fits.length === 1) return { board: updateSlot(clean(b), team, fits[0].id, { hero }) };
  return { ask: role };
}

/** 금지 토글 */
export function toggleBan(b: Board, hero: string): Board {
  return { ...b, bans: b.bans.includes(hero) ? b.bans.filter((h) => h !== hero) : [...b.bans, hero] };
}

export interface BanRules {
  total: number;
  max_per_role: number;
  /** 같은 역할 한도를 넘어도 되는 금지 수 (로비 밴이 있으면 1) */
  overflow?: number;
}

/** 이번 판 금지 규칙: 로비 밴이 있으면 칸이 늘고, 그만큼 같은 역할 한도를 넘을 수 있다 */
export function banRulesFor(cfg: { total: number; lobby: number; max_per_role: number }, lobbyBan: boolean): BanRules {
  const extra = lobbyBan ? cfg.lobby : 0;
  return { total: cfg.total + extra, max_per_role: cfg.max_per_role, overflow: extra };
}

/** 금지 목록이 역할 한도를 넘은 수의 합 */
function roleOverflow(bans: string[], roleOf: (h: string) => Role | undefined, max: number): number {
  const count = new Map<Role | undefined, number>();
  for (const h of bans) count.set(roleOf(h), (count.get(roleOf(h)) ?? 0) + 1);
  return [...count.values()].reduce((sum, n) => sum + Math.max(0, n - max), 0);
}

/** 이 대상에 이 영웅을 넣을 수 없는 이유 (넣을 수 있으면 null). 이미 들어 있으면 빼기는 항상 가능 */
export function whyDisabled(
  b: Board,
  target: Target,
  hero: string,
  role: Role,
  roleOf: (h: string) => Role | undefined,
  bans: BanRules | null,
): "banned" | "picked" | "bansFull" | "banRoleFull" | "teamFull" | null {
  if (target === "bans") {
    if (!bans || b.bans.includes(hero)) return null;
    if ([...b.allies, ...b.enemies].some((s) => s.hero === hero)) return "picked";
    if (b.bans.length >= bans.total) return "bansFull";
    if (
      b.bans.filter((h) => roleOf(h) === role).length >= bans.max_per_role &&
      roleOverflow(b.bans, roleOf, bans.max_per_role) >= (bans.overflow ?? 0)
    )
      return "banRoleFull";
    return null;
  }
  if (b[target].some((s) => s.hero === hero)) return null;
  if (bans && b.bans.includes(hero)) return "banned";
  if (!isRoleQueue(b) && b[target].every((s) => s.hero)) return "teamFull";
  return null;
}

/** 판을 저장하는 localStorage 키 */
export const BOARD_KEY = "pickgak.board";

/** 다음 판: 영웅·금지·아군이 할 영웅과 이번 판 ★를 비우고 사람·역할은 그대로 */
export function newMatch(b: Board): Board {
  const clear = (s: Slot): Slot => ({ ...s, hero: null, threat: false });
  // ★(선호 영웅만)는 "이번 판" 설정이라 새 판에서는 프로필 기본값으로 돌아간다
  return {
    ...b,
    allies: b.allies.map(clear),
    enemies: b.enemies.map(clear),
    bans: [],
    allyWants: [],
    lobbyBan: false,
    onlyPreferred: undefined,
  };
}

/** 로비 밴 켜기/끄기. 끌 때 넘치는 금지(5번째, 역할 한도 초과)는 뒤에서부터 뺀다 */
export function setLobbyBan(b: Board, on: boolean, cfg: { total: number; lobby: number; max_per_role: number }, roleOf: (h: string) => Role | undefined): Board {
  let bans = b.bans;
  if (!on) {
    bans = bans.slice(0, cfg.total);
    while (roleOverflow(bans, roleOf, cfg.max_per_role) > 0) bans = bans.slice(0, -1);
  }
  return { ...b, lobbyBan: on, bans };
}

/**
 * 같은 팀의 직전 TAB 화면과 비교해 바뀐 줄만 남긴다 (나머지는 null: 판을 건드리지 않음).
 * 줄 수가 달라졌거나 처음이면 전부 새 정보다.
 */
export function diffReading(prev: (string | null)[] | null, cur: (string | null)[]): (string | null)[] {
  if (!prev || prev.length !== cur.length) return cur;
  return cur.map((l, i) => (l === prev[i] ? null : l));
}

/**
 * TAB 화면의 금지 영웅 줄을 판에 넣는다 (경쟁전). 하나라도 못 알아본 아이콘이 있거나 칸 수를 넘으면 그대로 둔다.
 * 기본 칸 수보다 많으면 로비 밴이 걸린 것이다.
 */
export function applyBans(b: Board, bans: (string | null)[], cfg: { total: number; lobby: number }): Board {
  if (bans.length === 0 || bans.length > cfg.total + cfg.lobby || bans.some((h) => !h || h.startsWith("__"))) return b;
  const list = bans as string[];
  const lobbyBan = list.length > cfg.total;
  if (list.join() === b.bans.join() && !!b.lobbyBan === lobbyBan) return b;
  return { ...b, bans: list, lobbyBan };
}

/**
 * 두 칸의 내용(영웅·사람·이번 판 역할)을 맞바꾼다. 역할 고정 큐에서는 같은 역할 칸끼리만.
 * 게임 화면의 왼쪽·오른쪽 순서와 맞추고 싶을 때 쓴다.
 */
export function swapSlots(b: Board, team: Team, idA: string, idB: string): Board {
  const a = b[team].find((s) => s.id === idA);
  const c = b[team].find((s) => s.id === idB);
  if (!a || !c || a.id === c.id || a.role !== c.role) return b;
  const content = ({ hero, playerId, playerAuto, isMe, wantRole, threat }: Slot) => ({
    hero,
    playerId,
    playerAuto,
    isMe,
    wantRole,
    threat,
  });
  return {
    ...b,
    [team]: b[team].map((s) => (s.id === idA ? { ...s, ...content(c) } : s.id === idB ? { ...s, ...content(a) } : s)),
  };
}

/** 밴 단계: 금지 칸이 남았고 아직 아무도 영웅을 고르지 않았다 */
export function inBanPhase(b: Board, bans: BanRules | null): boolean {
  return !!bans && b.bans.length < bans.total && [...b.allies, ...b.enemies].every((s) => !s.hero);
}

/**
 * 추천 결과 적용: 사람 자리(slotId)에 영웅을 넣는다.
 * 그 영웅 역할이 지금 자리와 다르면(역할 '자동'이었던 사람) 그 역할 자리로 먼저 옮긴다.
 */
export function applyPicks(b: Board, picks: { slotId: string; hero: string; role: Role }[]): Board {
  const people = picks.map((p) => {
    const s = b.allies.find((x) => x.id === p.slotId);
    return { ...p, person: s ? personIn(s) : null };
  });
  for (const p of people) {
    if (!p.person) {
      b = updateSlot(b, "allies", p.slotId, { hero: p.hero });
      continue;
    }
    const cur = slotOfPerson(b, p.person);
    if (cur?.role && cur.role !== p.role) {
      const auto = isAutoRole(b, p.person);
      b = assignRole(b, p.person, p.role);
      if (auto) b = setAutoRole(b, p.person, true);
    }
    const mine = slotOfPerson(b, p.person);
    if (!mine) continue;
    b = { ...b, allies: b.allies.map((s) => (s.hero === p.hero && s.id !== mine.id ? { ...s, hero: null } : s)) };
    b = updateSlot(b, "allies", mine.id, { hero: p.hero });
  }
  return b;
}

/** 판 안의 영웅 수 (큐 전환으로 영웅이 빠졌는지 알릴 때) */
export const heroCount = (b: Board) => [...b.allies, ...b.enemies].filter((s) => s.hero).length;

/** 상대 칸의 위험 플레이어 표시 켜기/끄기 */
export function toggleThreat(b: Board, slotId: string): Board {
  return { ...b, enemies: b.enemies.map((s) => (s.id === slotId ? { ...s, threat: !s.threat } : s)) };
}

/** 위험 플레이어로 표시된 상대 영웅 */
export const threatHeroes = (b: Board) => b.enemies.filter((s) => s.threat && s.hero).map((s) => s.hero!);

/**
 * TAB 점수판 인식 결과를 판에 넣는다 (데스크톱 앱).
 * - 영웅은 같은 순서의 칸에 넣되, 칸 역할과 맞지 않으면 같은 역할의 다른 칸으로 보낸다
 *   (훈련장은 역할 고정이 아니고 내 줄이 늘 맨 위라 줄 순서가 역할 순서와 다르다). 들어갈 칸이 없으면 넣지 않는다
 * - 내 영웅(meRow)은 같은 순서의 칸, 그다음 지금 내 칸에 먼저 넣는다. 역할이 달라 칸을 옮기면 예전 칸의 내 영웅은 지운다
 * - 줄이 칸보다 적은 팀(훈련장의 봇 1줄)도 역할에 맞는 칸에 넣는다. 줄이 더 많으면 건너뛴다
 * - 모든 줄이 영웅이거나 빈 자리면 화면이 그 팀의 전부이므로, 화면에 없는 영웅은 판에서 지운다
 *   ("?", 해골, 처음 보는 초상화가 있으면 지우지 않는다)
 */
export function applyReading(
  b: Board,
  allies: (string | null)[],
  enemies: (string | null)[],
  meRow: number | null,
  roleOf: (hero: string) => Role | undefined,
): { board: Board; filled: number } {
  let next = b;
  let filled = 0;
  const heroRole = (l: string | null) => (l && !l.startsWith("__") ? roleOf(l) : undefined);
  for (const [team, rows] of [
    ["allies", allies],
    ["enemies", enemies],
  ] as const) {
    const slots = next[team];
    if (rows.length === 0 || rows.length > slots.length) continue;
    const indexed = rows.length === slots.length;
    const fits = (j: number, role: Role) => slots[j].role === null || slots[j].role === role;
    const target: (number | null)[] = rows.map(() => null);
    const taken = new Set<number>();
    const place = (i: number, first: number[]) => {
      const role = heroRole(rows[i])!;
      const candidates = [
        ...first,
        ...slots.map((s, j) => (fits(j, role) && !s.hero ? j : -1)),
        ...slots.map((_, j) => (fits(j, role) ? j : -1)),
      ];
      const j = candidates.find((c) => c >= 0 && !taken.has(c) && fits(c, role));
      if (j === undefined) return;
      target[i] = j;
      taken.add(j);
    };
    // 내 영웅: 지금 내 칸 우선
    const me = team === "allies" && meRow !== null && meRow >= 0 && meRow < rows.length ? meRow : null;
    const myOld = team === "allies" ? slots.findIndex((s) => s.isMe) : -1;
    // (경기에서는 줄 순서 = 칸 순서라 강조된 줄의 칸이 먼저: 왼쪽·오른쪽 공격 칸 맞추기)
    if (me !== null && heroRole(rows[me])) place(me, [indexed ? me : -1, myOld]);
    // 내 영웅을 아직 못 읽었거나(죽음/처음 보는 초상화) 들어갈 칸을 못 찾았으면, 내 칸을 비워 둔다.
    // 그러지 않으면 다른 줄의 영웅(예: 파티원 애쉬)이 내 칸에 들어와 "내가 애쉬"가 된다.
    if (me !== null && myOld >= 0 && (!heroRole(rows[me]) || target[me] === null)) {
      taken.add(myOld);
    }
    // 나머지: 제 순서 칸에 맞는 줄부터 (다른 줄이 그 칸을 뺏지 않게)
    const ownFits = (i: number) => {
      const role = heroRole(rows[i]);
      return indexed && role !== undefined && fits(i, role);
    };
    const order = rows
      .map((_, i) => i)
      .filter((i) => i !== me && heroRole(rows[i]))
      .sort((x, y) => Number(ownFits(y)) - Number(ownFits(x)));
    for (const i of order) place(i, [slots.findIndex((s) => s.hero === rows[i]), indexed ? i : -1]);

    let heroes = slots.map((s) => s.hero);
    if (me !== null && target[me] !== null && myOld >= 0 && target[me] !== myOld) heroes[myOld] = null;
    if (rows.every((l) => heroRole(l) || l === "__empty__")) heroes = heroes.map((h, j) => (taken.has(j) ? h : null));
    target.forEach((j, i) => {
      if (j !== null) heroes[j] = rows[i];
    });
    // 한 팀에 같은 영웅이 둘이면 인식이 잘못된 것: 그 팀은 건드리지 않는다
    const picked = heroes.filter(Boolean);
    if (new Set(picked).size !== picked.length) continue;
    next = {
      ...next,
      [team]: slots.map((s, j) => {
        if (heroes[j] === s.hero) return s;
        if (heroes[j]) filled++;
        return { ...s, hero: heroes[j] };
      }),
    };
    if (me !== null) {
      // 내 영웅을 알아봤으면 그 칸으로. 모르면 지금 내 칸을 그대로 둔다 (줄 순서가 칸 순서와
      // 다를 수 있어 줄 번호로 옮기면 엉뚱한 칸이 "나"가 된다).
      const mine = target[me] ?? (myOld >= 0 ? myOld : null);
      if (mine !== null && !next.allies[mine].isMe) next = movePerson(next, { kind: "me" }, next.allies[mine].id);
    }
  }
  return { board: next, filled };
}
