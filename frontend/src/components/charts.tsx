/**
 * 가벼운 SVG 차트. 색은 디자인 토큰(CSS 변수)만 써서 라이트·다크 테마를 따른다.
 */
import { cn } from "../lib/cn";

type Num = number | null | undefined;

const finite = (v: Num): v is number => typeof v === "number" && Number.isFinite(v);

function scale(values: number[], pad = 0.08) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return { lo: min - span * pad, hi: max + span * pad };
}

/** 작은 추이선. 값이 2개 미만이면 그리지 않는다 */
export function Sparkline({ values, className }: { values: Num[]; className?: string }) {
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => finite(p[1]));
  if (pts.length < 2) return <span className={cn("inline-block h-5 w-16", className)} aria-hidden />;
  const { lo, hi } = scale(pts.map((p) => p[1]));
  const n = values.length - 1 || 1;
  const d = pts.map(([i, v], k) => `${k ? "L" : "M"}${(i / n) * 64},${20 - ((v - lo) / (hi - lo)) * 20}`).join(" ");
  const up = pts[pts.length - 1][1] >= pts[0][1];
  return (
    <svg viewBox="0 0 64 20" className={cn("h-5 w-16 overflow-visible", className)} aria-hidden>
      <path d={d} fill="none" stroke={up ? "var(--good)" : "var(--bad)"} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export interface Series {
  label: string;
  color: string; // CSS 색 (토큰 var(--...) 권장)
  values: Num[];
}

/** 여러 계열 추이선 (계열마다 자체 축 범위). x는 등간격 라벨 */
export function LineChart({ series, labels, height = 160 }: { series: Series[]; labels: string[]; height?: number }) {
  const W = 600;
  const H = height;
  const P = { l: 8, r: 8, t: 12, b: 22 };
  const n = Math.max(labels.length - 1, 1);
  const x = (i: number) => P.l + (i / n) * (W - P.l - P.r);
  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={series.map((s) => s.label).join(", ")}>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={P.l} x2={W - P.r} y1={P.t + f * (H - P.t - P.b)} y2={P.t + f * (H - P.t - P.b)} stroke="var(--border)" strokeDasharray="3 4" />
        ))}
        {series.map((s) => {
          const vals = s.values.filter(finite);
          if (!vals.length) return null;
          const { lo, hi } = scale(vals, 0.2);
          const y = (v: number) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
          const pts = s.values.map((v, i) => (finite(v) ? ([x(i), y(v), v] as const) : null)).filter(Boolean) as [number, number, number][];
          return (
            <g key={s.label}>
              <path d={pts.map(([px, py], k) => `${k ? "L" : "M"}${px},${py}`).join(" ")} fill="none" stroke={s.color} strokeWidth="2.2" strokeLinejoin="round" />
              {pts.map(([px, py, v], k) => (
                <circle key={k} cx={px} cy={py} r="3" fill={s.color}>
                  <title>{`${s.label} ${v}%`}</title>
                </circle>
              ))}
            </g>
          );
        })}
        {labels.map((l, i) =>
          labels.length <= 8 || i % Math.ceil(labels.length / 8) === 0 || i === labels.length - 1 ? (
            <text
              key={i}
              x={x(i)}
              y={H - 6}
              textAnchor={i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"}
              fontSize="11"
              fill="var(--muted)"
            >
              {l}
            </text>
          ) : null,
        )}
      </svg>
      <figcaption className="flex flex-wrap gap-3 text-xs text-muted">
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/** 가로 막대 한 줄 (0~max 기준). 기준선(baseline)을 주면 그 위치에 세로선 */
export function Bar({
  value,
  max,
  min = 0,
  baseline,
  tone = "accent",
}: {
  value: number;
  max: number;
  /** 막대가 시작하는 값. 승률처럼 40~60% 사이에 몰린 값은 40부터 그려야 차이가 보인다 */
  min?: number;
  baseline?: number;
  tone?: "accent" | "good" | "bad" | "ally";
}) {
  const color = { accent: "bg-accent", good: "bg-good", bad: "bg-bad", ally: "bg-ally" }[tone];
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - min) / (max - min || 1)) * 100));
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface-2">
      <div className={cn("h-full rounded-full", color)} style={{ width: `${pct(value)}%` }} />
      {baseline !== undefined && <div className="absolute inset-y-0 w-0.5 bg-text/50" style={{ left: `${pct(baseline)}%` }} />}
    </div>
  );
}
