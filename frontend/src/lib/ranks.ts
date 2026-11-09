import type { TFunction } from "i18next";

/** 통계가 있는 등급, 낮은 것부터 (넥슨 통계에는 챔피언이 따로 없다) */
export const TIERS = ["bronze", "silver", "gold", "platinum", "emerald", "diamond", "master", "grandmaster"];

/**
 * 경쟁전 TAB 화면의 경기 등급 범위(엠블럼 1~2개)를 통계 등급 값으로. 범위에 걸친 등급을 모두 합친다
 * ("bronze+silver", 골드~다이아면 그 사이 등급까지). 챔피언은 그랜드마스터 통계를 쓴다. 못 읽은 엠블럼이 있으면 null.
 */
export function rankFromRange(tiers: (string | null)[]): string | null {
  if (tiers.length === 0) return null;
  const idx = tiers.map((t) => TIERS.indexOf(t === "champion" ? "grandmaster" : (t ?? "")));
  if (idx.some((i) => i < 0)) return null;
  const [lo, hi] = [Math.min(...idx), Math.max(...idx)];
  return TIERS.slice(lo, hi + 1).join("+");
}

/** 등급 값의 이름: 합친 등급은 "브론즈~실버" */
export function rankLabel(rank: string, t: TFunction): string {
  const parts = rank.split("+");
  return parts.length > 1 ? `${t(`ranks.${parts[0]}`)}~${t(`ranks.${parts[parts.length - 1]}`)}` : t(`ranks.${rank}`);
}
