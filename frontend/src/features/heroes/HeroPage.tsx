import { ArrowDown, ArrowUp, Crosshair, Gem, Link2, ShieldAlert, Swords } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { Bar, LineChart } from "../../components/charts";
import { isNoData, NoDataState } from "../../components/DataState";
import { FilterBar } from "../../components/FilterBar";
import { HeroAvatar } from "../../components/HeroAvatar";
import { RankEmblem } from "../../components/RankPicker";
import { RoleIcon } from "../../components/RoleIcon";
import { Button } from "../../components/ui/Button";
import { Card, EmptyState, ROLE_TEXT, Skeleton, TierBadge } from "../../components/ui/misc";
import { Page } from "../../components/ui/Page";
import { SectionCard } from "../../components/ui/SectionCard";
import { useHeroDetail, useHeroes, useMaps } from "../../hooks/data";
import { usePrefs } from "../../hooks/prefs";
import { ROLES, type Hero } from "../../lib/api";
import { cn } from "../../lib/cn";

const fmtDelta = (v: number) => (v > 0 ? `+${v}` : `${v}`);

export function HeroPage() {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { query } = usePrefs();
  const { byId } = useHeroes();
  const maps = useMaps(query).data ?? [];
  const mapName = (mid: string) => maps.find((m) => m.map_id === mid)?.name ?? mid;
  const detail = useHeroDetail(id, query);
  const hero = byId.get(id);
  const d = detail.data;

  if (isNoData(detail.error)) return <NoDataState />;
  if (detail.error) return <EmptyState title={t("errors.unknown")} />;
  if (!d) return <Skeleton className="h-[480px]" />;
  const s = d.summary;
  // 승률 막대는 40%~(최고치)로 그려서 맵 간 차이가 보이게 한다
  const winMax = Math.max(60, ...d.maps.map((m) => m.win_rate), ...d.modes.map((m) => m.win_rate ?? 0));
  const winMin = Math.min(40, ...d.maps.map((m) => m.win_rate - 2));

  return (
    <Page className={cn("transition-opacity", detail.isFetching && "opacity-70")}>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <HeroAvatar hero={hero} size="lg" className="size-16 sm:size-20" />
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="flex items-center gap-2 text-xl font-bold">
              {hero?.name ?? id}
              <TierBadge tier={s.tier} className="size-6 text-sm" />
            </h1>
            <p className={cn("flex items-center gap-1.5 text-sm whitespace-nowrap", ROLE_TEXT[s.role])}>
              <RoleIcon role={s.role} />
              {t(`roles.${s.role}`)}
              {hero?.subrole && <span className="text-muted">· {t(`subroles.${hero.subrole}`, { defaultValue: hero.subrole })}</span>}
            </p>
          </div>
          <Button variant="primary" className="w-full justify-center sm:ml-2 sm:w-auto" onClick={() => navigate(`/?pick=${id}`)}>
            <Crosshair className="size-4" />
            {t("hero.pickThis")}
          </Button>
        </div>
        <FilterBar showMap={false} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("hero.winRate")} value={`${s.win_rate}%`} delta={s.delta?.win} />
        <Stat label={t("hero.pickRate")} value={`${s.pick_rate}%`} delta={s.delta?.pick} sub={t("hero.adjPick", { v: s.adj_pick_rate })} />
        <Stat label={t("hero.banRate")} value={s.ban_rate ? `${s.ban_rate}%` : "–"} />
        <Stat label={t("hero.metaScore")} value={s.meta_score.toFixed(2)} sub={t("hero.inRole")} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="flex flex-col gap-4">
          <SectionCard title={t("hero.matchups")} hint={t("hero.matchupsHint")}>
            <HeroList icon={<Swords />} label={t("hero.strongVs")} ids={d.matchups.strong_vs} byId={byId} tone="good" />
            <HeroList icon={<ShieldAlert />} label={t("hero.weakVs")} ids={d.matchups.weak_vs} byId={byId} tone="bad" />
            <HeroList icon={<Link2 />} label={t("hero.synergy")} ids={d.matchups.synergy} byId={byId} tone="ally" />
          </SectionCard>

          <SectionCard title={t("hero.byMode")}>
            {d.modes.map((m) => (
              <div key={m.mode} className="grid grid-cols-[88px_1fr_52px] items-center gap-2 text-sm">
                <span>{t(`mapModes.${m.mode}`, { defaultValue: m.mode })}</span>
                <Bar value={m.win_rate ?? 0} min={winMin} max={winMax} baseline={s.win_rate} tone={(m.win_rate ?? 0) >= s.win_rate ? "good" : "bad"} />
                <span className="text-right tabular-nums">{m.win_rate ?? "–"}%</span>
              </div>
            ))}
            {d.map_spread.sigma !== null && (
              <p className="text-xs text-muted">
                {t("hero.mapSpread", { sigma: d.map_spread.sigma, min: d.map_spread.min, max: d.map_spread.max })}
                {" · "}
                {d.map_spread.sigma < 1.5 ? t("hero.mapStable") : t("hero.mapDependent")}
              </p>
            )}
          </SectionCard>

          {d.hidden_strong.length > 0 && (
            <SectionCard title={t("hero.hiddenStrong")} hint={t("hero.hiddenStrongHint")} icon={<Gem className="size-4 text-accent" />}>
              {d.hidden_strong.map((m) => (
                <p key={m.map_id} className="flex justify-between text-sm">
                  <span className="font-medium">{mapName(m.map_id)}</span>
                  <span className="text-good tabular-nums">
                    {m.win_rate}% ({fmtDelta(m.win_diff)}%p) · ×{m.pick_ratio}
                  </span>
                </p>
              ))}
            </SectionCard>
          )}
        </div>

        <SectionCard title={t("hero.byMap")} hint={t("hero.byMapHint")}>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1 text-left font-medium">{t("hero.map")}</th>
                <th className="w-2/5 py-1 text-left font-medium">{t("hero.winRate")}</th>
                <th className="py-1 text-right font-medium">{t("hero.pickRatio")}</th>
              </tr>
            </thead>
            <tbody>
              {d.maps.map((m) => (
                <tr key={m.map_id} className="border-t border-border">
                  <td className="py-1.5 pr-2">{mapName(m.map_id)}</td>
                  <td className="py-1.5">
                    <div className="flex items-center gap-2">
                      <Bar value={m.win_rate} min={winMin} max={winMax} baseline={s.win_rate} tone={m.win_diff >= 0 ? "good" : "bad"} />
                      <span className="w-11 text-right tabular-nums">{m.win_rate}%</span>
                    </div>
                  </td>
                  <td className={cn("py-1.5 text-right tabular-nums", (m.pick_ratio ?? 1) >= 1.3 ? "font-semibold text-accent" : "text-muted")}>
                    ×{m.pick_ratio ?? "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>

        <div className="flex flex-col gap-4">
          <SectionCard title={t("hero.history")}>
            {d.history.length >= 2 ? (
              <LineChart
                labels={d.history.map((h) =>
                  new Date(h.at).toLocaleDateString(i18n.language, { month: "numeric", day: "numeric" }),
                )}
                series={[
                  { label: t("hero.winRate"), color: "var(--good)", values: d.history.map((h) => h.win_rate) },
                  { label: t("hero.pickRate"), color: "var(--ally)", values: d.history.map((h) => h.pick_rate) },
                  ...(d.history.some((h) => h.ban_rate)
                    ? [{ label: t("hero.banRate"), color: "var(--bad)", values: d.history.map((h) => h.ban_rate) }]
                    : []),
                ]}
              />
            ) : (
              <p className="text-sm text-muted">{t("hero.historyEmpty")}</p>
            )}
          </SectionCard>

          <SectionCard title={t("hero.byRank")}>
            {d.ranks.length ? (
              <table className="w-full text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="py-1 text-left font-medium">{t("filters.rank")}</th>
                    <th className="py-1 text-right font-medium">{t("hero.winRate")}</th>
                    <th className="py-1 text-right font-medium">{t("hero.pickRate")}</th>
                    <th className="py-1 text-right font-medium">{t("hero.banRate")}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.ranks.map((r) => (
                    <tr key={r.rank} className="border-t border-border tabular-nums">
                      <td className="py-1.5">
                        <span className="flex items-center gap-1.5">
                          <RankEmblem rank={r.rank} className="size-5" />
                          {t(`ranks.${r.rank}`)}
                        </span>
                      </td>
                      <td className="py-1.5 text-right">{r.win_rate ?? "–"}%</td>
                      <td className="py-1.5 text-right">{r.pick_rate ?? "–"}%</td>
                      <td className="py-1.5 text-right">{r.ban_rate ? `${r.ban_rate}%` : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-muted">{query.rq === "0" ? t("hero.ranksQuick") : t("hero.ranksPending")}</p>
            )}
          </SectionCard>
        </div>
      </div>
    </Page>
  );
}

function Stat({ label, value, delta, sub }: { label: string; value: string; delta?: number; sub?: string }) {
  return (
    <Card className="flex flex-col gap-1 p-3">
      <span className="text-xs text-muted">{label}</span>
      <span className="flex items-baseline gap-2 text-2xl font-bold tabular-nums">
        {value}
        {delta !== undefined && delta !== 0 && (
          <span className={cn("inline-flex items-center text-xs font-semibold", delta > 0 ? "text-good" : "text-bad")}>
            {delta > 0 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
            {Math.abs(delta)}
          </span>
        )}
      </span>
      {sub && <span className="text-xs text-muted">{sub}</span>}
    </Card>
  );
}

function HeroList({
  icon,
  label,
  ids,
  byId,
  tone,
}: {
  icon: ReactNode;
  label: string;
  ids: string[];
  byId: Map<string, Hero>;
  tone: "good" | "bad" | "ally";
}) {
  const { t } = useTranslation();
  const color = { good: "text-good", bad: "text-bad", ally: "text-ally" }[tone];
  return (
    <div className="flex flex-col gap-1.5">
      <span className={cn("flex items-center gap-1 text-xs font-semibold [&_svg]:size-3.5", color)}>
        {icon}
        {label}
      </span>
      {ids.length ? (
        // 역할별로 나눈다. 한 줄로 섞으면 영웅이 많은 공격이 앞을 차지해 돌격·지원 상성이 뒤로 밀린다
        ROLES.map((role) => {
          const inRole = ids.filter((h) => byId.get(h)?.role === role);
          if (!inRole.length) return null;
          return (
            <div key={role} className="flex items-start gap-1.5">
              <RoleIcon role={role} className={cn("mt-1", ROLE_TEXT[role])} />
              <div className="flex flex-wrap gap-1">
                {inRole.map((h) => (
                  <Link
                    key={h}
                    to={`/heroes/${h}`}
                    className="flex items-center gap-1 rounded-md bg-surface-2 py-0.5 pr-2 pl-0.5 text-xs hover:ring-1 hover:ring-border"
                  >
                    <HeroAvatar hero={byId.get(h)} size="xs" />
                    {byId.get(h)?.name ?? h}
                  </Link>
                ))}
              </div>
            </div>
          );
        })
      ) : (
        <span className="text-xs text-muted">{t("hero.noneYet")}</span>
      )}
    </div>
  );
}
