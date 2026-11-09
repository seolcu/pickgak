import type { AppConfig, QueueId, Role } from "../../lib/api";

/** 이번 판의 대기열 자동 판단. 사용자가 직접 바꾸면 그 판에서는 자동을 멈춘다 */
export interface AutoQueue {
  match: number;
  /** 자동으로 맞춘 대기열 (판이 바뀌어도 남는다. 사용자가 바꾸면 비운다) */
  set: QueueId | null;
  /** set을 정한 판 */
  setIn: number;
  /** 이번 판에 사용자가 직접 대기열을 바꿨다 */
  locked: boolean;
  /** 마지막 TAB 화면을 반영한 뒤의 대기열 (그 사이에 달라졌으면 사용자가 바꾼 것) */
  last: QueueId | null;
}

export const NO_AUTO_QUEUE: AutoQueue = { match: 0, set: null, setIn: 0, locked: false, last: null };

export interface QueueEvidence {
  /** TAB 화면의 팀별 줄 (판독한 영웅 id 또는 "__unknown__" 같은 상태) */
  allies: (string | null)[];
  enemies: (string | null)[];
  /** 직전 TAB 화면의 같은 판독 (같은 판일 때만) */
  prevAllies: (string | null)[] | null;
  prevEnemies: (string | null)[] | null;
  /** 금지 줄이나 등급 범위가 보였다 (경쟁전) */
  competitive: boolean;
}

const hero = (l: string | null) => (l && !l.startsWith("__") ? l : null);

/**
 * 역할 고정 규칙(1-2-2)을 어긴 팀이 있는지. 두 화면 연속으로 같은 줄에 같은 영웅이 보인 것만 센다:
 * 초상화 하나를 잘못 읽은 화면 한 장으로 대기열이 바뀌지 않게 한다
 */
function breaksRoleQueue(
  rows: (string | null)[],
  prev: (string | null)[] | null,
  slots: Record<Role, number>,
  roleOf: (h: string) => Role | undefined,
): boolean {
  if (!prev || prev.length !== rows.length) return false;
  const count: Partial<Record<Role, number>> = {};
  rows.forEach((l, i) => {
    const h = hero(l);
    const role = h && prev[i] === h ? roleOf(h) : undefined;
    if (role) count[role] = (count[role] ?? 0) + 1;
  });
  return (Object.keys(count) as Role[]).some((r) => count[r]! > slots[r]);
}

/** 열 줄이 모두 영웅으로 읽혔고 두 팀 다 역할 고정 자리에 맞는지 */
function fitsRoleQueue(rows: (string | null)[], slots: Record<Role, number>, roleOf: (h: string) => Role | undefined) {
  const count: Partial<Record<Role, number>> = {};
  for (const l of rows) {
    const role = hero(l) ? roleOf(l!) : undefined;
    if (!role) return false;
    count[role] = (count[role] ?? 0) + 1;
  }
  return (Object.keys(count) as Role[]).every((r) => count[r]! <= slots[r]);
}

/**
 * TAB 화면에 확실한 근거가 있을 때만 대기열을 고른다 (없으면 null: 그대로 둔다).
 * - 한 팀이 6줄: 자유 6대6
 * - 아군 5줄에 상대 1줄(봇)이거나 빈 줄이 보임: 훈련장이라 기타
 * - 5대5에서 한 역할이 역할 고정 자리 수를 넘음(공격 셋 등): 인공지능전, 사용자 지정 게임이라 기타
 * - 5대5 경쟁전, 또는 자유 6대6이던 판이 5대5가 됨: 역할 고정
 * - 지난 판에 자동으로 기타가 됐는데 새 판 두 팀이 모두 읽혔고 1-2-2에 맞음: 역할 고정으로 되돌린다
 *   (일부만 읽힌 화면으로 되돌리면 인공지능전에서 기타와 역할 고정을 오갈 수 있다)
 */
export function decideQueue(
  e: QueueEvidence,
  current: QueueId,
  config: AppConfig,
  roleOf: (h: string) => Role | undefined,
  autoOtherBefore: boolean,
): QueueId | null {
  const has = (q: string): q is QueueId => q in config.queues;
  const size = (q: QueueId) => config.queues[q].team_size;
  const a = e.allies.length;
  const n = e.enemies.length;
  const roleSlots = has("role_queue") ? config.queues.role_queue.slots : null;
  if (!roleSlots) return null;

  if (has("open_queue") && (a === size("open_queue") || n === size("open_queue"))) return "open_queue";
  if (a !== size("role_queue")) return null;

  const range = n === 1 || e.allies.includes("__empty__");
  const broken =
    breaksRoleQueue(e.allies, e.prevAllies, roleSlots, roleOf) ||
    (n === a && breaksRoleQueue(e.enemies, e.prevEnemies, roleSlots, roleOf));
  if (has("other") && (range || broken)) return "other";
  if (n !== a) return null;
  if (e.competitive || current === "open_queue") return "role_queue";
  const legal = fitsRoleQueue(e.allies, roleSlots, roleOf) && fitsRoleQueue(e.enemies, roleSlots, roleOf);
  if (current === "other" && autoOtherBefore && legal) return "role_queue";
  return null;
}
