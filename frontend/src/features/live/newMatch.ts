/** TAB 화면 한 장에서 판을 비교할 때 쓰는 요약 */
export interface Reading {
  /** 알아본 전장 (못 알아봤으면 null) */
  map: string | null;
  /** 금지 영웅 줄 (쉼표로 이은 값, 없으면 "") */
  bans: string;
  /** 경기 등급 범위 (placements·빠른 대전이면 null) */
  rank: string | null;
  /** 줄마다 처치의 합. 충분히 읽히지 않았으면 null */
  elims: number | null;
}

/**
 * 줄마다 [처치, 도움, 죽음, 피해, 치유, 경감] 중 믿을 만한 처치 합계.
 * 읽힌 줄이 8개 미만이면(화면이 덜 그려졌거나 가려짐) 비교하지 않는다.
 */
export function elimsTotal(stats: (number | null)[][] | null): number | null {
  if (!stats) return null;
  const known = stats.map((r) => r[0]).filter((v): v is number => v !== null);
  return known.length >= 8 ? known.reduce((a, b) => a + b, 0) : null;
}

/**
 * 이번 TAB 화면이 새 판인지.
 * 판 안에서는 누적 처치가 줄지 않으므로 총 처치가 줄면 가장 확실하다. 맵·금지·등급 범위는 판마다
 * 바뀌므로 그것도 신호로 쓴다 (한쪽이 못 읽혔으면 그 신호는 건너뛴다).
 */
export function isNewMatch(prev: Reading | null, cur: Reading): boolean {
  if (!prev) return false;
  if (prev.map && cur.map && prev.map !== cur.map) return true;
  if (prev.bans && cur.bans && prev.bans !== cur.bans) return true;
  if (prev.rank && cur.rank && prev.rank !== cur.rank) return true;
  // 8 미만에서 시작한 판은 오차가 커서 보지 않는다. 2줄 정도 줄어든 것은 오독으로 본다
  if (prev.elims !== null && cur.elims !== null && prev.elims >= 8 && cur.elims + 2 < prev.elims) return true;
  return false;
}
