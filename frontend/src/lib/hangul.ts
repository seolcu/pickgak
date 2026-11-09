import { getChoseong } from "es-hangul";

const CHOSEONG_ONLY = /^[ㄱ-ㅎ]+$/;

/** 영웅 검색: 이름 부분 일치, 한글 초성(예: "ㄹㅇ" → 라인하르트), 영문 id 모두 지원. */
export function matchesQuery(query: string, ...targets: string[]): boolean {
  const q = query.trim().toLowerCase().replace(/\s+/g, "");
  if (!q) return true;
  return targets.some((t) => {
    const s = t.toLowerCase().replace(/[\s:.-]/g, "");
    if (s.includes(q.replace(/[:.-]/g, ""))) return true;
    return CHOSEONG_ONLY.test(q) && getChoseong(t.replace(/\s/g, "")).includes(q);
  });
}
