import { AlertTriangle, Ban, Check, Info, Link2, Sparkles, Star, UsersRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Segmented } from "../../components/ui/Segmented";
import { BanPanel } from "./BanPanel";
import { HeroAvatar } from "../../components/HeroAvatar";
import { RoleIcon } from "../../components/RoleIcon";
import { Button } from "../../components/ui/Button";
import { isNoData, NoDataState } from "../../components/DataState";
import { Card, EmptyState, ROLE_TEXT, Skeleton, TierBadge } from "../../components/ui/misc";
import { ApiError, type Hero, type PartyCombo, type Recommendation, type Role } from "../../lib/api";
import { cn } from "../../lib/cn";
import { onlyPreferredFor, type Board, type Person } from "./board";
import { ReasonChips, ScoreBar } from "./Reasons";
import type { useRecommendations } from "./useRecommendations";

type Recs = ReturnType<typeof useRecommendations>;

interface Props {
  recs: Recs;
  board: Board;
  byId: Map<string, Hero>;
  mapName?: string;
  onApply: (picks: { slotId: string; hero: string; role: Role }[]) => void;
  onOnlyPreferred: (p: Person, value: boolean) => void;
}

export type RecTab = "pick" | "ban";

/** 픽 추천 / 밴 추천. 탭은 밖에서 정한다 (밴 단계면 자동으로 밴 추천) */
export function RecommendationPanel({
  bansActive,
  tab,
  onTab,
  onBan,
  onAllyWant,
  ...props
}: Props & {
  bansActive: boolean;
  tab: RecTab;
  onTab: (t: RecTab) => void;
  onBan: (hero: string) => void;
  onAllyWant: (hero: string) => void;
}) {
  const { t } = useTranslation();
  const showBan = bansActive && tab === "ban";
  return (
    <div className="flex flex-col gap-3">
      {bansActive && (
        <Segmented
          label={t("bans.tabs")}
          value={tab}
          onChange={onTab}
          className="self-start"
          options={[
            { value: "pick", label: <><Sparkles className="size-4" />{t("bans.tabPick")}</> },
            { value: "ban", label: <><Ban className="size-4" />{t("bans.tabBan")}</> },
          ]}
        />
      )}
      {showBan ? <BanPanel recs={props.recs} board={props.board} byId={props.byId} onBan={onBan} onAllyWant={onAllyWant} /> : <PickPanel {...props} />}
    </div>
  );
}

