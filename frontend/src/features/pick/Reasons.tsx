import { Ban, Flame, HeartCrack, Layers, Scale, Star, Swords, ShieldAlert, Link2, MapPin, TrendingUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Hero, Reason } from "../../lib/api";
import { cn } from "../../lib/cn";

const fmtDiff = (v: number) => (v > 0 ? `+${v}` : `${v}`);

// 간결 모드(게임 위 오버레이)에서 영웅마다 보여 줄 칩 수와 우선순위
const COMPACT_MAX = 3;
const COMPACT_ORDER = [
  "threat_counter",
  "threat_weak",
  "counter",
  "countered",
  "low_heal",
  "double_main_dps",
  "double_sub_dps",
  "double_main_heal",
  "weak_pair",
  "ban_risk",
  "comp_counter",
  "comp_fit",
  "synergy",
  "map",
];
// 적·아군 영웅 이름을 하나로 합쳐 보여 줄 종류
const GROUPED: Record<string, { key: string; tone: string; icon: React.ReactNode }> = {
  threat_counter: { key: "reasons.short.threatCounter", tone: "good", icon: <Flame /> },
  threat_weak: { key: "reasons.short.threatWeak", tone: "bad", icon: <Flame /> },
  counter: { key: "reasons.short.counter", tone: "good", icon: <Swords /> },
  countered: { key: "reasons.short.countered", tone: "bad", icon: <ShieldAlert /> },
  synergy: { key: "reasons.short.synergy", tone: "good", icon: <Link2 /> },
};

/**
 * 오버레이용 간결한 칩: 배지·별로 이미 보이는 것(티어, 선호 영웅)은 빼고, 같은 종류는 영웅 이름을 합쳐 한 칩으로,
 * 전장은 차이가 클 때만, 중요한 것부터 COMPACT_MAX개까지
 */
function CompactReasonChips({ reasons, heroes }: { reasons: Reason[]; heroes: Map<string, Hero> }) {
  const { t } = useTranslation();
  const name = (id: string) => heroes.get(id)?.name ?? id;
  const groups = new Map<string, Reason[]>();
  for (const r of reasons) {
    if (r.kind === "meta" || r.kind === "preferred") continue;
    if (r.kind === "map" && Math.abs(r.win_diff) < 1) continue;
    groups.set(r.kind, [...(groups.get(r.kind) ?? []), r]);
  }
  const kinds = COMPACT_ORDER.filter((k) => groups.has(k)).slice(0, COMPACT_MAX);
  return (
    <ul className="flex flex-wrap gap-0.5">
      {kinds.map((kind) => {
        const list = groups.get(kind)!;
        const first = list[0];
        const g = GROUPED[kind];
        let chip: { icon: React.ReactNode; text: string; tone?: string };
        if (g) {
          const ids = list.map((r) => ("enemy" in r ? r.enemy : "ally" in r ? r.ally : ""));
          chip = { icon: g.icon, tone: g.tone, text: t(g.key, { heroes: ids.map(name).join("·") }) };
        } else if (first.kind === "map") {
          chip = {
            icon: <MapPin />,
            tone: first.win_diff > 0 ? "good" : "bad",
            text: t("reasons.short.map", { diff: fmtDiff(first.win_diff) }),
          };
        } else {
          return <ReasonChips key={kind} reasons={[first]} heroes={heroes} small />;
        }
        return (
          <li key={kind} className={chipClass(chip.tone, true)}>
            {chip.icon}
            {chip.text}
          </li>
        );
      })}
    </ul>
  );
}

const chipClass = (tone: string | undefined, small?: boolean) =>
  cn(
    "inline-flex items-center gap-1 rounded-md [&_svg]:size-3",
    small ? "px-1 py-px text-[10px]" : "px-1.5 py-0.5 text-xs",
    tone === "good" && "bg-good/12 text-good",
    tone === "bad" && "bg-bad/12 text-bad",
    tone === "accent" && "bg-accent-soft text-accent",
    !tone && "bg-surface-2 text-muted",
  );

