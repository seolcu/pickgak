import { ChevronDown, RotateCcw, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { FilterBar } from "../../components/FilterBar";
import { HeroAvatar } from "../../components/HeroAvatar";
import { Button } from "../../components/ui/Button";
import { ButtonLink } from "../../components/ui/Button";
import { Skeleton } from "../../components/ui/misc";
import { Segmented } from "../../components/ui/Segmented";
import { useConfig, useHeroes, useMaps, usePlayers, useSavePlayer } from "../../hooks/data";
import { usePrefs } from "../../hooks/prefs";
import { type AppConfig, type Player, type QueueId, type Role } from "../../lib/api";
import { loadLocal, saveLocal } from "../../lib/storage";
import {
  BOARD_KEY,
  addMember,
  applyPicks,
  banRulesFor,
  assignRole,
  heroCount,
  inBanPhase,
  isCompatible,
  newBoard,
  newMatch,
  pickForMe,
  placeHero,
  removeMember,
  sanitize,
  setLobbyBan,
  setOnlyPreferred,
  swapSlots,
  switchQueue,
  toggleAllyWant,
  toggleBan,
  toggleThreat,
  updateSlot,
  whyDisabled,
  type Board,
  type Slot,
  type Target,
  type Team,
} from "./board";
import { BanRow } from "./BanRow";
import { PartyPanel } from "./PartyPanel";
import { HeroInput } from "./HeroInput";
import { RecommendationPanel, type RecTab } from "./RecommendationPanel";
import { TeamRow } from "./TeamRow";
import { useBoardHistory } from "./useBoardHistory";
import { useRecommendations } from "./useRecommendations";
import { rankLabel } from "../../lib/ranks";
import { AppBanner } from "../download/AppBanner";
import { LiveBar, MATCH_START_KEY, NAME_UNDO_KEY, type Capture } from "../live/LiveBar";
import { BoardSummary } from "./BoardSummary";
import { PartyMatchCard, type PartyNeed } from "./PartyMatchCard";
import { OverlayPreview } from "./OverlayPreview";
import { HOME_LAYOUT_KEY, type HomeLayout } from "./homeLayout";
import { applyCapture, partyKey, type AutoMode, type Seen } from "../live/applyCapture";
import { NO_AUTO_QUEUE, type AutoQueue } from "../live/autoQueue";
import { invoke, isDesktop } from "../../lib/platform";
import { useSyncPlayers } from "../live/useSyncPlayers";
import { useSyncMaps } from "../live/useSyncMaps";

function initialBoard(config: AppConfig, me: Player | null): Board {
  const saved = loadLocal<Board | null>(BOARD_KEY, null);
  if (saved && isCompatible(saved, config.queues[saved.queue])) return saved;
  const def = (Object.keys(config.queues) as QueueId[]).find((k) => config.queues[k].default) ?? "role_queue";
  return newBoard(def, config.queues[def], undefined, me);
}

export function PickPage() {
  const config = useConfig().data;
  const players = usePlayers();
  const heroes = useHeroes();
  const [params] = useSearchParams();
  // 처음 판을 만들 때 내 선호 역할 자리에 '나'를 두려면 프로필(과 영웅 목록)까지 받아 와야 한다
  if (!config || !players.isFetched || !heroes.isFetched) {
    return (
      <div className="mx-auto grid w-full max-w-[1440px] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(380px,500px)]">
        <Skeleton className="h-[36rem]" />
        <Skeleton className="h-[36rem]" />
      </div>
    );
  }
  return <PickBoard config={config} initialMe={players.me} initialPick={params.get("pick")} />;
}

const typing = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

function PickBoard({
  config,
  initialMe,
  initialPick,
}: {
  config: AppConfig;
  initialMe: Player | null;
  initialPick: string | null;
}) {
  const { t } = useTranslation();
  const { filters, setFilters, query, map, setMap } = usePrefs();
  const [layout] = useState<HomeLayout>(() => loadLocal(HOME_LAYOUT_KEY, "board"));
  const [editing, setEditing] = useState(false);
  /** 이름이 제안된 파티 줄 (카드로 바로 확인) */
  const [partyNeeds, setPartyNeeds] = useState<PartyNeed[]>([]);
  /** 아직 누구인지 모르는 파티 줄 전부 (수동 확인 버튼으로 연다) */
  const [allPartyNeeds, setAllPartyNeeds] = useState<PartyNeed[]>([]);
  const [showParty, setShowParty] = useState(false);
  /** "나중에"를 고른 줄 (이번 판에서는 다시 묻지 않는다) */
  const dismissedParty = useRef<Set<string>>(new Set());
  const { heroes, byId, isSuccess: heroesReady } = useHeroes();
  const maps = useMaps(query).data ?? [];
  useSyncMaps(maps, maps.length > 0);
  const { players, me, isSuccess: playersReady } = usePlayers();
  useSyncPlayers(players, playersReady);
  const savePlayer = useSavePlayer();
  const [params, setParams] = useSearchParams();
  // 영웅 상세에서 '/?pick=영웅'으로 오면 처음 판에 내 자리 영웅으로 넣는다
  const { board, setBoard, undo, canUndo } = useBoardHistory(() => {
    const b = initialBoard(config, initialMe);
    const h = initialPick ? byId.get(initialPick) : undefined;
    return h ? pickForMe(b, h.hero_id, h.role) : b;
  });
  // 주소의 ?pick=은 한 번 쓰고 지운다 (새로고침해도 다시 적용되지 않게)
  useEffect(() => {
    if (params.has("pick")) setParams({}, { replace: true });
  }, [params, setParams]);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  /** 마지막으로 본 TAB 화면 (바뀐 것만 판에 반영하려고) */
  const seen = useRef<Seen | null>(null);
  /** 이번 판에서 TAB 화면으로 자동 판단한 통계 모드 */
  const autoMode = useRef<AutoMode>({ match: 0, set: null, locked: false });
  /** TAB 화면으로 자동 판단한 대기열 (훈련장·인공지능전은 기타, 6대6은 자유) */
  const autoQueue = useRef<AutoQueue>(NO_AUTO_QUEUE);
  /** 사용자가 직접 끈 양학 의심 줄. 그 판에서는 다시 자동 표시하지 않는다 */
  const dismissedSmurfs = useRef<Set<number>>(new Set());

  useEffect(() => saveLocal(BOARD_KEY, board), [board]);

  // 오버레이에서 이름 확인을 되돌리면 그 사람의 자동 지정을 푼다 (직접 고른 사람은 그대로)
  useEffect(() => {
    const on = (e: StorageEvent) => {
      if (e.key !== NAME_UNDO_KEY) return;
      const undone = loadLocal<{ player: number } | null>(NAME_UNDO_KEY, null);
      if (!undone) return;
      let next = board;
      for (const s of board.allies) {
        if (s.playerAuto && s.playerId === undone.player) {
          next = updateSlot(next, "allies", s.id, { playerId: null, playerAuto: false });
        }
      }
      if (next !== board) setBoard(next);
    };
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, [board, setBoard]);

  // 지워진 플레이어·영웅을 가리키는 슬롯은 비워서 보여준다 (렌더 중 파생, 상태는 그대로)
  const view = useMemo(
    () =>
      sanitize(
        board,
        heroesReady ? new Set(byId.keys()) : null,
        playersReady ? new Set(players.map((p) => p.id)) : null,
      ),
    [board, byId, heroesReady, players, playersReady],
  );

  const bansActive = config.bans.modes.includes(query.rq);
  const banRules = bansActive ? banRulesFor(config.bans, !!view.lobbyBan) : null;
  const recs = useRecommendations(view, players, me, query, map, heroesReady && playersReady, bansActive);
  const banPhase = inBanPhase(view, banRules);
  const teamComps = (recs.party ? recs.partyQ.data : recs.solo.data)?.comps;

  // 입력 대상·추천 탭: 사용자가 고르지 않았으면 밴 단계엔 '금지'/'밴 추천', 아니면 '상대'/'픽 추천'
  const [targetPick, setTargetPick] = useState<Target | null>(null);
  const [tabPick, setTabPick] = useState<RecTab | null>(null);
  const target: Target = targetPick === "bans" && !banRules ? "enemies" : (targetPick ?? (banPhase ? "bans" : "enemies"));
  const tab: RecTab = tabPick ?? (banPhase ? "ban" : "pick");
  // 칸을 골라 둔 상태, 역할 자리가 다 차서 바꿀 칸을 기다리는 영웅
  const [focus, setFocus] = useState<{ team: Team; id: string } | null>(null);
  const [pending, setPending] = useState<{ team: Team; hero: string } | null>(null);
  const focusSlot = focus && focus.team === target ? (view[focus.team].find((s) => s.id === focus.id) ?? null) : null;
  const pendingHere = pending && pending.team === target ? pending.hero : null;

  const resetInput = () => {
    setFocus(null);
    setPending(null);
  };
  const changeTarget = (next: Target) => {
    setTargetPick(next);
    resetInput();
  };

  const roleOfHero = (h: string) => byId.get(h)?.role;
  const canBan = (hero: string) => {
    const h = byId.get(hero);
    return !!h && !whyDisabled(view, "bans", hero, h.role, roleOfHero, banRules);
  };
  const ban = (hero: string) => {
    if (!canBan(hero)) return;
    const next = toggleBan(view, hero);
    setBoard(next);
    // 금지 칸이 다 차면 입력 대상은 자동(상대 팀)으로
    if (banRules && next.bans.length >= banRules.total && targetPick === "bans") setTargetPick(null);
  };

  const onHero = (hero: string) => {
    const h = byId.get(hero);
    if (!h) return;
    if (target === "bans") return ban(hero);
    const r = placeHero(view, target, hero, h.role, focusSlot?.id);
    if ("ask" in r) return setPending({ team: target, hero });
    setBoard(r.board);
    resetInput();
  };

  const onSlot = (team: Team, slot: Slot) => {
    const role = pending ? roleOfHero(pending.hero) : undefined;
    if (pending && pending.team === team && role && slot.role === role) {
      const r = placeHero(view, team, pending.hero, role, slot.id);
      if ("board" in r) setBoard(r.board);
      return resetInput();
    }
    setPending(null);
    if (focus?.id === slot.id) return setFocus(null);
    setFocus({ team, id: slot.id });
    setTargetPick(team);
    // 넓은 화면은 검색칸으로, 좁은 화면은 키보드를 띄우지 않고 입력판으로 스크롤
    if (window.matchMedia("(min-width: 1024px)").matches) searchRef.current?.focus({ preventScroll: true });
    else searchRef.current?.closest("section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  /** 새 판: 판을 비우고 전장도 다시 고르게 한다. TAB 화면은 처음부터 다시 반영한다 */
  const resetForNewMatch = (start = Date.now()) => {
    seen.current = null;
    dismissedSmurfs.current.clear();
    dismissedParty.current.clear();
    setShowParty(false);
    setMap("all");
    saveLocal(MATCH_START_KEY, start);
    setTargetPick(null);
    setTabPick(null);
    resetInput();
    return newMatch(view);
  };

  const startNewMatch = () => {
    const prevMap = map;
    setBoard(resetForNewMatch());
    toast(t("pick.newMatchDone"), {
      action: {
        label: t("pick.undo"),
        onClick: () => {
          undo();
          setMap(prevMap);
        },
      },
    });
  };

  const changeQueue = (q: QueueId) => {
    const next = switchQueue(view, q, config.queues[q], byId, players);
    setBoard(next);
    resetInput();
    const dropped = heroCount(view) - heroCount(next);
    if (dropped > 0) toast(t("pick.queueDropped", { n: dropped }), { action: { label: t("pick.undo"), onClick: undo } });
  };

  const createFriend = (name: string, role: Role | null) =>
    savePlayer.mutate(
      { data: { name, is_me: false, preferred_roles: role ? [role] : [], heroes: [], only_preferred: false } },
      {
        onSuccess: (p) => setBoard(addMember(view, { kind: "player", id: p.id }, role, p.preferred_roles)),
        onError: () => toast.error(t("errors.unknown")),
      },
    );

  // 단축키: Ctrl+Z 되돌리기, '/' 검색, Alt+1·2·3 입력 대상, Esc 고른 칸 해제
  const targets: Target[] = banRules ? ["enemies", "allies", "bans"] : ["enemies", "allies"];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z" && !typing(e)) {
        e.preventDefault();
        undo();
      } else if (e.key === "/" && !typing(e)) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.altKey && /^[1-3]$/.test(e.key)) {
        const next = targets[Number(e.key) - 1];
        if (next) {
          e.preventDefault();
          setTargetPick(next);
          setFocus(null);
          setPending(null);
        }
      } else if (e.key === "Escape" && !typing(e)) {
        setFocus(null);
        setPending(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const mapName = maps.find((m) => m.map_id === map)?.name;
  const top = recs.party ? recs.partyQ.data?.combos[0]?.picks[0] : recs.solo.data?.recommendations[0];

  const queueOptions = (Object.keys(config.queues) as QueueId[]).map((id) => ({
    value: id,
    label: t(`queues.${id}`, { size: config.queues[id].team_size }),
    title: t(`queues.${id}_hint`),
  }));
  const askRole = pending ? (roleOfHero(pending.hero) ?? null) : null;

  const editor = (
        <div className="flex min-w-0 flex-col gap-2.5">
          <PartyPanel
            board={view}
            byId={byId}
            players={players}
            me={me}
            onRole={(p, role) => setBoard(assignRole(view, p, role))}
            onAdd={(p, role, preferred) => setBoard(addMember(view, p, role, preferred))}
            onRemove={(id) => setBoard(removeMember(view, id))}
            onOnlyPreferred={(p, v) => setBoard(setOnlyPreferred(view, p, v))}
            onCreate={createFriend}
          />

          {banRules && (
            <BanRow
              rules={config.bans}
              total={banRules.total}
              lobbyBan={!!view.lobbyBan}
              onLobbyBan={(on) => setBoard(setLobbyBan(view, on, config.bans, roleOfHero))}
              bans={view.bans}
              byId={byId}
              suggestions={recs.bans.data?.recommendations ?? []}
              canBan={canBan}
              active={target === "bans"}
              onRemove={(h) => setBoard(toggleBan(view, h))}
              onBan={ban}
              onFocus={() => changeTarget("bans")}
            />
          )}

          {(["allies", "enemies"] as const).map((team) => (
            <TeamRow
              key={team}
              team={team}
              slots={view[team]}
              byId={byId}
              players={players}
              me={me}
              focusId={focus?.team === team ? focus.id : null}
              askRole={pending?.team === team ? askRole : null}
              onSlot={(s) => onSlot(team, s)}
              onClearSlot={(s) => setBoard(updateSlot(view, team, s.id, { hero: null }))}
              onSwap={(a, b) => setBoard(swapSlots(view, team, a.id, b.id))}
              onThreat={
                team === "enemies"
                  ? (s) => {
                      const i = view.enemies.findIndex((x) => x.id === s.id);
                      if (s.threat) dismissedSmurfs.current.add(i);
                      else dismissedSmurfs.current.delete(i);
                      setBoard(toggleThreat(view, s.id));
                    }
                  : undefined
              }
              comp={teamComps?.[team] ?? null}
            />
          ))}

          <HeroInput
            ref={searchRef}
            board={view}
            heroes={heroes}
            byId={byId}
            target={target}
            onTarget={changeTarget}
            bans={banRules}
            focus={focusSlot}
            pending={pendingHere}
            onPick={onHero}
            onCancel={resetInput}
          />
        </div>
  );

  const summary = (
    <BoardSummary
      board={view}
      byId={byId}
      players={players}
      me={me}
      bansActive={bansActive}
      editing={editing}
      onEdit={() => setEditing((v) => !v)}
    />
  );

  const recsPanel = (
        <div
          ref={panelRef}
          className="scroll-mt-20 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-9.5rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1"
        >
          <RecommendationPanel
            recs={recs}
            board={view}
            byId={byId}
            mapName={mapName}
            bansActive={bansActive}
            tab={tab}
            onTab={setTabPick}
            onBan={ban}
            onAllyWant={(hero) => setBoard(toggleAllyWant(view, hero))}
            onApply={(picks) => setBoard(applyPicks(view, picks))}
            onOnlyPreferred={(p, v) => setBoard(setOnlyPreferred(view, p, v))}
          />
        </div>
  );

  const overlay = config ? (
    <OverlayPreview recs={recs} board={view} byId={byId} config={config} bansActive={bansActive} mapName={mapName ?? null} />
  ) : null;

  return (
    // 왼쪽: 입력(파티·금지·두 팀·영웅 입력판), 오른쪽: 추천. 1440×900에서 스크롤 없이 한 화면
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-3">
      <AppBanner />
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label={t("pick.queue")} value={view.queue} onChange={changeQueue} options={queueOptions} />
          <Button variant="ghost" size="sm" onClick={startNewMatch} title={t("pick.resetHint")}>
            <RotateCcw className="size-3.5" />
            {t("pick.reset")}
          </Button>
          <Button variant="ghost" size="sm" onClick={undo} disabled={!canUndo} title={t("pick.undoHint")} aria-label={t("pick.undo")}>
            <Undo2 className="size-3.5" />
            <span className="hidden sm:inline">{t("pick.undo")}</span>
          </Button>
        </div>
        <FilterBar />
      </div>

      {isDesktop && (
        <LiveBar
          heroes={heroes}
          byId={byId}
          onReading={(c: Capture) => {
            const r = applyCapture(c, {
              board: view,
              seen: seen.current,
              map,
              filters,
              config,
              bansActive,
              roleOf: (h) => byId.get(h)?.role,
              autoMode: autoMode.current,
              autoQueue: autoQueue.current,
              switchQueue: (b, q) => switchQueue(b, q, config.queues[q], byId, players),
              matchStart: loadLocal(MATCH_START_KEY, 0),
              now: Date.now(),
              dismissedSmurfs: dismissedSmurfs.current,
              dismissedParty: dismissedParty.current,
            });
            if (r.newMatch) {
              const prevMap = map;
              resetForNewMatch(r.matchStart);
              toast(t("pick.autoNewMatch"), {
                action: {
                  label: t("pick.undo"),
                  onClick: () => {
                    undo();
                    setMap(prevMap);
                  },
                },
              });
            }
            seen.current = r.seen;
            autoMode.current = r.autoMode;
            autoQueue.current = r.autoQueue;
            if (r.queueSet) {
              const queue = t(`queues.${r.queueSet}`, { size: config.queues[r.queueSet].team_size });
              toast(t("live.queueSet", { queue }), { id: "live-queue", action: { label: t("pick.undo"), onClick: undo } });
            }
            if (r.map) {
              setMap(r.map);
              if (!r.newMatch) toast(t("live.mapSet", { map: maps.find((m) => m.map_id === r.map)?.name ?? r.map }), { id: "live-map" });
            }
            if (r.filters) {
              setFilters(r.filters);
              if (r.filterNote === "rankSet") toast(t("live.rankSet", { rank: rankLabel(r.filters.rank, t) }), { id: "live-rank" });
              else if (r.filterNote) toast(t(`live.${r.filterNote}`), { id: "live-mode" });
            }
            setAllPartyNeeds(r.partyNeeds);
            setPartyNeeds(r.partyNeeds.filter((n) => n.suggestion));
            if (!r.changed) return;
            setBoard(r.board);
            if (r.filled && !r.newMatch) toast(t("live.filled", { n: r.filled }), { id: "live-fill", action: { label: t("pick.undo"), onClick: undo } });
          }}
        />
      )}

      {isDesktop && allPartyNeeds.length > 0 && !partyNeeds.length && !showParty && (
        <button
          type="button"
          onClick={() => setShowParty(true)}
          className="self-start rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium hover:bg-surface-2"
        >
          {t("live.partyCheck", { n: allPartyNeeds.length })}
        </button>
      )}

      {isDesktop && (partyNeeds.length > 0 || (showParty && allPartyNeeds.length > 0)) && (
        <PartyMatchCard
          needs={showParty ? allPartyNeeds : partyNeeds}
          players={players.filter((p) => p.id !== me?.id)}
          byId={byId}
          onPick={async (need, playerId) => {
            await invoke("live_confirm_name", {
              captureId: need.captureId,
              row: need.row,
              playerId,
            }).catch(() => {});
            setBoard(updateSlot(view, "allies", need.slotId, { playerId, playerAuto: true }));
            setAllPartyNeeds((n) => n.filter((x) => x.slotId !== need.slotId));
            setPartyNeeds((n) => n.filter((x) => x.slotId !== need.slotId));
          }}
          onReject={async (need) => {
            await invoke("live_reject_name", { captureId: need.captureId, row: need.row }).catch(() => {});
            dismissedParty.current.add(partyKey(need));
            setAllPartyNeeds((n) => n.filter((x) => x.slotId !== need.slotId));
            setPartyNeeds((n) => n.filter((x) => x.slotId !== need.slotId));
          }}
          onSkip={() => {
            for (const n of allPartyNeeds) {
              dismissedParty.current.add(partyKey(n));
            }
            setPartyNeeds([]);
            setAllPartyNeeds([]);
            setShowParty(false);
          }}
        />
      )}

      {isDesktop && !me && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-accent/40 bg-accent-soft px-3 py-2 text-sm">
          <span className="font-semibold">{t("pick.startTitle")}</span>
          <span className="min-w-0 flex-1 text-muted">{t("pick.startHint")}</span>
          <ButtonLink to="/players" size="sm">
            {t("pick.startProfile")}
          </ButtonLink>
        </div>
      )}

      {isDesktop ? (
        layout === "coach" ? (
          <div className="flex flex-col gap-4">
            {recsPanel}
            <div className="flex flex-col gap-2.5">
              {summary}
              {editing && <div className="rounded-xl border border-dashed border-border bg-surface p-3">{editor}</div>}
            </div>
          </div>
        ) : layout === "hub" ? (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
            <div className="flex flex-col gap-4">
              {overlay}
              {summary}
              {editing && <div className="rounded-xl border border-dashed border-border bg-surface p-3">{editor}</div>}
            </div>
            {recsPanel}
          </div>
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(380px,500px)]">
            <div className="flex min-w-0 flex-col gap-2.5">
              {summary}
              {editing && <div className="rounded-xl border border-dashed border-border bg-surface p-3">{editor}</div>}
            </div>
            {recsPanel}
          </div>
        )
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(380px,500px)]">
          {editor}
          {recsPanel}
        </div>
      )}

      {/* 모바일: 맨 위 추천을 바닥에 띄워 두고 누르면 추천 영역으로 이동 */}
      {top && (
        <button
          type="button"
          onClick={() => panelRef.current?.scrollIntoView({ behavior: "smooth" })}
          className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex items-center gap-3 rounded-xl border border-border bg-surface/95 p-2 pr-3 shadow-card backdrop-blur lg:hidden"
        >
          <HeroAvatar hero={byId.get(top.hero_id)} size="sm" />
          <span className="flex-1 text-left text-sm">
            <span className="text-muted">{t("pick.topPick")} </span>
            <span className="font-semibold">{byId.get(top.hero_id)?.name}</span>
          </span>
          <ChevronDown className="size-4 text-muted" />
        </button>
      )}
    </div>
  );
}
