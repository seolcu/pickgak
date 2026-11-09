import { ArrowDown, ArrowUp, ArrowUpDown, Ban, MapPinned, TrendingDown, TrendingUp, Trophy } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { QueryState } from "../../components/DataState";
import { FilterBar } from "../../components/FilterBar";
import { HeroAvatar } from "../../components/HeroAvatar";
import { RoleIcon } from "../../components/RoleIcon";
import { Card, ROLE_TEXT, TierBadge } from "../../components/ui/misc";
import { Page, PageHeader } from "../../components/ui/Page";
import { SectionCard } from "../../components/ui/SectionCard";
import { Segmented } from "../../components/ui/Segmented";
import { useHeroes, useMapInsights, useMaps, useMeta, useTrends } from "../../hooks/data";
import { usePrefs } from "../../hooks/prefs";
import { loadLocal, saveLocal } from "../../lib/storage";
import { QUICK, ROLES, type Hero, type Role, type ScoredHero, type Tier } from "../../lib/api";
import { cn } from "../../lib/cn";

const TIERS: Tier[] = ["S", "A", "B", "C", "D"];
const TIER_BG: Record<Tier, string> = {
  S: "bg-tier-s",
  A: "bg-tier-a",
  B: "bg-tier-b",
  C: "bg-tier-c",
  D: "bg-tier-d",
};

type View = "tiers" | "table";

export function MetaPage() {
  const { t, i18n } = useTranslation();
  const { query, map } = usePrefs();
  const { byId } = useHeroes();
  const meta = useMeta(query, map);
  const trends = useTrends(query, map);
  const [view, setViewState] = useState<View>(() => loadLocal("pickgak.metaView", "tiers"));
  const setView = (v: View) => {
    setViewState(v);
    saveLocal("pickgak.metaView", v);
  };
  const deltas = useMemo(
    () => new Map((trends.data?.changes ?? []).map((c) => [c.hero_id, c])),
    [trends.data],
  );

  return (
    <Page>
      <PageHeader title={t("meta.title")} lead={t("meta.subtitle")} actions={<FilterBar />} />

      <QueryState query={meta} skeleton="h-[480px]">
        {(data) => (
          <>
            <Dashboard heroes={data.heroes} byId={byId} />

            <div className="flex flex-wrap items-center justify-between gap-2">
              <Segmented
                label={t("meta.view")}
                value={view}
                onChange={setView}
                options={[
                  { value: "tiers", label: t("meta.viewTiers") },
                  { value: "table", label: t("meta.viewTable") },
                ]}
              />
              <p className="text-xs text-muted">
                {t("common.collectedAt", { date: new Date(data.fetched_at).toLocaleString(i18n.language) })}
              </p>
            </div>

            <div className={cn("transition-opacity", meta.isFetching && "opacity-60")}>
              {view === "tiers" ? (
                <TierTable heroes={data.heroes} byId={byId} />
              ) : (
                <RankTable heroes={data.heroes} byId={byId} deltas={deltas} />
              )}
            </div>
            <p className="text-xs text-muted">{t("meta.legend")}</p>
          </>
        )}
      </QueryState>
    </Page>
  );
}

/* ---------- 대시보드 카드 ---------- */

