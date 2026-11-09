import { Ban, Info, ShieldAlert, TrendingUp, UserCheck, UsersRound, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HeroAvatar } from "../../components/HeroAvatar";
import { RoleIcon } from "../../components/RoleIcon";
import { Button } from "../../components/ui/Button";
import { Card, EmptyState, ROLE_TEXT, Skeleton, TierBadge } from "../../components/ui/misc";
import type { BanReason, BanRecommendation, Hero } from "../../lib/api";
import { cn } from "../../lib/cn";
import type { Board } from "./board";
import { ErrorBox } from "./RecommendationPanel";
import type { useRecommendations } from "./useRecommendations";

export const VOTE_PICKS = 3; // 각자 3명에게 투표

/** 파티 인원에 따라 무엇을 더 중시하는지 한 줄로 */
function modeLabel(t: (k: string, o?: Record<string, unknown>) => string, w: { party_size: number; team_size: number }) {
  if (w.party_size >= w.team_size) return t("bans.modeFull");
  if (w.party_size <= 2) return t("bans.modeSolo", { n: w.party_size });
  return t("bans.modeMixed", { n: w.party_size });
}

/**
 * 밴 투표 추천.
 * 위 3명은 투표 1~3순위, 그 아래는 대안 후보다. 파티가 아닌 아군이 그 영웅을 하려 하면
 * '아군이 할 영웅'으로 빼고 다음 후보로 넘어갈 수 있게 넉넉히 보여준다.
 */
export function BanPanel({
  recs,
  board,
  byId,
  onBan,
  onAllyWant,
}: {
  recs: ReturnType<typeof useRecommendations>;
  board: Board;
  byId: Map<string, Hero>;
  onBan: (hero: string) => void;
  /** 아군이 하려는 영웅으로 표시/해제 */
  onAllyWant: (hero: string) => void;
}) {
  const { t } = useTranslation();
  const q = recs.bans;
  const protecting = recs.members.some((m) => m.player?.heroes.length);
  const wants = board.allyWants ?? [];
  const list = q.data?.recommendations ?? [];
  const top = list.slice(0, VOTE_PICKS);
  const more = list.slice(VOTE_PICKS);

  return (
    <div className="flex flex-col gap-3">
      <h2 className="flex items-center gap-1.5 text-lg font-bold">
        <Ban className="size-5 text-bad" />
        {t("bans.panelTitle")}
      </h2>
      <p className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        {/* 문장마다 한 줄씩 (번역문의 마침표 규칙과 관계없이 읽히게) */}
        <span className="flex flex-col gap-0.5">
          {q.data && <b className="text-text">{modeLabel(t, q.data.weights)}</b>}
          <span>{protecting ? t("bans.explain") : t("bans.explainNoPreferred")}</span>
        </span>
      </p>
      {recs.party && (
        <p className="flex items-start gap-2 rounded-lg bg-ally-soft px-3 py-2 text-xs text-ally">
          <UsersRound className="mt-0.5 size-3.5 shrink-0" />
          {t("bans.partyTip")}
        </p>
      )}

      {wants.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-ally/40 bg-ally-soft/50 px-3 py-2">
          <span className="text-xs font-semibold text-ally">{t("bans.allyWants")}</span>
          {wants.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => onAllyWant(h)}
              title={t("bans.allyWantRemove")}
              className="inline-flex items-center gap-1 rounded-md bg-surface py-0.5 pr-1.5 pl-0.5 text-xs hover:bg-surface-2"
            >
              <HeroAvatar hero={byId.get(h)} size="xs" />
              {byId.get(h)?.name ?? h}
              <X className="size-3 text-muted" />
            </button>
          ))}
        </div>
      )}

      {q.error ? (
        <ErrorBox error={q.error} byId={byId} />
      ) : !q.data ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : list.length ? (
        <div className={cn("flex flex-col gap-3 transition-opacity", q.isFetching && "opacity-60")}>
          <ol className="flex flex-col gap-2">
            {top.map((r, i) => (
              <TopCard key={r.hero_id} rec={r} rank={i + 1} board={board} byId={byId} onBan={onBan} onAllyWant={onAllyWant} />
            ))}
          </ol>

          {more.length > 0 && (
            <section className="flex flex-col gap-1">
              <h3 className="text-xs font-semibold text-muted">{t("bans.moreTitle")}</h3>
              <p className="text-[11px] text-muted">{t("bans.moreHint")}</p>
              <ol className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface">
                {more.map((r, i) => (
                  <MoreRow
                    key={r.hero_id}
                    rec={r}
                    rank={VOTE_PICKS + i + 1}
                    board={board}
                    byId={byId}
                    onBan={onBan}
                    onAllyWant={onAllyWant}
                  />
                ))}
              </ol>
            </section>
          )}
        </div>
      ) : (
        <EmptyState title={t("bans.none")} />
      )}
    </div>
  );
}

