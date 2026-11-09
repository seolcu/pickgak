/**
 * TAB 수치로 '양학' 의심 상대 찾기. 같은 판의 같은 역할 선수(양 팀)와 비교한다 (경기 시간이 필요 없다).
 * 지표: 처치, K/D, 피해량 (지원은 피해 대신 치유). 의심되면 위험 플레이어로 자동 표시한다.
 */

/** 줄마다 [처치, 도움, 죽음, 피해, 치유, 경감]. 0~4 우리 팀, 5~9 상대 팀. 못 읽은 칸은 null */
export type StatRows = (number | null)[][];

const ROLE_OF_ROW = ["tank", "damage", "damage", "support", "support"] as const;
const MIN_LOBBY_ELIMS = 20;

export interface Suspect {
  row: number;
  score: number;
  elims: number;
  deaths: number;
  kd: number;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function suspectSmurfs(stats: StatRows): Suspect[] {
  if (stats.length !== 10) return [];
  const elimsTotal = stats.reduce((s, r) => s + (r[0] ?? 0), 0);
  if (elimsTotal < MIN_LOBBY_ELIMS) return []; // 아직 판단하기 이르다
  const metric = (row: number) => {
    const r = stats[row];
    if (r.slice(0, 5).some((v) => v === null)) return null;
    const role = ROLE_OF_ROW[row % 5];
    const out = role === "support" ? r[4]! : r[3]!;
    return { elims: r[0]!, deaths: r[2]!, kd: r[0]! / Math.max(r[2]!, 1), output: out, role };
  };
  const all = stats.map((_, i) => metric(i));
  const out: Suspect[] = [];
  for (let row = 5; row < 10; row++) {
    const me = all[row];
    if (!me) continue;
    const peers = all.filter((p, i) => p && i !== row && p.role === me.role) as NonNullable<(typeof all)[number]>[];
    if (!peers.length) continue;
    const ratio = (v: number, xs: number[]) => Math.min(v / Math.max(median(xs), 1), 4);
    const rElims = ratio(me.elims, peers.map((p) => p.elims));
    const rOutput = ratio(me.output, peers.map((p) => p.output));
    const rKd = ratio(me.kd, peers.map((p) => p.kd));
    const score = (rElims + rOutput + rKd) / 3;
    // 잘하는 정도를 넘어 판을 지배하는 경우만: 양학은 거의 죽지 않는다 (K/D 2.5 이상)
    if (score >= 1.8 && Math.max(rElims, rOutput) >= 1.6 && me.kd >= 2.5)
      out.push({ row, score: Math.round(score * 100) / 100, elims: me.elims, deaths: me.deaths, kd: Math.round(me.kd * 10) / 10 });
  }
  return out.sort((a, b) => b.score - a.score);
}
