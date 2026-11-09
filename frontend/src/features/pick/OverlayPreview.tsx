import { Ban, Flame } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HeroAvatar } from "../../components/HeroAvatar";
import type { AppConfig, Hero } from "../../lib/api";
import { cn } from "../../lib/cn";
import { inBanPhase, type Board } from "./board";
import type { useRecommendations } from "./useRecommendations";

type Recs = ReturnType<typeof useRecommendations>;

/** 허브 레이아웃에서 보여 주는 오버레이 모양 미리보기 (조작 없음) */
export function OverlayPreview({
  recs,
  board,
  byId,
  config,
  bansActive,
  mapName,
}: {
  recs: Recs;
  board: Board;
  byId: Map<string, Hero>;
  config: AppConfig;
  bansActive: boolean;
  mapName: string | null;
}) {
  const { t } = useTranslation();
  const banPhase = inBanPhase(board, bansActive ? config.bans : null);
  const picks = recs.party
    ? (recs.partyQ.data?.combos[0]?.picks ?? []).map((p) => ({ hero_id: p.hero_id }))
    : (recs.solo.data?.recommendations ?? []).slice(0, 3);
  const bans = recs.bans.data?.recommendations ?? [];
  const threats = board.enemies.filter((s) => s.threat && s.hero).map((s) => s.hero!);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/80 p-3 text-white shadow-card">
      <div className="flex items-center justify-between text-[11px] text-white/70">
        <span className="font-semibold text-white">{t(banPhase ? "bans.tabBan" : "bans.tabPick")}</span>
        <span>{mapName ?? t("filters.allMaps")}</span>
      </div>
      <ol className="flex flex-col gap-1">
        {banPhase
          ? bans.slice(0, 3).map((r, i) => (
              <li key={r.hero_id} className={cn("flex items-center gap-2", i === 0 && "font-semibold")}>
                <span className="w-4 text-xs font-bold text-red-300">{i + 1}</span>
                <HeroAvatar hero={byId.get(r.hero_id)} size="sm" />
                <span className="truncate text-sm">{byId.get(r.hero_id)?.name ?? r.hero_id}</span>
                <Ban className="ml-auto size-3.5 text-red-300" />
              </li>
            ))
          : picks.map((p, i) => (
              <li key={p.hero_id} className={cn("flex items-center gap-2", i === 0 && "font-semibold")}>
                <span className="w-4 text-xs font-bold text-orange-300">{i + 1}</span>
                <HeroAvatar hero={byId.get(p.hero_id)} size="sm" />
                <span className="truncate text-sm">{byId.get(p.hero_id)?.name ?? p.hero_id}</span>
              </li>
            ))}
      </ol>
      {threats.length > 0 && (
        <p className="flex items-center gap-1 text-xs text-red-300">
          <Flame className="size-3.5" />
          {threats.map((h) => byId.get(h)?.name ?? h).join(", ")}
        </p>
      )}
      <p className="text-[10px] text-white/50">{t("live.overlayPreview")}</p>
    </div>
  );
}