/** 추천 이유 코드를 언어별 짧은 칩으로 보여준다. compact면 오버레이용으로 줄인다 */
export function ReasonChips({
  reasons,
  heroes,
  mapName,
  compact,
  small,
}: {
  reasons: Reason[];
  heroes: Map<string, Hero>;
  mapName?: string;
  compact?: boolean;
  /** 간결 모드 안에서 칩 하나만 그릴 때 (목록 없이) */
  small?: boolean;
}) {
  const { t } = useTranslation();
  if (compact) return <CompactReasonChips reasons={reasons} heroes={heroes} />;
  const name = (id: string) => heroes.get(id)?.name ?? id;
  const items = (
    <>
      {reasons.map((r, i) => {
        let icon, text, tone;
        switch (r.kind) {
          case "map":
            icon = <MapPin />;
            text = t("reasons.map", { map: mapName, win: r.win_rate, diff: fmtDiff(r.win_diff) });
            tone = r.win_diff >= 1 ? "good" : r.win_diff <= -1 ? "bad" : undefined;
            break;
          case "meta":
            icon = <TrendingUp />;
            text = t("reasons.meta", { tier: r.tier, win: r.win_rate, pick: r.pick_rate });
            break;
          case "counter":
            icon = <Swords />;
            // 상성 강도 1.0 이상(평점 약 10) = 크게 유리
            text = t((r.strength ?? 0) >= 1 ? "reasons.counterStrong" : "reasons.counter", { hero: name(r.enemy) });
            tone = "good";
            break;
          case "countered":
            icon = <ShieldAlert />;
            text = t((r.strength ?? 0) >= 1 ? "reasons.counteredStrong" : "reasons.countered", { hero: name(r.enemy) });
            tone = "bad";
            break;
          case "synergy":
            icon = <Link2 />;
            text = t("reasons.synergy", { hero: name(r.ally) });
            tone = "good";
            break;
          case "preferred":
            icon = <Star />;
            text = t("reasons.preferred");
            tone = "accent";
            break;
          case "threat_counter":
            icon = <Flame />;
            text = t("reasons.threatCounter", { hero: name(r.enemy) });
            tone = "good";
            break;
          case "threat_weak":
            icon = <Flame />;
            text = t("reasons.threatWeak", { hero: name(r.enemy) });
            tone = "bad";
            break;
          case "comp_fit":
            icon = <Layers />;
            text = t("reasons.compFit", { comp: t(`comps.${r.comp}`) });
            tone = "good";
            break;
          case "comp_counter":
            icon = <Layers />;
            text = t("reasons.compCounter", { comp: t(`comps.${r.comp}`) });
            tone = "good";
            break;
          case "low_heal":
            icon = <HeartCrack />;
            text = t("reasons.lowHeal");
            tone = "bad";
            break;
          case "double_main_dps":
          case "double_sub_dps":
          case "double_main_heal":
          case "weak_pair":
            icon = <Scale />;
            text = t(`reasons.${r.kind}`);
            tone = "bad";
            break;
          case "ban_risk":
            icon = <Ban />;
            text = t("reasons.banRisk", { rate: r.ban_rate });
            tone = "bad";
            break;
        }
        return (
          <li key={i} className={chipClass(tone, small)}>
            {icon}
            {text}
          </li>
        );
      })}
    </>
  );
  return small ? items : <ul className="flex flex-wrap gap-1">{items}</ul>;
}

const PART_COLORS: Record<string, string> = {
  map_meta: "bg-ally",
  overall_meta: "bg-ally/50",
  counter: "bg-good",
  synergy: "bg-support",
  preferred: "bg-accent",
};

/** 점수 구성 막대: 양수 항목만 쌓고, 음수 합은 왼쪽 빨간 막대로 */
export function ScoreBar({ parts }: { parts: Record<string, number> }) {
  const { t } = useTranslation();
  const entries = Object.entries(parts);
  const pos = entries.filter(([, v]) => v > 0);
  const neg = entries.filter(([, v]) => v < 0).reduce((s, [, v]) => s - v, 0);
  const total = pos.reduce((s, [, v]) => s + v, 0) + neg || 1;
  const title = entries.map(([k, v]) => `${t(`parts.${k}`)} ${v > 0 ? "+" : ""}${v.toFixed(2)}`).join("\n");
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-2" title={title} aria-label={title}>
      {neg > 0 && <span className="bg-bad" style={{ width: `${(neg / total) * 100}%` }} />}
      {pos.map(([k, v]) => (
        <span key={k} className={PART_COLORS[k] ?? "bg-muted"} style={{ width: `${(v / total) * 100}%` }} />
      ))}
    </div>
  );
}
