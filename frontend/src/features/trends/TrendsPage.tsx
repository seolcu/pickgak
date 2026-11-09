import { ArrowDown, ArrowUp, History, TrendingDown, TrendingUp } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Sparkline } from "../../components/charts";
import { QueryState } from "../../components/DataState";
import { FilterBar } from "../../components/FilterBar";
import { HeroAvatar } from "../../components/HeroAvatar";
import { RoleIcon } from "../../components/RoleIcon";
import { Card, EmptyState, ROLE_TEXT } from "../../components/ui/misc";
import { Page, PageHeader } from "../../components/ui/Page";
import { SectionCard } from "../../components/ui/SectionCard";
import { Segmented } from "../../components/ui/Segmented";
import { useHeroes, useTrends } from "../../hooks/data";
import { usePrefs } from "../../hooks/prefs";
import { ROLES, type Hero, type Role, type TrendRow, type TrendSince } from "../../lib/api";
import { cn } from "../../lib/cn";

type SortKey = "win" | "pick";

export function TrendsPage() {
  const { t, i18n } = useTranslation();
  const { query, map } = usePrefs();
  const { byId } = useHeroes();
  const [since, setSince] = useState<TrendSince>("prev");
  const trends = useTrends(query, map, since);
  const [sort, setSort] = useState<SortKey>("win");
  const [role, setRole] = useState<Role | "all">("all");
  const fmtDate = (s: string) => new Date(s).toLocaleString(i18n.language);
  const changes = trends.data?.changes ?? [];

  const rows = changes
    .filter((r) => role === "all" || r.role === role)
    .sort((a, b) =>
      sort === "win" ? Math.abs(b.win_delta) - Math.abs(a.win_delta) : Math.abs(b.pick_delta) - Math.abs(a.pick_delta),
    );
  const risers = [...changes].filter((c) => c.win_delta > 0).sort((a, b) => b.win_delta - a.win_delta).slice(0, 5);
  const fallers = [...changes].filter((c) => c.win_delta < 0).sort((a, b) => a.win_delta - b.win_delta).slice(0, 5);

  return (
    <Page>
      <PageHeader title={t("trends.title")} lead={t("trends.subtitle")} actions={<FilterBar />} />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">{t("trends.compareTo")}</span>
        <Segmented
          size="sm"
          label={t("trends.compareTo")}
          value={since}
          onChange={setSince}
          options={[
            { value: "prev", label: t("trends.sincePrev") },
            { value: "7d", label: t("trends.since7d") },
            { value: "30d", label: t("trends.since30d") },
          ]}
        />
        {trends.data?.previous && (
          <span className="text-xs text-muted">
            {fmtDate(trends.data.previous)} → {fmtDate(trends.data.current)}
          </span>
        )}
      </div>

      <QueryState
        query={trends}
        empty={
          trends.data && !trends.data.previous ? (
            <EmptyState icon={<History />} title={t("trends.noPrevious")} description={t("trends.noPreviousHint")} />
          ) : undefined
        }
      >
        {(data) => (
          <>
          <div className="grid gap-3 md:grid-cols-2">
            <MoverCard icon={<TrendingUp className="text-good" />} title={t("trends.risers")} rows={risers} byId={byId} />
            <MoverCard icon={<TrendingDown className="text-bad" />} title={t("trends.fallers")} rows={fallers} byId={byId} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segmented
              size="sm"
              label={t("trends.role")}
              value={role}
              onChange={setRole}
              options={[{ value: "all", label: t("common.all") }, ...ROLES.map((r) => ({ value: r, label: t(`roles.${r}`) }))]}
            />
            <Segmented
              size="sm"
              label={t("trends.sortBy")}
              value={sort}
              onChange={setSort}
              options={[
                { value: "win", label: t("trends.byWin") },
                { value: "pick", label: t("trends.byPick") },
              ]}
            />
          </div>
          <Card className={cn("overflow-x-auto transition-opacity", trends.isFetching && "opacity-60")}>
            <table className="w-full text-sm sm:min-w-[560px]">
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">{t("trends.hero")}</th>
                  <th className="hidden px-3 py-2 text-left font-medium sm:table-cell">{t("trends.history")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("trends.winRate")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("trends.pickRate")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.hero_id} className="border-t border-border hover:bg-surface-2/60">
                    <td className="px-3 py-2">
                      <Link to={`/heroes/${r.hero_id}`} className="flex min-w-0 items-center gap-2">
                        <HeroAvatar hero={byId.get(r.hero_id)} size="sm" />
                        <span className="font-medium">{byId.get(r.hero_id)?.name ?? r.hero_id}</span>
                        <RoleIcon role={r.role} className={cn("size-3.5", ROLE_TEXT[r.role])} />
                      </Link>
                    </td>
                    <td className="hidden px-3 py-2 sm:table-cell">
                      <Sparkline values={data.series[r.hero_id] ?? []} />
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                      <span className="mr-2">{r.win_rate}%</span>
                      <Delta v={r.win_delta} />
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                      <span className="mr-2">{r.pick_rate}%</span>
                      <Delta v={r.pick_delta} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          </>
        )}
      </QueryState>
    </Page>
  );
}

function MoverCard({ icon, title, rows, byId }: { icon: ReactNode; title: string; rows: TrendRow[]; byId: Map<string, Hero> }) {
  const { t } = useTranslation();
  return (
    <SectionCard size="sm" icon={icon} title={title}>
      {rows.length ? (
        rows.map((r) => (
          <Link key={r.hero_id} to={`/heroes/${r.hero_id}`} className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-surface-2">
            <HeroAvatar hero={byId.get(r.hero_id)} size="xs" />
            <span className="flex-1 truncate text-sm">{byId.get(r.hero_id)?.name ?? r.hero_id}</span>
            <span className="text-xs text-muted tabular-nums">{r.win_rate}%</span>
            <Delta v={r.win_delta} />
          </Link>
        ))
      ) : (
        <p className="text-sm text-muted">{t("trends.noMovers")}</p>
      )}
    </SectionCard>
  );
}

function Delta({ v }: { v: number }) {
  if (v === 0) return <span className="text-muted tabular-nums">0</span>;
  return (
    <span className={cn("inline-flex items-center gap-0.5 font-semibold tabular-nums", v > 0 ? "text-good" : "text-bad")}>
      {v > 0 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
      {Math.abs(v).toFixed(1)}
    </span>
  );
}