interface RowProps {
  rec: BanRecommendation;
  rank: number;
  board: Board;
  byId: Map<string, Hero>;
  onBan: (hero: string) => void;
  onAllyWant: (hero: string) => void;
}

function Actions({ rec, board, onBan, onAllyWant, compact }: RowProps & { compact?: boolean }) {
  const { t } = useTranslation();
  const banned = board.bans.includes(rec.hero_id);
  return (
    <div className={cn("flex shrink-0 gap-1", compact ? "flex-row" : "flex-col")}>
      <Button
        size="sm"
        variant={banned ? "danger" : "secondary"}
        disabled={banned}
        onClick={() => onBan(rec.hero_id)}
        title={t("bans.markBannedHint")}
      >
        {banned ? t("bans.banned") : t("bans.markBanned")}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => onAllyWant(rec.hero_id)} title={t("bans.allyWantHint")}>
        <UserCheck className="size-3.5" />
        {!compact && t("bans.allyWant")}
      </Button>
    </div>
  );
}

function TopCard(props: RowProps) {
  const { t } = useTranslation();
  const { rec: r, rank, byId } = props;
  const hero = byId.get(r.hero_id);
  return (
    <Card className={cn("flex gap-3 p-3", rank === 1 && "border-bad/50")}>
      <div className="flex flex-col items-center gap-1">
        <span className={cn("text-xs font-extrabold whitespace-nowrap", rank === 1 ? "text-bad" : "text-muted")}>
          {t("bans.rank", { n: rank })}
        </span>
        <HeroAvatar hero={hero} size="lg" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate font-semibold">{hero?.name ?? r.hero_id}</span>
          <RoleIcon role={r.role} className={cn("shrink-0", ROLE_TEXT[r.role])} />
          <TierBadge tier={r.tier} />
          <span className="ml-auto shrink-0 text-xs whitespace-nowrap text-muted tabular-nums">{t("bans.votes", { n: r.votes })}</span>
        </div>
        <BanReasons reasons={r.reasons} byId={byId} />
      </div>
      <Actions {...props} />
    </Card>
  );
}

function MoreRow(props: RowProps) {
  const { rec: r, rank, byId } = props;
  const hero = byId.get(r.hero_id);
  const threats = r.reasons.filter((x) => x.kind === "threatens");
  return (
    <li className="flex items-center gap-2.5 px-3 py-2">
      <span className="w-5 text-right text-xs font-bold text-muted tabular-nums">{rank}</span>
      <HeroAvatar hero={hero} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <span className="truncate">{hero?.name ?? r.hero_id}</span>
          <RoleIcon role={r.role} className={cn("size-3.5", ROLE_TEXT[r.role])} />
          <TierBadge tier={r.tier} className="size-4 text-[10px]" />
        </span>
        <BanReasons reasons={threats.length ? threats : r.reasons.filter((x) => x.kind === "ban_rate")} byId={byId} />
      </div>
      <Actions {...props} compact />
    </li>
  );
}

export function BanReasons({ reasons, byId }: { reasons: BanReason[]; byId: Map<string, Hero> }) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-wrap gap-1">
      {reasons.map((r, i) => {
        let icon, text, tone;
        switch (r.kind) {
          case "meta":
            icon = <TrendingUp />;
            text = t("reasons.meta", { tier: r.tier, win: r.win_rate, pick: r.pick_rate });
            break;
          case "threatens":
            icon = <ShieldAlert />;
            text = t("bans.threatens", { hero: byId.get(r.hero)?.name ?? r.hero });
            tone = "bad";
            break;
          case "ban_rate":
            icon = <Ban />;
            text = t("bans.banRate", { rate: r.ban_rate });
            break;
        }
        return (
          <li
            key={i}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs [&_svg]:size-3",
              tone === "bad" ? "bg-bad/12 text-bad" : "bg-surface-2 text-muted",
            )}
          >
            {icon}
            {text}
          </li>
        );
      })}
    </ul>
  );
}
