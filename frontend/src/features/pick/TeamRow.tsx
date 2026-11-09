import { ArrowLeftRight, Flame, UserRound, UsersRound, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HeroAvatar } from "../../components/HeroAvatar";
import { RoleIcon } from "../../components/RoleIcon";
import { Badge } from "../../components/ui/Badge";
import { ROLE_TEXT } from "../../components/ui/misc";
import type { Comp, Hero, Player, Role } from "../../lib/api";
import { cn } from "../../lib/cn";
import type { Slot, Team } from "./board";

interface Props {
  team: Team;
  slots: Slot[];
  byId: Map<string, Hero>;
  players: Player[];
  me: Player | null;
  /** 골라 둔 칸 */
  focusId: string | null;
  /** 바꿀 칸을 기다리는 역할 (그 역할 칸을 강조) */
  askRole: Role | null;
  onSlot: (slot: Slot) => void;
  onClearSlot: (slot: Slot) => void;
  /** 붙어 있는 같은 역할 두 칸을 맞바꾼다 (게임 화면 순서에 맞추기) */
  onSwap: (a: Slot, b: Slot) => void;
  /** 상대 칸: 위험 플레이어 표시 켜기/끄기 */
  onThreat?: (slot: Slot) => void;
  /** 이 팀의 조합 유형 (2명 이상 정해졌을 때) */
  comp?: Comp | null;
}

/**
 * 한 팀의 칸을 가로 한 줄로. 영웅 입력은 아래 입력판에서 하고,
 * 칸을 누르면 그 칸을 골라 둔다(교체할 때). ×로 바로 비운다.
 */
export function TeamRow({
  team,
  slots,
  byId,
  players,
  me,
  focusId,
  askRole,
  onSlot,
  onClearSlot,
  onSwap,
  onThreat,
  comp,
}: Props) {
  const { t } = useTranslation();
  const ally = team === "allies";
  return (
    <section
      aria-label={t(`pick.${team}`)}
      className={cn(
        "flex flex-col gap-1.5 rounded-xl border p-2",
        ally ? "border-ally/30 bg-ally-soft/40" : "border-enemy/30 bg-enemy-soft/40",
      )}
    >
      <h2 className={cn("flex items-center gap-1.5 px-1 text-sm font-semibold", ally ? "text-ally" : "text-enemy")}>
        {ally ? <UsersRound className="size-4" /> : <UserRound className="size-4" />}
        {t(`pick.${team}`)}
        {/* 조합 유형: 자리는 늘 잡아 둔다 (나타날 때 줄이 흔들리지 않게) */}
        <span
          className={cn(
            "ml-1 rounded px-1.5 text-[11px] leading-5 font-medium",
            comp ? "bg-surface text-text" : "invisible",
          )}
          title={t("comps.label")}
        >
          {comp ? t(`comps.${comp}`) : "-"}
        </span>
      </h2>
      <ol className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))` }}>
        {slots.map((s, i) => {
          const next = slots[i + 1];
          const swappable = next && next.role === s.role && (s.hero || next.hero || s.isMe || next.isMe || s.playerId !== null || next.playerId !== null);
          const hero = s.hero ? byId.get(s.hero) : undefined;
          const player = s.isMe ? me : players.find((p) => p.id === s.playerId);
          const role = s.role ?? hero?.role ?? s.wantRole ?? null;
          const asked = askRole !== null && s.role === askRole;
          return (
            <li key={s.id} className="relative">
              <button
                type="button"
                onClick={() => onSlot(s)}
                aria-pressed={focusId === s.id}
                title={asked ? t("input.replaceHere") : t("input.slotHint")}
                className={cn(
                  "flex w-full flex-col items-center gap-1 rounded-lg border bg-surface px-1.5 pt-1.5 pb-2 transition hover:border-accent/60",
                  s.isMe ? "border-accent" : player ? "border-ally" : s.threat ? "border-bad" : "border-border",
                  s.threat && "bg-enemy-soft",
                  focusId === s.id && "ring-2 ring-accent",
                  asked && "animate-pulse ring-2 ring-accent",
                )}
              >
                {/* 윗줄: 역할 · 사람 (영웅 그림과 겹치지 않게 따로 한 줄) */}
                <span className="flex h-4 w-full items-center justify-between gap-1">
                  <RoleIcon role={role} className={cn("size-3.5 shrink-0", role ? ROLE_TEXT[role] : "text-muted")} />
                  {(s.isMe || player) && (
                    <Badge tone={s.isMe ? "solid" : "ally"} size="xs" className="min-w-0 truncate leading-4">
                      {s.isMe ? t("pick.me") : player!.name}
                    </Badge>
                  )}
                </span>
                {hero ? (
                  <HeroAvatar hero={hero} size="sm" />
                ) : (
                  <span className="flex size-8 items-center justify-center rounded-lg border border-dashed border-border text-muted">
                    +
                  </span>
                )}
                <span className={cn("w-full truncate text-center text-[11px] leading-4", !hero && "text-muted")}>
                  {hero?.name ?? (s.role ? t(`roles.${s.role}`) : t("pick.anyRole"))}
                </span>
              </button>
              {onThreat && hero && (
                <button
                  type="button"
                  aria-pressed={!!s.threat}
                  onClick={() => onThreat(s)}
                  aria-label={s.threat ? t("pick.unmarkThreat") : t("pick.markThreat")}
                  title={s.threat ? t("pick.unmarkThreat") : t("pick.markThreat")}
                  className={cn(
                    "absolute -top-1.5 -left-1.5 flex size-5 items-center justify-center rounded-full border shadow-sm",
                    s.threat ? "border-bad bg-bad text-white" : "border-border bg-surface text-muted hover:text-bad",
                  )}
                >
                  <Flame className="size-3" />
                </button>
              )}
              {swappable && (
                <button
                  type="button"
                  onClick={() => onSwap(s, next)}
                  aria-label={t("pick.swapSlots")}
                  title={t("pick.swapSlots")}
                  className="absolute top-1/2 -right-[0.65rem] z-10 flex size-5 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface text-muted shadow-sm hover:text-text"
                >
                  <ArrowLeftRight className="size-3" />
                </button>
              )}
              {hero && (
                <button
                  type="button"
                  onClick={() => onClearSlot(s)}
                  aria-label={t("pick.clearSlot")}
                  title={t("pick.clearSlot")}
                  className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-surface text-muted shadow-sm hover:text-bad"
                >
                  <X className="size-3" />
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
