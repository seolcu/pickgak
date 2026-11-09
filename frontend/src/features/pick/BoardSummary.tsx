import { Flame, Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HeroAvatar } from "../../components/HeroAvatar";
import { RoleIcon } from "../../components/RoleIcon";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card, ROLE_TEXT } from "../../components/ui/misc";
import type { Hero, Player } from "../../lib/api";
import { cn } from "../../lib/cn";
import type { Board, Slot } from "./board";

/** 데스크톱 읽기 전용 판 요약. 고치려면 "수정"을 눌러 편집기를 연다 */
export function BoardSummary({
  board,
  byId,
  players,
  me,
  bansActive,
  editing,
  onEdit,
}: {
  board: Board;
  byId: Map<string, Hero>;
  players: Player[];
  me: Player | null;
  bansActive: boolean;
  editing: boolean;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const personName = (s: Slot) =>
    s.isMe ? (me?.name ?? t("pick.me")) : (players.find((p) => p.id === s.playerId)?.name ?? null);
  const party = board.allies.filter((s) => s.isMe || s.playerId !== null);

  const team = (side: "allies" | "enemies") => (
    <div className="flex flex-col gap-1.5">
      <span className={cn("text-xs font-semibold", side === "enemies" ? "text-enemy" : "text-ally")}>
        {t(side === "enemies" ? "pick.enemies" : "pick.allies")}
      </span>
      <ol className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
        {board[side].map((s) => {
          const hero = s.hero ? byId.get(s.hero) : undefined;
          return (
            <li
              key={s.id}
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-lg border border-border bg-surface-2 px-2 py-1.5",
                s.isMe && "ring-1 ring-accent",
                s.threat && "border-bad/40 bg-enemy-soft/60",
              )}
            >
              {hero ? (
                <HeroAvatar hero={hero} size="sm" />
              ) : (
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-muted">
                  +
                </span>
              )}
              <div className="flex min-w-0 flex-col">
                <span className={cn("truncate text-sm font-medium", !hero && "text-muted")}>
                  {hero?.name ?? (s.role ? t(`roles.${s.role}`) : t("pick.anyRole"))}
                </span>
                <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted">
                  {s.role && <RoleIcon role={s.role} className={cn("size-3 shrink-0", ROLE_TEXT[s.role])} />}
                  {s.isMe && (
                    <Badge tone="solid" size="xs">
                      {t("pick.me")}
                    </Badge>
                  )}
                  {s.threat && <Flame className="size-3 shrink-0 text-bad" aria-label={t("pick.markThreat")} />}
                  {personName(s) && <span className="truncate">{personName(s)}</span>}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );

  return (
    <Card className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">{t("pick.currentMatch")}</h2>
        <Button
          size="sm"
          variant={editing ? "secondary" : "ghost"}
          className="ml-auto"
          onClick={onEdit}
          aria-pressed={editing}
        >
          <Pencil className="size-3.5" />
          {editing ? t("common.close") : t("common.edit")}
        </Button>
      </div>
      {team("allies")}
      {team("enemies")}
      {bansActive && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted">{t("bans.title")}</span>
          {board.bans.length ? (
            board.bans.map((h) => (
              <Badge key={h} tone="bad">
                {byId.get(h)?.name ?? h}
              </Badge>
            ))
          ) : (
            <span className="text-muted">-</span>
          )}
        </div>
      )}
      {party.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <span>{t("pick.party")}</span>
          {party.map((s) => (
            <span key={s.id} className="text-text">
              {personName(s)}
            </span>
          ))}
        </p>
      )}
    </Card>
  );
}