function Dashboard({ heroes, byId }: { heroes: ScoredHero[]; byId: Map<string, Hero> }) {
  const { t } = useTranslation();
  const { query } = usePrefs();
  const trends = useTrends(query, "all");
  const insights = useMapInsights(query);
  const maps = useMaps(query).data ?? [];
  const mapName = (id: string) => maps.find((m) => m.map_id === id)?.name ?? id;

  const banTop = [...heroes].filter((h) => h.ban_rate).sort((a, b) => (b.ban_rate ?? 0) - (a.ban_rate ?? 0)).slice(0, 5);
  const changes = trends.data?.changes ?? [];
  const risers = [...changes].sort((a, b) => b.win_delta - a.win_delta).filter((c) => c.win_delta > 0).slice(0, 3);
  const fallers = [...changes].sort((a, b) => a.win_delta - b.win_delta).filter((c) => c.win_delta < 0).slice(0, 3);
  // 같은 영웅이 여러 맵에서 1위면 배율이 가장 큰 맵 하나만 (목록이 한 영웅으로 도배되지 않게)
  const seen = new Set<string>();
  const specialists = (insights.data?.maps ?? [])
    .flatMap((m) => m.specialists.slice(0, 2).map((s) => ({ ...s, map_id: m.map_id })))
    .sort((a, b) => b.pick_ratio - a.pick_ratio)
    .filter((s) => !seen.has(s.hero_id) && seen.add(s.hero_id))
    .slice(0, 5);

  return (
    <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
      <DashCard icon={<Trophy className="text-accent" />} title={t("meta.topByRole")}>
        <div className="grid grid-cols-3 gap-2">
          {ROLES.map((r) => (
            <div key={r} className="flex min-w-0 flex-col gap-1">
              <span className={cn("flex items-center gap-1 text-xs font-semibold", ROLE_TEXT[r])}>
                <RoleIcon role={r} className="size-3.5" />
                {t(`roles.${r}`)}
              </span>
              {heroes
                .filter((h) => h.role === r)
                .slice(0, 3)
                .map((h) => (
                  <HeroRow key={h.hero_id} id={h.hero_id} byId={byId} right={<TierBadge tier={h.tier} />} />
                ))}
            </div>
          ))}
        </div>
      </DashCard>

      {query.rq !== QUICK && (
        <DashCard icon={<Ban className="text-bad" />} title={t("meta.banTop")} hint={t("meta.banTopHint")}>
          {banTop.length ? (
            banTop.map((h) => (
              <HeroRow
                key={h.hero_id}
                id={h.hero_id}
                byId={byId}
                right={
                  <span className="text-xs tabular-nums">
                    <span className="font-semibold text-bad">{h.ban_rate}%</span>
                    <span className="text-muted"> · {t("meta.pickShort", { pick: h.pick_rate })}</span>
                  </span>
                }
              />
            ))
          ) : (
            <p className="text-sm text-muted">{t("meta.noBans")}</p>
          )}
        </DashCard>
      )}

      <DashCard icon={<TrendingUp className="text-good" />} title={t("meta.movers")} hint={t("meta.moversHint")}>
        {trends.data?.previous && !risers.length && !fallers.length ? (
          <p className="text-sm text-muted">{t("trends.noMovers")}</p>
        ) : trends.data?.previous ? (
          <>
            {risers.map((c) => (
              <HeroRow key={c.hero_id} id={c.hero_id} byId={byId} right={<Delta v={c.win_delta} suffix="%p" />} />
            ))}
            {fallers.map((c) => (
              <HeroRow key={c.hero_id} id={c.hero_id} byId={byId} right={<Delta v={c.win_delta} suffix="%p" />} />
            ))}
          </>
        ) : (
          <p className="flex items-center gap-1.5 text-sm text-muted">
            <TrendingDown className="size-4 shrink-0" />
            {t("trends.noPreviousHint")}
          </p>
        )}
      </DashCard>

      <DashCard icon={<MapPinned className="text-ally" />} title={t("meta.mapSpecialists")} hint={t("meta.mapSpecialistsHint")}>
        {specialists.map((s) => (
          <HeroRow
            key={s.map_id + s.hero_id}
            id={s.hero_id}
            byId={byId}
            sub={mapName(s.map_id)}
            right={<span className="text-xs font-semibold text-accent tabular-nums">×{s.pick_ratio}</span>}
          />
        ))}
        <Link to="/maps" className="mt-1 text-xs text-muted hover:text-text">
          {t("meta.seeAllMaps")} →
        </Link>
      </DashCard>
    </div>
  );
}

function DashCard({ icon, title, hint, children }: { icon: ReactNode; title: string; hint?: string; children: ReactNode }) {
  return (
    <SectionCard size="sm" icon={icon} title={title} hint={hint}>
      {children}
    </SectionCard>
  );
}

function HeroRow({ id, byId, right, sub }: { id: string; byId: Map<string, Hero>; right?: ReactNode; sub?: string }) {
  const h = byId.get(id);
  return (
    <Link to={`/heroes/${id}`} className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-surface-2">
      <HeroAvatar hero={h} size="xs" />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-sm">{h?.name ?? id}</span>
        {sub && <span className="truncate text-[11px] text-muted">{sub}</span>}
      </span>
      {right}
    </Link>
  );
}

function Delta({ v, suffix = "" }: { v: number; suffix?: string }) {
  if (!v) return <span className="text-xs text-muted">0</span>;
  return (
    <span className={cn("inline-flex items-center text-xs font-semibold tabular-nums", v > 0 ? "text-good" : "text-bad")}>
      {v > 0 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
      {Math.abs(v).toFixed(1)}
      {suffix}
    </span>
  );
}

/* ---------- 티어표 ---------- */

function TierTable({ heroes, byId }: { heroes: ScoredHero[]; byId: Map<string, Hero> }) {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[640px] grid-cols-[44px_repeat(3,minmax(0,1fr))] gap-1.5">
        <div />
        {ROLES.map((r) => (
          <div key={r} className={cn("flex items-center gap-1.5 px-1 py-1 text-sm font-semibold", ROLE_TEXT[r])}>
            <RoleIcon role={r} />
            {t(`roles.${r}`)}
          </div>
        ))}
        {TIERS.map((tier) => (
          <TierRowCells key={tier} tier={tier}>
            {ROLES.map((r) => (
              <div key={r} className="flex min-h-14 flex-wrap content-start gap-1 rounded-lg border border-border bg-surface p-1.5">
                {heroes
                  .filter((h) => h.tier === tier && h.role === r)
                  .map((h) => (
                    <Link
                      key={h.hero_id}
                      to={`/heroes/${h.hero_id}`}
                      className="flex items-center gap-1.5 rounded-md bg-surface-2 py-0.5 pr-2 pl-0.5 hover:ring-1 hover:ring-border"
                      title={t("meta.heroTooltip", {
                        win: h.win_rate,
                        pick: h.pick_rate,
                        adj: h.adj_win_rate,
                        ban: h.ban_rate ?? 0,
                        adjPick: h.adj_pick_rate,
                      })}
                    >
                      <HeroAvatar hero={byId.get(h.hero_id)} size="sm" />
                      <span className="flex flex-col leading-tight">
                        <span className="text-xs font-medium">{byId.get(h.hero_id)?.name ?? h.hero_id}</span>
                        <span className="text-[10px] text-muted tabular-nums">
                          {h.win_rate}% · {h.pick_rate}%
                          {!!h.ban_rate && <span className="text-bad"> · {t("meta.banShort", { ban: h.ban_rate })}</span>}
                        </span>
                      </span>
                    </Link>
                  ))}
              </div>
            ))}
          </TierRowCells>
        ))}
      </div>
    </div>
  );
}

