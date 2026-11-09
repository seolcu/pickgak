import { Search, Star } from "lucide-react";
import { useMemo, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { ROLES, type Hero, type Role } from "../lib/api";
import { cn } from "../lib/cn";
import { matchesQuery } from "../lib/hangul";
import { loadLocal, saveLocal } from "../lib/storage";
import { HeroAvatar } from "./HeroAvatar";
import { RoleIcon } from "./RoleIcon";
import { ROLE_TEXT } from "./ui/misc";

const RECENT_KEY = "pickgak.recentHeroes";

export function rememberHero(id: string) {
  const recent = loadLocal<string[]>(RECENT_KEY, []).filter((x) => x !== id);
  saveLocal(RECENT_KEY, [id, ...recent].slice(0, 12));
}

interface Props {
  heroes: Hero[];
  /** 고를 수 있는 역할. 비우면 전체 */
  roles?: Role[];
  selected: string[];
  onToggle: (id: string) => void;
  /** 고를 수 없는 영웅 (같은 팀에 이미 있음 등) */
  disabled?: Set<string>;
  starred?: Set<string>;
  showRecent?: boolean;
  autoFocus?: boolean;
  /** 그리드 칸 크기 */
  dense?: boolean;
}

export function HeroPicker({
  heroes,
  roles,
  selected,
  onToggle,
  disabled,
  starred,
  showRecent,
  autoFocus,
  dense,
}: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const allowed = roles?.length ? roles : ROLES;
  const [roleTab, setRoleTab] = useState<Role | "all">(allowed.length === 1 ? allowed[0] : "all");

  const visible = useMemo(
    () =>
      heroes.filter(
        (h) =>
          allowed.includes(h.role) &&
          (roleTab === "all" || h.role === roleTab) &&
          matchesQuery(query, h.name, h.hero_id),
      ),
    [heroes, allowed, roleTab, query],
  );

  const recent = useMemo(() => {
    if (!showRecent || query) return [];
    const byId = new Map(heroes.map((h) => [h.hero_id, h]));
    return loadLocal<string[]>(RECENT_KEY, [])
      .map((id) => byId.get(id))
      .filter((h): h is Hero => !!h && allowed.includes(h.role) && (roleTab === "all" || h.role === roleTab))
      .slice(0, 6);
  }, [showRecent, query, heroes, allowed, roleTab]);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const first = visible.find((h) => !disabled?.has(h.hero_id));
    if (first) onToggle(first.hero_id);
  };

  const tile = (h: Hero) => {
    const isOn = selected.includes(h.hero_id);
    const isOff = disabled?.has(h.hero_id) && !isOn;
    return (
      <button
        key={h.hero_id}
        type="button"
        disabled={isOff}
        aria-pressed={isOn}
        onClick={() => onToggle(h.hero_id)}
        title={h.name}
        aria-label={h.name}
        className={cn(
          "group relative flex flex-col items-center gap-1 rounded-lg p-1 text-[11px] leading-tight transition",
          isOn ? "bg-accent-soft ring-2 ring-accent" : "hover:bg-surface-2",
          isOff && "opacity-30",
        )}
      >
        <HeroAvatar hero={h} size={dense ? "sm" : "md"} />
        <span className="w-full truncate text-center">{h.name}</span>
        {starred?.has(h.hero_id) && (
          <Star className="absolute top-0.5 right-0.5 size-3 fill-accent text-accent" aria-label={t("common.preferred")} />
        )}
      </button>
    );
  };

  const grouped = roleTab === "all" && !query;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-40 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
          <input
            autoFocus={autoFocus}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder={t("common.searchHero")}
            aria-label={t("common.searchHero")}
            className="h-9 w-full rounded-lg border border-border bg-surface pr-3 pl-8 text-sm"
          />
        </label>
        {allowed.length > 1 && (
          <div className="flex gap-1" role="tablist">
            {(["all", ...allowed] as const).map((r) => (
              <button
                key={r}
                type="button"
                role="tab"
                aria-selected={roleTab === r}
                onClick={() => setRoleTab(r)}
                title={r === "all" ? t("common.allRoles") : t(`roles.${r}`)}
                className={cn(
                  "inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-medium",
                  roleTab === r ? "bg-surface-2 text-text" : "text-muted hover:text-text",
                )}
              >
                {r === "all" ? t("common.all") : <RoleIcon role={r} className={ROLE_TEXT[r]} />}
              </button>
            ))}
          </div>
        )}
      </div>

      {recent.length > 0 && (
        // 최근 고른 영웅은 아래 전체 목록과 줄로 구분
        <section className="border-b-2 border-border pb-3">
          <h4 className="mb-1 text-xs font-medium text-muted">{t("common.recent")}</h4>
          <div className={cn("grid gap-1", dense ? "grid-cols-[repeat(auto-fill,minmax(52px,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(64px,1fr))]")}>
            {recent.map(tile)}
          </div>
        </section>
      )}

      {grouped ? (
        allowed.map((r) => (
          <section key={r}>
            <h4 className={cn("mb-1 flex items-center gap-1 text-xs font-medium", ROLE_TEXT[r])}>
              <RoleIcon role={r} className="size-3.5" />
              {t(`roles.${r}`)}
            </h4>
            <div className={cn("grid gap-1", dense ? "grid-cols-[repeat(auto-fill,minmax(52px,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(64px,1fr))]")}>
              {visible.filter((h) => h.role === r).map(tile)}
            </div>
          </section>
        ))
      ) : visible.length ? (
        <section>
          {recent.length > 0 && <h4 className="mb-1 text-xs font-medium text-muted">{t("common.allHeroes")}</h4>}
          <div className={cn("grid gap-1", dense ? "grid-cols-[repeat(auto-fill,minmax(52px,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(64px,1fr))]")}>
            {visible.map(tile)}
          </div>
        </section>
      ) : (
        <p className="py-6 text-center text-sm text-muted">{t("common.noHeroMatch")}</p>
      )}
    </div>
  );
}
