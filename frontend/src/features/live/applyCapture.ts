import { QUICK, type AppConfig, type QueueId, type Role, type StatFilters } from "../../lib/api";
import { rankFromRange } from "../../lib/ranks";
import { applyBans, applyReading, diffReading, newMatch, updateSlot, type Board } from "../pick/board";
import type { PartyNeed } from "../pick/PartyMatchCard";
import { decideQueue, type AutoQueue } from "./autoQueue";
import type { Capture } from "./LiveBar";
import { elimsTotal, isNewMatch } from "./newMatch";
import { suspectSmurfs } from "./smurf";

/** 마지막으로 판에 반영한 TAB 화면 (바뀐 것만 다시 반영하려고) */
export interface Seen {
  allies: (string | null)[];
  enemies: (string | null)[];
  meRow: number | null;
  bans: string;
  rank: string | null;
  /** 마지막으로 알아본 전장. OCR이 읽는 중인 캡처(null)는 이 값을 지우지 않는다 */
  map: string | null;
  /** 줄마다 처치 합계 (새 판 감지에 쓴다) */
  elims: number | null;
}

/** 이번 판의 빠른 대전/경쟁전 자동 판단. 사용자가 직접 바꾸면 그 판에서는 자동을 멈춘다 */
export interface AutoMode {
  match: number;
  set: string | null;
  locked: boolean;
}

export interface CaptureInput {
  board: Board;
  seen: Seen | null;
  /** 지금 통계 필터의 전장 */
  map: string;
  filters: StatFilters;
  config: AppConfig;
  /** 지금 필터가 금지가 있는 모드인지 */
  bansActive: boolean;
  roleOf: (hero: string) => Role | undefined;
  autoMode: AutoMode;
  autoQueue: AutoQueue;
  /** 판을 다른 대기열 칸 구조로 옮긴다 (영웅·파티원을 최대한 유지) */
  switchQueue: (b: Board, q: QueueId) => Board;
  /** "새 판"을 시작한 시각 (판이 바뀌면 자동 판단을 처음부터 다시 한다) */
  matchStart: number;
  now: number;
  /** 사용자가 직접 끈 양학 의심 줄 (상대 팀 줄 번호) */
  dismissedSmurfs: ReadonlySet<number>;
  /** "나중에"/"아니요"를 고른 파티 줄 */
  dismissedParty: ReadonlySet<string>;
}

export interface CaptureResult {
  /** 다음 판이 시작돼서 판을 비웠다 (호출한 쪽이 새 판 정리를 한다) */
  newMatch: boolean;
  board: Board;
  /** 판 내용이 바뀌었는지 (같으면 저장하지 않아 되돌리기 기록이 쌓이지 않는다) */
  changed: boolean;
  filled: number;
  seen: Seen;
  /** 통계 필터를 이 전장으로 (없으면 그대로) */
  map: string | null;
  /** 통계 필터를 이 값으로 (없으면 그대로) */
  filters: StatFilters | null;
  /** 필터를 바꾼 이유 (알림용) */
  filterNote: "competSet" | "quickSet" | "rankSet" | null;
  autoMode: AutoMode;
  autoQueue: AutoQueue;
  /** TAB 화면을 보고 바꾼 대기열 (알림용) */
  queueSet: QueueId | null;
  matchStart: number;
  partyNeeds: PartyNeed[];
}

/** 파티 줄을 묻지 않기로 한 표시. 이름 후보가 있으면 사람 단위, 없으면 영웅 단위 */
export const partyKey = (n: { hero: string; suggestion: { player: number } | null }) =>
  n.suggestion ? `p${n.suggestion.player}` : `${n.hero}:?`;

/**
 * 이 줄의 이름이 이미 정한 사람과 어긋나는지. 이름을 아직 못 읽었으면(점수판이 뜨는 중, OCR 대기) 어긋난 게
 * 아니다. 제안 후보에 그 사람이 있으면 같은 이름이 조금 다르게 찍힌 것이다
 */
function nameDisagrees(reading: Capture["rows"][number], player: number | null): boolean {
  if (!reading.name) return !!reading.name_tried;
  return reading.name.player !== player && !reading.name.candidates.some((c) => c.player === player);
}

/**
 * TAB 화면 한 장을 판에 반영한다. 화면에서 바뀐 것만 넣는다: TAB을 누르고 있으면 1.5초마다 같은 화면이
 * 다시 오는데, 그때마다 다시 넣으면 손으로 고친 영웅·금지·필터를 덮어쓴다. 상태를 바꾸지 않는 순수 함수.
 */