function TierRowCells({ tier, children }: { tier: Tier; children: ReactNode }) {
  return (
    <>
      <div className={cn("flex items-center justify-center rounded-lg text-lg font-extrabold text-white", TIER_BG[tier])}>
        {tier}
      </div>
      {children}
    </>
  );
}

/* ---------- 순위표 ---------- */

type SortKey = "meta_score" | "win_rate" | "adj_pick_rate" | "ban_rate" | "win_delta";

function RankTable({
  heroes,
  byId,
  deltas,
}: {
  heroes: ScoredHero[];
  byId: Map<string, Hero>;
  deltas: Map<string, { win_delta: number }>;
}) {
  const { t } = useTranslation();
  const { query } = usePrefs();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "meta_score", desc: true });
  const [role, setRole] = useState<Role | "all">("all");
  const value = (h: ScoredHero, k: SortKey) => (k === "win_delta" ? (deltas.get(h.hero_id)?.win_delta ?? 0) : (h[k] ?? 0));
  const rows = heroes
    .filter((h) => role === "all" || h.role === role)
    .sort((a, b) => (sort.desc ? value(b, sort.key) - value(a, sort.key) : value(a, sort.key) - value(b, sort.key)));

  const cols: { key: SortKey; label: string; hide?: boolean }[] = [
    { key: "meta_score", label: t("meta.colMeta") },
    { key: "win_rate", label: t("hero.winRate") },
    { key: "adj_pick_rate", label: t("meta.colAdjPick") },
    { key: "ban_rate", label: t("hero.banRate"), hide: query.rq === QUICK },
    { key: "win_delta", label: t("meta.colDelta") },
  ];

  return (
    <div className="flex flex-col gap-2">
      <Segmented
        size="sm"
        label={t("trends.role")}
        value={role}
        onChange={setRole}
        className="self-start"
        options={[{ value: "all", label: t("common.all") }, ...ROLES.map((r) => ({ value: r, label: t(`roles.${r}`) }))]}
      />
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>
              <th className="w-10 px-3 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 text-left font-medium">{t("trends.hero")}</th>
              {cols
                .filter((c) => !c.hide)
                .map((c) => (
                  <th
                    key={c.key}
                    className="px-3 py-2 text-right font-medium"
                    aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : undefined}
                  >
                    <button
                      type="button"
                      onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : true }))}
                      className={cn("inline-flex items-center gap-1 hover:text-text", sort.key === c.key && "text-text")}
                    >
                      {c.label}
                      {sort.key === c.key ? (
                        sort.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />
                      ) : (
                        <ArrowUpDown className="size-3 opacity-40" />
                      )}
                    </button>
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((h, i) => (
              <tr key={h.hero_id} className="border-t border-border tabular-nums hover:bg-surface-2/60">
                <td className="px-3 py-1.5 text-muted">{i + 1}</td>
                <td className="px-3 py-1.5">
                  <Link to={`/heroes/${h.hero_id}`} className="flex items-center gap-2">
                    <HeroAvatar hero={byId.get(h.hero_id)} size="sm" />
                    <span className="font-medium">{byId.get(h.hero_id)?.name ?? h.hero_id}</span>
                    <RoleIcon role={h.role} className={cn("size-3.5", ROLE_TEXT[h.role])} />
                    <TierBadge tier={h.tier} />
                  </Link>
                </td>
                <td className="px-3 py-1.5 text-right">{h.meta_score.toFixed(2)}</td>
                <td className="px-3 py-1.5 text-right">{h.win_rate}%</td>
                <td className="px-3 py-1.5 text-right">
                  {h.adj_pick_rate.toFixed(1)}%
                  {h.adj_pick_rate !== h.pick_rate && <span className="ml-1 text-xs text-muted">({h.pick_rate}%)</span>}
                </td>
                {query.rq !== QUICK && <td className="px-3 py-1.5 text-right">{h.ban_rate ? `${h.ban_rate}%` : "–"}</td>}
                <td className="px-3 py-1.5 text-right">
                  <Delta v={deltas.get(h.hero_id)?.win_delta ?? 0} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
