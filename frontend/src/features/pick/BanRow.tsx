import { Ban, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HeroAvatar } from "../../components/HeroAvatar";
import type { BanConfig, BanRecommendation, Hero } from "../../lib/api";
import { cn } from "../../lib/cn";

const SUGGEST = 5;

/**
 * 금지(밴)된 영웅 줄. 경쟁전에서만 보인다.
 * 금지된 칸을 누르면 풀리고, 빈 칸을 누르면 입력판이 '금지'로 바뀐다.
 * 오른쪽 추천 칩을 누르면 바로 금지된다 (밴 추천 탭을 열 필요 없음).
 */
export function BanRow({
  rules,
  total,
  lobbyBan,
  onLobbyBan,
  bans,
  byId,
  suggestions,
  canBan,
  active,
  onRemove,
  onBan,
  onFocus,
}: {
  rules: BanConfig;
  /** 이번 판 금지 칸 수 (로비 밴 포함) */
  total: number;
  lobbyBan: boolean;
  onLobbyBan: (on: boolean) => void;
  bans: string[];
  byId: Map<string, Hero>;
  suggestions: BanRecommendation[];
  /** 지금 금지할 수 있는 영웅인지 */
  canBan: (hero: string) => boolean;
  /** 입력판 대상이 '금지'인지 */
  active: boolean;
  onRemove: (hero: string) => void;
  onBan: (hero: string) => void;
  onFocus: () => void;
}) {
  const { t } = useTranslation();
  const slots = Array.from({ length: total }, (_, i) => bans[i] ?? null);
  const chips = suggestions.filter((r) => !bans.includes(r.hero_id)).slice(0, SUGGEST);
  const full = bans.length >= total;

  return (
    <section
      aria-label={t("bans.title")}
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-surface px-3 py-2",
        active ? "border-bad/60" : "border-border",
      )}
    >
      <h2
        className="flex items-center gap-1.5 text-sm font-semibold"
        title={t("bans.rule", { perTeam: rules.per_team, maxRole: rules.max_per_role })}
      >
        <Ban className="size-4 text-bad" />
        {t("bans.title")}
      </h2>
      <div className="flex gap-1.5">
        {slots.map((hero, i) => {
          const h = hero ? byId.get(hero) : undefined;
          return (
            <button
              key={i}
              type="button"
              onClick={() => (hero ? onRemove(hero) : onFocus())}
              title={h ? `${h.name} · ${t("bans.tapToUnban")}` : t("bans.tapToPick")}
              className={cn(
                "relative flex size-10 items-center justify-center rounded-lg border transition",
                h ? "border-bad/60" : "border-dashed border-border text-muted hover:border-bad/60",
              )}
            >
              {h ? (
                <>
                  <HeroAvatar hero={h} size="sm" className="grayscale" />
                  <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/35">
                    <X className="size-5 text-white" strokeWidth={3} />
                  </span>
                </>
              ) : (
                <Ban className="size-4" />
              )}
            </button>
          );
        })}
      </div>
      {rules.lobby > 0 && (
        <button
          type="button"
          aria-pressed={lobbyBan}
          onClick={() => onLobbyBan(!lobbyBan)}
          title={t("bans.lobbyHint")}
          className={cn(
            "inline-flex h-8 items-center rounded-full border px-2.5 text-xs font-medium transition",
            lobbyBan ? "border-bad/60 bg-enemy-soft text-bad" : "border-dashed border-border text-muted hover:text-text",
          )}
        >
          {t("bans.lobby")}
        </button>
      )}
      {/* 밴 추천: 다 찼으면 자리만 남기고 숨긴다 (줄 높이 유지) */}
      <div className={cn("flex w-full min-w-0 flex-wrap items-center gap-1 sm:w-auto sm:flex-1", full && "invisible")} aria-hidden={full}>
        <span className="mr-0.5 text-xs text-muted">{t("bans.suggest")}</span>
        {chips.map((r, i) => {
          const ok = canBan(r.hero_id);
          return (
            <button
              key={r.hero_id}
              type="button"
              disabled={!ok || full}
              onClick={() => onBan(r.hero_id)}
              title={t("bans.chipHint", { n: i + 1, votes: r.votes })}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full whitespace-nowrap border border-border bg-surface py-0.5 pr-2.5 pl-0.5 text-xs font-medium hover:border-bad/60 hover:bg-enemy-soft disabled:opacity-40"
            >
              <HeroAvatar hero={byId.get(r.hero_id)} size="xs" className="rounded-full" />
              {i < 3 && <span className="font-extrabold text-bad">{i + 1}</span>}
              {byId.get(r.hero_id)?.name ?? r.hero_id}
            </button>
          );
        })}
      </div>
    </section>
  );
}
