import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, LayoutGrid, MapPin, Search } from "lucide-react";
import { useMemo, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { MapInfo } from "../lib/api";
import { cn } from "../lib/cn";
import { apiAsset } from "../lib/platform";
import { matchesQuery } from "../lib/hangul";
import { loadLocal, saveLocal } from "../lib/storage";

const RECENT_KEY = "pickgak.recentMaps";

/** 전장 이미지. 받아 오지 못하면 모드 이름이 쓰인 무늬로 대신한다 */
export function MapImage({ map, className }: { map: Pick<MapInfo, "map_id" | "mode">; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={cn("relative block overflow-hidden bg-surface-2", className)}>
      {failed && (
        // 공식 이미지가 없는 신규 맵 등: 모드 색 무늬로 대신
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-surface-2 to-border text-muted"
        >
          <MapPin className="size-1/4 max-h-8 max-w-8 opacity-60" />
        </span>
      )}
      {!failed && (
        <img
          src={apiAsset(`/maps/${map.map_id}/image`)}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      )}
    </span>
  );
}

/** 전장 선택: 이미지 그리드 + 검색(초성) + 최근 전장. 통계 없는 맵은 맨 아래 흐리게 */
export function MapPicker({ maps, value, onChange }: { maps: MapInfo[]; value: string; onChange: (id: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const current = maps.find((m) => m.map_id === value);

  const pick = (id: string) => {
    onChange(id);
    if (id !== "all") saveLocal(RECENT_KEY, [id, ...loadLocal<string[]>(RECENT_KEY, []).filter((x) => x !== id)].slice(0, 6));
    setOpen(false);
    setQ("");
  };

  const visible = useMemo(() => maps.filter((m) => matchesQuery(q, m.name, m.map_id)), [maps, q]);
  const recent = useMemo(() => {
    if (q) return [];
    const byId = new Map(maps.map((m) => [m.map_id, m]));
    return loadLocal<string[]>(RECENT_KEY, [])
      .map((id) => byId.get(id))
      .filter((m): m is MapInfo => !!m)
      .slice(0, 4);
    // 열 때마다 최근 목록을 새로 읽는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maps, q, open]);
  const modes = [...new Set(visible.filter((m) => m.has_data).map((m) => m.mode))];
  const noData = visible.filter((m) => !m.has_data);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && visible[0]) pick(visible[0].map_id);
  };

  const tile = (m: MapInfo) => (
    <button
      key={m.map_id}
      type="button"
      onClick={() => pick(m.map_id)}
      aria-pressed={m.map_id === value}
      title={m.has_data ? m.name : t("filters.mapNoData", { name: m.name })}
      aria-label={m.name}
      className={cn(
        "group relative overflow-hidden rounded-lg text-left ring-offset-2 ring-offset-surface transition",
        m.map_id === value ? "ring-2 ring-accent" : "hover:ring-2 hover:ring-border",
        !m.has_data && "opacity-50",
      )}
    >
      <MapImage map={m} className="aspect-[16/9] w-full transition group-hover:scale-105" />
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2 pt-5 pb-1.5 text-xs font-semibold text-white">
        {m.name}
      </span>
    </button>
  );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={t("filters.map")}
          className="inline-flex h-9 min-w-40 items-center gap-2 rounded-lg border border-border bg-surface pr-2 pl-1 text-sm font-medium hover:bg-surface-2"
        >
          {current ? (
            <MapImage map={current} className="h-7 w-11 rounded-md" />
          ) : (
            <span className="flex h-7 w-11 items-center justify-center rounded-md bg-surface-2 text-muted">
              <LayoutGrid className="size-4" />
            </span>
          )}
          <span className="flex-1 truncate text-left">{current?.name ?? t("filters.allMaps")}</span>
          <ChevronDown className="size-4 text-muted" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 flex max-h-[min(78vh,720px)] w-[min(94vw,760px)] flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-surface p-3 shadow-card"
        >
          <div className="flex items-center gap-2">
            <label className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKey}
                placeholder={t("filters.searchMap")}
                aria-label={t("filters.searchMap")}
                className="h-9 w-full rounded-lg border border-border bg-surface pr-3 pl-8 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => pick("all")}
              aria-pressed={value === "all"}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium",
                value === "all" ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2",
              )}
            >
              <LayoutGrid className="size-4" />
              {t("filters.allMaps")}
            </button>
          </div>

          {recent.length > 0 && (
            <Section title={t("filters.recentMaps")}>{recent.map(tile)}</Section>
          )}
          {modes.map((mode) => (
            <Section key={mode} title={t(`mapModes.${mode}`, { defaultValue: mode })}>
              {visible.filter((m) => m.has_data && m.mode === mode).map(tile)}
            </Section>
          ))}
          {noData.length > 0 && <Section title={t("filters.noDataGroup")}>{noData.map(tile)}</Section>}
          {visible.length === 0 && <p className="py-6 text-center text-sm text-muted">{t("filters.noMapMatch")}</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className="text-xs font-semibold text-muted">{title}</h4>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">{children}</div>
    </section>
  );
}