function PickPanel({ recs, board, byId, mapName, onApply, onOnlyPreferred }: Props) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<"solo" | "party">("solo");
  const showParty = kind === "party" && recs.party;
  const q = showParty ? recs.partyQ : recs.solo;
  const data = q.data;
  const meSlot = board.allies.find((s) => s.isMe) ?? null;
  const meMember = recs.members.find((m) => m.slot.isMe) ?? null;
  const preferredOnly = showParty
    ? recs.members.some((m) =>
        onlyPreferredFor(
          board,
          m.slot.isMe ? { kind: "me" } : { kind: "player", id: m.slot.playerId! },
          m.player,
        ),
      )
    : meMember
      ? onlyPreferredFor(board, { kind: "me" }, meMember.player)
      : false;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-lg font-bold">
          {showParty ? <UsersRound className="size-5 text-accent" /> : <Sparkles className="size-5 text-accent" />}
          {showParty ? t("pick.partyTitle", { n: recs.members.length }) : t("pick.personalTitle")}
        </h2>
        {/* 개인 추천: 이번 판 선호 영웅만 켜고 끄기 (파티 추천은 파티 바의 사람별 ★) */}
        {!showParty && meMember && (meMember.player?.heroes.length ?? 0) > 0 ? (
          <button
            type="button"
            aria-pressed={preferredOnly}
            onClick={() => onOnlyPreferred({ kind: "me" }, !preferredOnly)}
            title={preferredOnly ? t("pick.onlyPreferredToggle") : t("pick.onlyPreferredOff")}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition",
              preferredOnly ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2",
            )}
          >
            <Star className={cn("size-3", preferredOnly && "fill-current")} />
            {t("pick.preferredOnlyOn")}
          </button>
        ) : preferredOnly && (
          <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">
            {t("pick.preferredOnlyOn")}
          </span>
        )}
        {recs.party && (
          <Segmented
            label={t("pick.recKind")}
            value={kind}
            onChange={(v) => setKind(v as "solo" | "party")}
            options={[
              { value: "solo", label: t("pick.personalTab") },
              { value: "party", label: t("pick.partyTab") },
            ]}
          />
        )}
      </div>

      {!showParty && !meSlot && <p className="text-xs text-muted">{t("pick.noMeHint")}</p>}

      {data && (data.stats_fallback || !data.map_has_data) && (
        <p className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span className="flex flex-col gap-0.5">
            {data.stats_fallback && <span>{t("pick.statsFallback")}</span>}
            {!data.map_has_data && <span>{t("pick.mapNoData")}</span>}
          </span>
        </p>
      )}

      {q.error ? (
        <ErrorBox error={q.error} byId={byId} />
      ) : !data ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : showParty && "combos" in data ? (
        <PartyResults
          combos={data.combos}
          alternatives={data.alternatives}
          recs={recs}
          byId={byId}
          mapName={mapName}
          onApply={onApply}
        />
      ) : "recommendations" in data && data.recommendations.length ? (
        <ol className={cn("flex flex-col gap-2 transition-opacity", q.isFetching && "opacity-60")}>
          {data.recommendations.map((r, i) => (
            <RecCard
              key={r.hero_id}
              rank={i + 1}
              rec={r}
              byId={byId}
              mapName={mapName}
              current={meSlot?.hero === r.hero_id}
              onPick={() => meSlot && onApply([{ slotId: meSlot.id, hero: r.hero_id, role: r.role }])}
            />
          ))}
        </ol>
      ) : (
        <EmptyState title={t("pick.noCandidates")} description={t("pick.noCandidatesHint")} />
      )}
    </div>
  );
}

function RecCard({
  rank,
  rec,
  byId,
  mapName,
  current,
  onPick,
}: {
  rank: number;
  rec: Recommendation;
  byId: Map<string, Hero>;
  mapName?: string;
  current: boolean;
  onPick: () => void;
}) {
  const { t } = useTranslation();
  const hero = byId.get(rec.hero_id);
  return (
    <Card className={cn("flex gap-3 p-3", rank === 1 && "border-accent/50")}>
      <div className="flex flex-col items-center gap-1">
        <span className={cn("text-sm font-extrabold", rank === 1 ? "text-accent" : "text-muted")}>{rank}</span>
        <HeroAvatar hero={hero} size="lg" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold">{hero?.name ?? rec.hero_id}</span>
          <RoleIcon role={rec.role} className={ROLE_TEXT[rec.role]} />
          <TierBadge tier={rec.tier} />
          <span className="ml-auto text-xs text-muted tabular-nums">{rec.score.toFixed(2)}</span>
        </div>
        <ScoreBar parts={rec.parts} />
        <ReasonChips reasons={rec.reasons} heroes={byId} mapName={mapName} />
      </div>
      <Button
        size="sm"
        variant={current ? "primary" : "secondary"}
        className="w-14 justify-center self-center"
        onClick={onPick}
        aria-label={t("pick.pickThis", { hero: hero?.name })}
      >
        {current ? <Check className="size-4" /> : t("pick.pick")}
      </Button>
    </Card>
  );
}

