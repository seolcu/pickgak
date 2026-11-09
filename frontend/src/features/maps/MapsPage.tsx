import { Crosshair } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { NoDataState, QueryState } from "../../components/DataState";
import { FilterBar } from "../../components/FilterBar";
import { HeroAvatar } from "../../components/HeroAvatar";
import { MapImage } from "../../components/MapPicker";
import { RoleIcon } from "../../components/RoleIcon";
import { Button } from "../../components/ui/Button";
import { Card, ROLE_TEXT } from "../../components/ui/misc";
import { Page, PageHeader } from "../../components/ui/Page";
import { useHeroes, useMapInsights, useMaps } from "../../hooks/data";
import { usePrefs } from "../../hooks/prefs";
import { cn } from "../../lib/cn";

/** 전장 분석: 맵마다 평소보다 훨씬 많이 골라지는 '맵 특화' 영웅 */
export function MapsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { query, setMap } = usePrefs();
  const { byId } = useHeroes();
  const maps = useMaps(query).data ?? [];
  const insights = useMapInsights(query);
  const info = new Map(maps.map((m) => [m.map_id, m]));
  const modes = [...new Set(maps.map((m) => m.mode))];

  const startPick = (mapId: string) => {
    setMap(mapId);
    navigate("/");
  };

  return (
    <Page>
      <PageHeader title={t("maps.title")} lead={t("maps.subtitle")} actions={<FilterBar showMap={false} />} />

      <QueryState
        query={insights}
        empty={insights.data && insights.data.maps.length === 0 ? <NoDataState /> : undefined}
      >
        {(data) => (
          <>
            {modes.map((mode) => {
          const list = data.maps.filter((m) => info.get(m.map_id)?.mode === mode);
          if (!list.length) return null;
          return (
            <section key={mode} className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-muted">{t(`mapModes.${mode}`, { defaultValue: mode })}</h2>
              <div className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4", insights.isFetching && "opacity-70")}>
                {list.map((m) => (
                  <Card key={m.map_id} className="flex flex-col gap-2 overflow-hidden p-0">
                    <div className="relative">
                      <MapImage map={{ map_id: m.map_id, mode }} className="aspect-[16/7] w-full" />
                      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/85 to-transparent px-3 pt-8 pb-2">
                        <h3 className="font-semibold text-white">{info.get(m.map_id)?.name ?? m.map_id}</h3>
                        <Button
                          size="sm"
                          variant="overlay"
                          onClick={() => startPick(m.map_id)}
                          title={t("maps.pickHere")}
                        >
                          <Crosshair className="size-3.5" />
                          {t("maps.pick")}
                        </Button>
                      </div>
                    </div>
                    <ol className="flex flex-col gap-1 px-3 pb-3">
                      {m.specialists.map((s) => (
                        <li key={s.hero_id}>
                          <Link
                            to={`/heroes/${s.hero_id}`}
                            className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-surface-2"
                          >
                            <HeroAvatar hero={byId.get(s.hero_id)} size="xs" />
                            <span className="flex min-w-0 items-center gap-1">
                              <span className="truncate">{byId.get(s.hero_id)?.name ?? s.hero_id}</span>
                              <RoleIcon role={s.role} className={cn("size-3", ROLE_TEXT[s.role])} />
                            </span>
                            <span className="font-semibold text-accent tabular-nums" title={t("maps.ratioHint")}>
                              ×{s.pick_ratio}
                            </span>
                            <span
                              className={cn("w-14 text-right text-xs tabular-nums", s.win_diff >= 0 ? "text-good" : "text-bad")}
                              title={t("maps.winDiffHint")}
                            >
                              {s.win_diff > 0 ? "+" : ""}
                              {s.win_diff}%p
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ol>
                  </Card>
                ))}
              </div>
            </section>
          );
            })}
            <p className="text-xs text-muted">{t("maps.legend")}</p>
          </>
        )}
      </QueryState>
    </Page>
  );
}
