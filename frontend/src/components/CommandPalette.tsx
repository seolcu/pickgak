import { BarChart3, Crosshair, MapPinned, Search, Settings, TrendingUp, UsersRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { useHeroes, useMaps } from "../hooks/data";
import { usePrefs } from "../hooks/prefs";
import { cn } from "../lib/cn";
import { matchesQuery } from "../lib/hangul";
import { HeroAvatar } from "./HeroAvatar";

interface Item {
  key: string;
  group: "pages" | "heroes" | "maps";
  label: string;
  sub?: string;
  icon: ReactNode;
  run: () => void;
}

/** ⌘K / Ctrl+K: 영웅(초성 검색)·전장·화면으로 바로 이동 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { heroes } = useHeroes();
  const { query: filters, setMap } = usePrefs();
  const maps = useMaps(filters).data ?? [];
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const go = (path: string) => () => {
    navigate(path);
    onClose();
  };

  const items = useMemo<Item[]>(() => {
    const pages = ([
      { key: "p/", group: "pages" as const, label: t("nav.pick"), icon: <Crosshair />, run: go("/") },
      { key: "p/meta", group: "pages" as const, label: t("nav.meta"), icon: <BarChart3 />, run: go("/meta") },
      { key: "p/maps", group: "pages" as const, label: t("nav.maps"), icon: <MapPinned />, run: go("/maps") },
      { key: "p/trends", group: "pages" as const, label: t("nav.trends"), icon: <TrendingUp />, run: go("/trends") },
      { key: "p/players", group: "pages" as const, label: t("nav.players"), icon: <UsersRound />, run: go("/players") },
      { key: "p/settings", group: "pages" as const, label: t("nav.settings"), icon: <Settings />, run: go("/settings") },
    ] satisfies Item[]).filter((p) => matchesQuery(q, p.label));
    const hs: Item[] = heroes
      .filter((h) => matchesQuery(q, h.name, h.hero_id))
      .slice(0, q ? 12 : 6)
      .map((h) => ({
        key: `h/${h.hero_id}`,
        group: "heroes",
        label: h.name,
        sub: t(`roles.${h.role}`),
        icon: <HeroAvatar hero={h} size="xs" />,
        run: go(`/heroes/${h.hero_id}`),
      }));
    const ms: Item[] = maps
      .filter((m) => matchesQuery(q, m.name, m.map_id))
      .slice(0, q ? 8 : 0)
      .map((m) => ({
        key: `m/${m.map_id}`,
        group: "maps",
        label: m.name,
        sub: t("palette.mapAction"),
        icon: <MapPinned />,
        run: () => {
          setMap(m.map_id);
          go("/")();
        },
      }));
    return [...hs, ...ms, ...pages];
    // go/setMap은 매 렌더 새로 만들어지지만 동작은 같다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, heroes, maps, t]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      items[active]?.run();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal
        aria-label={t("palette.title")}
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-card"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKey}
      >
        <label className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-4 text-muted" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            placeholder={t("palette.placeholder")}
            aria-label={t("palette.placeholder")}
            className="h-12 flex-1 bg-transparent text-sm"
          />
          <kbd className="rounded border border-border px-1.5 text-[10px] text-muted">Esc</kbd>
        </label>
        <ul ref={listRef} className="overflow-y-auto p-1.5" role="listbox">
          {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">{t("common.noHeroMatch")}</li>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? t(`palette.${it.group}`) : null;
            lastGroup = it.group;
            return (
              <li key={it.key} role="option" aria-selected={i === active}>
                {header && <p className="px-2 pt-2 pb-1 text-[11px] font-semibold text-muted">{header}</p>}
                <button
                  type="button"
                  data-index={i}
                  onMouseEnter={() => setActive(i)}
                  onClick={it.run}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm [&>svg]:size-4 [&>svg]:text-muted",
                    i === active && "bg-surface-2",
                  )}
                >
                  {it.icon}
                  <span className="flex-1">{it.label}</span>
                  {it.sub && <span className="text-xs text-muted">{it.sub}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** Ctrl/⌘+K로 열고 닫는다 */
export function usePaletteHotkey(toggle: () => void) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);
}
