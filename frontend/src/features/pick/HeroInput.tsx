import { Ban, Search, UserRound, UsersRound, X } from "lucide-react";
import { forwardRef, useMemo, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { HeroAvatar } from "../../components/HeroAvatar";
import { RoleIcon } from "../../components/RoleIcon";
import { ROLE_TEXT } from "../../components/ui/misc";
import { ROLES, type Hero, type Role } from "../../lib/api";
import { cn } from "../../lib/cn";
import { matchesQuery } from "../../lib/hangul";
import { whyDisabled, type BanRules, type Board, type Slot, type Target } from "./board";

interface Props {
  board: Board;
  heroes: Hero[];
  byId: Map<string, Hero>;
  target: Target;
  onTarget: (t: Target) => void;
  /** 금지 규칙. 금지가 없는 모드(빠른 대전)면 null */
  bans: BanRules | null;
  /** 칸을 골라 둔 상태 (그 칸에 넣는다) */
  focus: Slot | null;
  /** 역할 자리가 다 차서 바꿀 칸을 기다리는 영웅 */
  pending: string | null;
  onPick: (hero: string) => void;
  onCancel: () => void;
}

/**
 * 늘 보이는 영웅 입력판. 대상(상대/우리/금지)을 고르고 영웅을 한 번 누르면 알맞은 칸에 들어간다.
 * 다시 누르면 빠진다. 검색 후 Enter는 첫 번째로 넣을 수 있는 영웅.
 */
export const HeroInput = forwardRef<HTMLInputElement, Props>(function HeroInput(
  { board, heroes, byId, target, onTarget, bans, focus, pending, onPick, onCancel },
  searchRef,
) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const roleOf = (h: string) => byId.get(h)?.role;

  // 영웅이 지금 어디 있는지 (타일 테두리)
  const where = useMemo(() => {
    const m = new Map<string, "mine" | "allies" | "enemies" | "banned">();
    for (const s of board.enemies) if (s.hero) m.set(s.hero, "enemies");
    for (const s of board.allies) if (s.hero) m.set(s.hero, s.isMe ? "mine" : "allies");
    if (bans) for (const h of board.bans) m.set(h, "banned");
    return m;
  }, [board, bans]);

  const reason = (h: Hero): string | null => {
    const r = whyDisabled(board, target, h.hero_id, h.role, roleOf, bans);
    if (r) return r;
    // 칸을 골라 뒀으면 그 칸 역할의 영웅만
    if (focus?.role && focus.role !== h.role && target !== "bans" && !board[target].some((s) => s.hero === h.hero_id))
      return "otherRole";
    return null;
  };

  const visible = query ? heroes.filter((h) => matchesQuery(query, h.name, h.hero_id)) : heroes;

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (query) setQuery("");
      else onCancel();
      return;
    }
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    const first = visible.find((h) => !reason(h));
    if (!first) return;
    onPick(first.hero_id);
    setQuery("");
  };

  const count = (team: "allies" | "enemies") => `${board[team].filter((s) => s.hero).length}/${board[team].length}`;
  const targets: { value: Target; icon: React.ReactNode; label: string; tone: string }[] = [
    { value: "enemies", icon: <UserRound className="size-4" />, label: `${t("pick.enemies")} ${count("enemies")}`, tone: "bg-enemy text-white" },
    { value: "allies", icon: <UsersRound className="size-4" />, label: `${t("pick.allies")} ${count("allies")}`, tone: "bg-ally text-white" },
    ...(bans
      ? [{ value: "bans" as const, icon: <Ban className="size-4" />, label: `${t("bans.short")} ${board.bans.length}/${bans.total}`, tone: "bg-muted text-white" }]
      : []),
  ];

  const hint = pending
    ? t("input.pendingHint", { hero: byId.get(pending)?.name, role: t(`roles.${roleOf(pending)}`) })
    : focus
      ? t("input.focusHint")
      : t(`input.hint_${target}`);

  const tile = (h: Hero) => {
    const r = reason(h);
    const at = where.get(h.hero_id);
    const inTarget = target === "bans" ? at === "banned" : board[target].some((s) => s.hero === h.hero_id);
    return (
      <button
        key={h.hero_id}
        type="button"
        disabled={!!r}
        aria-pressed={inTarget}
        onClick={() => onPick(h.hero_id)}
        title={h.name + (r ? ` · ${t(`input.why_${r}`)}` : inTarget ? ` · ${t("input.tapToRemove")}` : "")}
        className={cn(
          "relative flex rounded-lg p-0.5 transition",
          !r && "hover:-translate-y-0.5 hover:bg-surface-2",
          r && "opacity-25",
          pending === h.hero_id && "bg-accent-soft ring-2 ring-accent",
        )}
      >
        <HeroAvatar
          hero={h}
          size="tile"
          className={cn(
            "ring-offset-1 ring-offset-surface",
            at === "enemies" && "ring-2 ring-enemy",
            at === "allies" && "ring-2 ring-ally",
            at === "mine" && "ring-2 ring-accent",
            at === "banned" && "grayscale",
          )}
        />
        {at === "banned" && (
          <span className="absolute inset-0.5 flex items-center justify-center rounded-lg bg-black/40">
            <X className="size-5 text-white" strokeWidth={3} />
          </span>
        )}
      </button>
    );
  };

  return (
    <section aria-label={t("input.title")} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label={t("input.target")} className="inline-flex rounded-lg border border-border bg-bg p-0.5">
          {targets.map((o, i) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={target === o.value}
              onClick={() => onTarget(o.value)}
              title={`${t(`input.target_${o.value}`)} (Alt+${i + 1})`}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium tabular-nums transition",
                target === o.value ? o.tone : "text-muted hover:text-text",
              )}
            >
              {o.icon}
              {o.label}
            </button>
          ))}
        </div>
        <label className="relative min-w-40 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder={t("input.search")}
            aria-label={t("common.searchHero")}
            className="h-9 w-full rounded-lg border border-border bg-surface pr-3 pl-8 text-sm"
          />
        </label>
      </div>
      {/* 안내 한 줄: 높이 고정 (문구가 바뀌어도 아래가 밀리지 않게) */}
      <p className={cn("h-4 truncate text-xs leading-4", pending ? "font-semibold text-accent" : "text-muted")}>{hint}</p>

      {query ? (
        <div className="flex min-h-12 flex-wrap gap-1">
          {visible.length ? visible.map(tile) : <p className="py-3 text-sm text-muted">{t("common.noHeroMatch")}</p>}
        </div>
      ) : (
        ROLES.map((r: Role) => (
          <div key={r} className="flex items-start gap-1.5">
            <RoleIcon role={r} className={cn("mt-3 size-4 shrink-0", ROLE_TEXT[r])} />
            <div className="flex flex-wrap gap-1">{heroes.filter((h) => h.role === r).map(tile)}</div>
          </div>
        ))
      )}
    </section>
  );
});