function PartyResults({
  combos,
  alternatives,
  recs,
  byId,
  mapName,
  onApply,
}: {
  combos: PartyCombo[];
  alternatives: Record<string, Recommendation[]>;
  recs: Recs;
  byId: Map<string, Hero>;
  mapName?: string;
  onApply: Props["onApply"];
}) {
  const { t } = useTranslation();
  const label = (key: string) => {
    const m = recs.members.find((x) => x.slot.id === key);
    if (!m) return key;
    return m.slot.isMe ? t("pick.me") : (m.player?.name ?? t("pick.partyMemberUnknown"));
  };
  if (!combos.length) return <EmptyState title={t("pick.noCandidates")} description={t("pick.noCandidatesHint")} />;

  return (
    <div className={cn("flex flex-col gap-3", recs.partyQ.isFetching && "opacity-60")}>
      {combos.map((c, i) => (
        <Card key={i} className={cn("flex flex-col gap-2 p-3", i === 0 && "border-accent/50")}>
          <div className="flex items-center gap-2">
            <span className={cn("text-sm font-extrabold", i === 0 ? "text-accent" : "text-muted")}>
              {t("pick.comboN", { n: i + 1 })}
            </span>
            {c.synergies.map(([a, b]) => (
              <span key={a + b} className="inline-flex items-center gap-1 rounded-md bg-good/12 px-1.5 py-0.5 text-xs text-good">
                <Link2 className="size-3" />
                {byId.get(a)?.name} + {byId.get(b)?.name}
              </span>
            ))}
            <span className="ml-auto text-xs text-muted tabular-nums">{c.score.toFixed(2)}</span>
            <Button size="sm" onClick={() => onApply(c.picks.map((p) => ({ slotId: p.member, hero: p.hero_id, role: p.role })))}>
              {t("pick.apply")}
            </Button>
          </div>
          <ul className="flex flex-col gap-2">
            {c.picks.map((p) => (
              <li key={p.member} className="flex gap-2.5">
                <HeroAvatar hero={byId.get(p.hero_id)} size="md" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center gap-1.5 text-sm">
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold">{label(p.member)}</span>
                    <span className="truncate font-semibold">{byId.get(p.hero_id)?.name}</span>
                    <RoleIcon role={p.role} className={ROLE_TEXT[p.role]} />
                    <TierBadge tier={p.tier} />
                  </div>
                  <ReasonChips reasons={p.reasons} heroes={byId} mapName={mapName} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ))}

      <Card className="flex flex-col gap-2 p-3">
        <h3 className="text-sm font-semibold">{t("pick.alternatives")}</h3>
        {Object.entries(alternatives).map(([key, alts]) => (
          <div key={key} className="flex items-center gap-2">
            <span className="w-20 shrink-0 truncate text-xs font-semibold text-muted">{label(key)}</span>
            <div className="flex flex-wrap gap-1">
              {alts.map((a) => (
                <button
                  key={a.hero_id}
                  type="button"
                  title={byId.get(a.hero_id)?.name}
                  onClick={() => onApply([{ slotId: key, hero: a.hero_id, role: a.role }])}
                  className="rounded-lg p-0.5 hover:bg-surface-2"
                >
                  <HeroAvatar hero={byId.get(a.hero_id)} size="sm" />
                </button>
              ))}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

export function ErrorBox({ error, byId }: { error: Error; byId: Map<string, Hero> }) {
  const { t } = useTranslation();
  const e = error instanceof ApiError ? error : null;
  if (isNoData(e)) return <NoDataState />;
  const params = { ...e?.params } as Record<string, string | number>;
  if (typeof params.role === "string") params.role = t(`roles.${params.role}`);
  if (typeof params.team === "string") params.team = t(`pick.${params.team}`);
  if (typeof params.hero === "string") params.hero = byId.get(params.hero)?.name ?? params.hero;
  return (
    <p className="flex items-start gap-2 rounded-lg border border-bad/40 bg-enemy-soft px-3 py-2 text-sm text-bad">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      {t(`errors.${e?.code ?? "unknown"}`, { ...params, defaultValue: t("errors.unknown") })}
    </p>
  );
}