export function applyCapture(c: Capture, inp: CaptureInput): CaptureResult {
  const { config, roleOf } = inp;
  const prev = inp.seen;
  const allyIdx = c.rows.flatMap((r, i) => (r.team === "ally" ? [i] : []));
  const enemyIdx = c.rows.flatMap((r, i) => (r.team === "enemy" ? [i] : []));
  const allies = allyIdx.map((i) => c.rows[i].label);
  const enemies = enemyIdx.map((i) => c.rows[i].label);
  const meRow = c.me !== null && allyIdx.includes(c.me) ? allyIdx.indexOf(c.me) : null;
  const bansKey = c.bans.join();
  const rank = rankFromRange(c.ranks);
  const elims = elimsTotal(c.stats);

  // 다음 판이 시작됐으면 "새 판"을 누르지 않아도 판을 비운다
  const nextMatch = isNewMatch(prev, { map: c.map, bans: bansKey, rank, elims });
  const matchStart = nextMatch ? inp.now : inp.matchStart;
  const competitive = c.bans.length > 0 || c.ranks.length > 0;

  // 대기열: 마지막 화면 뒤에 대기열이 달라졌다면 사용자가 직접 고른 것이라 이번 판은 그대로 둔다.
  // set은 판이 바뀌어도 남긴다 (지난 판에 자동으로 기타가 됐는지 알아야 역할 고정으로 되돌릴 수 있다)
  const before = inp.autoQueue;
  let autoQueue: AutoQueue = before.match === matchStart ? { ...before } : { ...before, match: matchStart, locked: false };
  if (before.last !== null && inp.board.queue !== before.last) {
    autoQueue = { ...autoQueue, set: null, locked: autoQueue.match === before.match };
  }
  const sameMatch = !nextMatch && prev !== null;
  const queue = autoQueue.locked
    ? null
    : decideQueue(
        {
          allies,
          enemies,
          prevAllies: sameMatch ? prev.allies : null,
          prevEnemies: sameMatch ? prev.enemies : null,
          competitive,
        },
        inp.board.queue,
        config,
        roleOf,
        autoQueue.set === "other" && autoQueue.setIn !== matchStart,
      );
  const queueSet = queue && queue !== inp.board.queue ? queue : null;
  autoQueue = queueSet
    ? { ...autoQueue, set: queueSet, setIn: matchStart, last: queueSet }
    : { ...autoQueue, last: inp.board.queue };
  let base = nextMatch ? newMatch(inp.board) : inp.board;
  if (queueSet) base = inp.switchQueue(base, queueSet);
  // 대기열을 바꿨으면 전 화면에서 자리가 없어 못 넣은 영웅이 있을 수 있다: 화면 전체를 다시 넣는다
  const fresh = nextMatch || queueSet !== null;
  const lastMap = nextMatch ? null : (prev?.map ?? null);
  const seen: Seen = { allies, enemies, meRow, bans: bansKey, rank, map: c.map ?? lastMap, elims };

  // 알아본 전장이 바뀌었을 때만 통계 필터를 따라가게 한다 (손으로 고른 전장은 다음 캡처가 덮지 않는다).
  // 새 판이면 필터를 "모든 전장"으로 되돌리므로 같은 전장이어도 다시 맞춘다
  const map = c.map && (nextMatch || (c.map !== lastMap && c.map !== inp.map)) ? c.map : null;

  const myRowChanged =
    fresh || meRow !== prev?.meRow || (meRow !== null && allies[meRow] !== prev?.allies[meRow]);
  const read = applyReading(
    base,
    diffReading(fresh ? null : (prev?.allies ?? null), allies),
    diffReading(fresh ? null : (prev?.enemies ?? null), enemies),
    myRowChanged ? meRow : null,
    roleOf,
  );

  // 경쟁전에만 금지 줄과 등급 범위가 보인다: 그것으로 빠른 대전/경쟁전을 알아내 통계를 맞춘다.
  // 한 판에서는 처음 한 번만 정하고, 사용자가 직접 바꾼 뒤에는 건드리지 않는다
  let auto = inp.autoMode.match === matchStart ? { ...inp.autoMode } : { match: matchStart, set: null, locked: false };
  // 자동으로 맞춘 값과 달라졌다면 사용자가 직접 고른 것: 이번 판은 그대로 둔다
  if (!auto.locked && auto.set !== null && inp.filters.rq !== auto.set) auto = { ...auto, locked: true };
  const quickMode = config.modes.quick ?? QUICK;
  const compMode = config.modes.competitive ?? "2";
  let filters: StatFilters | null = null;
  let filterNote: CaptureResult["filterNote"] = null;
  if (!auto.locked) {
    const decided = auto.set ?? (competitive ? compMode : quickMode);
    auto = { ...auto, set: decided };
    const want = { ...inp.filters, rq: decided, rank: decided === compMode && rank ? rank : inp.filters.rank };
    const modeChanged = want.rq !== inp.filters.rq;
    if (modeChanged || want.rank !== inp.filters.rank) {
      filters = want;
      filterNote = modeChanged && (decided === quickMode || !rank) ? (decided === compMode ? "competSet" : "quickSet") : "rankSet";
    }
  }

  const bansOn = inp.bansActive || (competitive && config.bans.modes.includes(compMode));
  let board = bansOn && bansKey !== prev?.bans ? applyBans(read.board, c.bans, config.bans) : read.board;

  // 양학 의심 상대는 자동으로 위험 플레이어 표시 (수동으로 끈 줄은 그 판에서 건너뜀)
  const suspects =
    c.stats && allyIdx.length === 5 && enemyIdx.length === 5
      ? suspectSmurfs([...allyIdx, ...enemyIdx].map((i) => c.stats![i]))
      : [];
  for (const s of suspects) {
    const i = s.row - 5;
    const slot = board.enemies[i];
    if (slot && !slot.threat && !(!nextMatch && inp.dismissedSmurfs.has(i))) {
      board = updateSlot(board, "enemies", slot.id, { threat: true });
    }
  }

  // 초록 파티 표시 + 확인된 이름 이미지가 모두 맞을 때만 플레이어를 자동 지정한다. 선호 영웅 같은 추측은
  // 하지 않는다. 처음 보는 이름은 카드/오버레이에서 한 번 확인한다
  const partyFlags = c.debug.party ?? [];
  const partyRows = allyIdx.filter((row) => {
    const hero = c.rows[row].label;
    return partyFlags[row] && c.me !== row && !!hero && !hero.startsWith("__");
  });
  for (const row of partyRows) {
    const reading = c.rows[row];
    const slot = board.allies.find((s) => s.hero === reading.label && !s.isMe);
    if (!slot) continue;
    const manual = slot.playerId !== null && slot.playerAuto !== true;
    if (reading.name?.known && !manual) {
      const player = reading.name.player;
      // 같은 사람이 두 자리에 남아 있으면 다른 자리에서 지운다
      const dup = board.allies.find((s) => s.id !== slot.id && s.playerId === player);
      if (dup) board = updateSlot(board, "allies", dup.id, { playerId: null, playerAuto: false });
      if (slot.playerId !== player || slot.playerAuto !== true) {
        board = updateSlot(board, "allies", slot.id, { playerId: player, playerAuto: true });
      }
    } else if (slot.playerAuto && nameDisagrees(reading, slot.playerId)) {
      // 이름이 다른 사람을 가리킬 때만 자동 지정을 취소한다 (직접 고른 사람은 보존). 한 판에서 파티원은
      // 바뀌지 않는다: 궁극기 표시나 위치 차이로 이번 캡처만 못 알아본 것이면 이미 정한 사람을 그대로 둔다
      board = updateSlot(board, "allies", slot.id, { playerId: null, playerAuto: false });
    }
  }
  const partyNeeds: PartyNeed[] = [];
  for (const row of partyRows) {
    const reading = c.rows[row];
    const hero = reading.label!;
    const slot = board.allies.find((s) => s.hero === hero && !s.isMe);
    // 이미 사람이 정해진 자리는 묻지 않는다 (위에서 이름이 다른 사람이면 지정을 풀었다)
    if (!slot || slot.playerId !== null) continue;
    const suggestion = reading.name && !reading.name.known ? reading.name : null;
    const need: PartyNeed = {
      captureId: c.id,
      row,
      slotId: slot.id,
      hero,
      crop: reading.name_crop,
      suggestion,
      currentPlayer: slot.playerId,
    };
    // 이미 이름으로 자동 지정된 줄은 물을 게 없다
    if (reading.name?.known) continue;
    if (!nextMatch && inp.dismissedParty.has(partyKey(need))) continue;
    partyNeeds.push(need);
  }

  return {
    newMatch: nextMatch,
    board,
    // applyReading은 늘 새 객체를 만든다: 내용으로 비교해야 같은 화면이 되돌리기 기록을 쌓지 않는다
    changed: JSON.stringify(board) !== JSON.stringify(inp.board),
    filled: read.filled,
    seen,
    map,
    filters,
    filterNote,
    autoMode: auto,
    autoQueue,
    queueSet,
    matchStart,
    partyNeeds,
  };
}
