import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Ban, Check, Flame, Star, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { HeroAvatar } from "../../components/HeroAvatar";
import { RoleIcon } from "../../components/RoleIcon";
import { ROLE_TEXT, TierBadge } from "../../components/ui/misc";
import { useConfig, useHeroes, useMaps, usePlayers } from "../../hooks/data";
import { PrefsProvider, usePrefs } from "../../hooks/prefs";
import { invoke, listen } from "../../lib/platform";
import { cn } from "../../lib/cn";
import { loadLocal } from "../../lib/storage";
import { BanReasons, VOTE_PICKS } from "../pick/BanPanel";
import { ReasonChips } from "../pick/Reasons";
import { ThemeProvider } from "../../theme/ThemeProvider";
import { inBanPhase, isCompatible, onlyPreferredFor, preferredBy, type Board } from "../pick/board";
import { useRecommendations } from "../pick/useRecommendations";
import { MATCH_START_KEY, OVERLAY_LOCKED_KEY, type Capture, type NameMatch } from "./LiveBar";
import { PartyAsk } from "./PartyAsk";
import { useLiveCapture } from "./useLiveCapture";
import { useSyncPlayers } from "./useSyncPlayers";
import { useSyncMaps } from "./useSyncMaps";

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 30_000 } } });
const BOARD_KEY = "pickgak.board";
/** 오버레이를 TAB을 누르고 있는 동안만 보여 주기 (메인 창에서 켜고 끈다) */
export const TAB_ONLY_KEY = "pickgak.overlay.tabOnly";
/** "나중에"를 고른 이름. 판이 바뀌면 지운다 */
const dismissedNames = new Set<string>();
/** 질문이 답 없이 오래 떠 있으면 클릭 통과로 돌려놓는다 */
const ASK_IDLE_MS = 30_000;

interface Ask {
  captureId: number;
  row: number;
  hero: string;
  crop: string | null;
  /** null: 이름을 읽었지만 등록된 이름과 맞는 게 없어서, 목록에서 고르게 묻는다 */
  suggestion: NameMatch | null;
  /** "나중에"를 기억하는 키 */
  key: string;
}

/**
 * 게임 위에 띄우는 작은 창 (데스크톱 앱). 메인 창이 저장한 판·필터와 마지막 TAB 읽기를 함께 본다.
 * 추천·금지뿐 아니라 파티 상태, 조합, 금지 목록까지 보여 주고, 처음 보는 파티원 이름만 여기서 묻는다.
 * 질문이 없을 때는 창 전체가 클릭을 게임으로 통과시킨다.
 */
export function OverlayApp() {
  const [tabOnly, setTabOnly] = useState(() => loadLocal(TAB_ONLY_KEY, false));
  const [tab, setTab] = useState(false);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    document.documentElement.classList.add("overlay");
    const on = (e: StorageEvent) => {
      if (e.key === TAB_ONLY_KEY) setTabOnly(loadLocal(TAB_ONLY_KEY, false));
      if (e.key === MATCH_START_KEY) dismissedNames.clear();
    };
    window.addEventListener("storage", on);
    let off: (() => void) | undefined;
    let alive = true;
    listen<boolean>("live://tab", setTab).then((f) => (alive ? (off = f) : f()));
    return () => {
      alive = false;
      off?.();
      window.removeEventListener("storage", on);
    };
  }, []);
  return (
    <div style={{ visibility: tabOnly && !tab && !asking ? "hidden" : "visible" }}>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <PrefsProvider>
            <OverlayBody onAsking={setAsking} />
          </PrefsProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </div>
  );
}

/** 이름으로 자동 지정된 줄이 아니라, 아직 확인해야 하는 파티 줄 하나 */
function findAsk(
  capture: Capture | null,
  board: Board | null,
  now: number,
): Ask | null {
  if (!capture || !board || !capture.scoreboard) return null;
  // 앱을 다시 켰을 때 지난 판의 이름을 묻지 않는다
  if (now - capture.at > 2 * 60 * 1000) return null;
  const party = capture.debug.party ?? [];
  for (let row = 0; row < capture.rows.length; row++) {
    const r = capture.rows[row];
    if (r.team !== "ally" || row === capture.me || !party[row]) continue;
    if (!r.label || r.label.startsWith("__") || r.name?.known) continue;
    // 제안이 없으면 이름 비교(OCR 포함)를 끝낸 줄만 묻는다. OCR 중에 물으면 곧 올 제안을 가로막는다.
    // OCR이 못 읽는 글꼴(영문 대문자 이름)은 여기서 한 번 알려 주면 그 이름 이미지를 기억한다
    if (!r.name && !(r.name_tried && r.name_crop)) continue;
    const slot = board.allies.find((s) => s.hero === r.label && !s.isMe);
    if (!slot) continue;
    // 이미 사람이 정해진 자리는 묻지 않는다 (이름이 다른 사람을 가리키면 메인 창이 지정을 먼저 푼다)
    if (slot.playerId !== null) continue;
    // One answer per registered player, not per hero: a party member changes heroes between
    // matches, and the question must not come back just because the hero changed.
    const key = r.name ? `p${r.name.player}` : `h${r.label}`;
    if (dismissedNames.has(key)) continue;
    return {
      captureId: capture.id,
      row,
      hero: r.label,
      crop: r.name_crop,
      suggestion: r.name,
      key,
    };
  }
  return null;
}

function OverlayBody({ onAsking }: { onAsking: (v: boolean) => void }) {
  const { t } = useTranslation();
  const config = useConfig().data;
  const { query, map } = usePrefs();
  const { byId, isSuccess: heroesReady } = useHeroes();
  const { players, me, isSuccess: playersReady } = usePlayers();
  useSyncPlayers(players, playersReady);
  const maps = useMaps(query).data ?? [];
  useSyncMaps(maps, maps.length > 0);
  const capture = useLiveCapture();
  const [board, setBoard] = useState<Board | null>(() => loadLocal<Board | null>(BOARD_KEY, null));
  const [ask, setAsk] = useState<Ask | null>(null);
  const askTimer = useRef<number | null>(null);
  // 오버레이는 클릭이 게임으로 통과해서 휠로 스크롤할 수 없다. 내용 높이에 맞춰 창을 늘린다.
  const fitObserver = useRef<ResizeObserver | null>(null);
  const fitContent = useCallback((el: HTMLDivElement | null) => {
    fitObserver.current?.disconnect();
    if (!el) return;
    const fit = () => invoke("overlay_fit", { height: el.offsetHeight + 28 }).catch(() => {});
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fitObserver.current = ro;
  }, []);
  useEffect(() => () => fitObserver.current?.disconnect(), []);

  // 메인 창이 저장한 판을 따라간다 (오버레이는 판을 쓰지 않는다)
  useEffect(() => {
    const on = (e: StorageEvent) => {
      if (e.key === BOARD_KEY) setBoard(loadLocal<Board | null>(BOARD_KEY, null));
      if (e.key === MATCH_START_KEY) dismissedNames.clear();
    };
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, []);

  const valid = config && board && isCompatible(board, config.queues[board.queue]) ? board : null;
  const bansActive = !!config?.bans.modes.includes(query.rq);
  const recs = useRecommendations(
    valid ?? ({ queue: "role_queue", allies: [], enemies: [], bans: [], preferredOnly: false } as unknown as Board),
    players,
    me,
    query,
    map,
    !!valid && heroesReady && playersReady,
    bansActive,
  );

  // 질문은 한 번에 하나. 답하거나 "나중에"를 고르면 다시 묻지 않는다.
  useEffect(() => {
    if (ask) return;
    const next = findAsk(capture, valid, Date.now());
    if (next) {
      dismissedNames.add(next.key);
      // The question is derived from a new capture or board write, not from render state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAsk(next);
    }
  }, [capture, valid, ask]);

  // 질문이 떠 있는 동안만 마우스를 받고, 끝나면 원래 클릭 통과 상태로 돌린다.
  useEffect(() => {
    if (!ask) return;
    const locked = loadLocal(OVERLAY_LOCKED_KEY, true);
    invoke("overlay_set", { visible: true, locked: false, asking: true }).catch(() => {});
    onAsking(true);
    askTimer.current = window.setTimeout(() => setAsk(null), ASK_IDLE_MS);
    return () => {
      if (askTimer.current !== null) window.clearTimeout(askTimer.current);
      invoke("overlay_set", { visible: true, locked, asking: true }).catch(() => {});
      onAsking(false);
    };
  }, [ask, onAsking]);

  if (!config || !valid) {
    return (
      <Panel contentRef={fitContent} header={<Header title={t("live.overlayEmpty")} />}>
        {null}
      </Panel>
    );
  }
  const boardNow = valid;
  const banPhase = inBanPhase(boardNow, bansActive ? config.bans : null);
  // The main window shows every recommendation and every combo; the overlay used to cut them to
  // three and one, which made the same board look different in the two places.
  const soloPicks = recs.solo.data?.recommendations ?? [];
  const combos = recs.partyQ.data?.combos ?? [];
  const banList = recs.bans.data?.recommendations ?? [];
  const meSlot = boardNow.allies.find((s) => s.isMe) ?? null;
  // Respect the per-player "preferred only" setting; the overlay used to ignore it, which made the
  // same board show a different list than the main window.
  const meOnly = meSlot ? onlyPreferredFor(boardNow, { kind: "me" }, me) : false;
  const partyOnly = recs.members.some((m) =>
    !m.slot.isMe &&
    onlyPreferredFor(boardNow, { kind: "player", id: m.slot.playerId! }, m.player),
  );
  const memberName = (key: string) => {
    const m = recs.members.find((x) => x.slot.id === key);
    if (!m) return t("pick.partyMemberUnknown");
    return m.slot.isMe ? t("pick.me") : (m.player?.name ?? t("pick.partyMemberUnknown"));
  };
  const threats = boardNow.enemies.filter((s) => s.threat && s.hero).map((s) => s.hero!);
  // The recommendations were requested for this map; showing the last capture's map here made the
  // reasons and the header disagree. The whole map is what the app shows too.
  const mapName = maps.find((m) => m.map_id === map)?.name;
  const dataNotice = [
    recs.solo.data?.stats_fallback ? t("pick.statsFallback") : null,
    recs.solo.data && !recs.solo.data.map_has_data ? t("pick.mapNoData") : null,
  ].filter((x): x is string => !!x);
  const heroName = (id: string) => byId.get(id)?.name ?? id;

  const partyRows = capture?.debug.party.filter(Boolean).length ?? 0;
  const partyNames = boardNow.allies
    .filter((s) => !s.isMe && s.playerId !== null)
    .map((s) => players.find((p) => p.id === s.playerId)?.name)
    .filter((n): n is string => !!n);
  const unknownParty =
    (capture?.rows ?? []).filter(
      (r, i) =>
        r.team === "ally" &&
        i !== capture?.me &&
        (capture?.debug.party[i] ?? false) &&
        (!r.name || !r.name.known),
    ).length;
  const bans = boardNow.bans.map((h) => byId.get(h)).filter(Boolean);
  const roleCount = (team: "allies" | "enemies") => {
    const n = { tank: 0, damage: 0, support: 0 };
    for (const s of boardNow[team]) {
      const role = s.hero ? byId.get(s.hero)?.role : undefined;
      if (role) n[role]++;
    }
    return n;
  };
  const allyRoles = roleCount("allies");
  const enemyRoles = roleCount("enemies");

  return (
    <Panel
      contentRef={fitContent}
      header={
        <Header
          title={banPhase ? t("bans.tabBan") : t("bans.tabPick")}
          right={mapName ?? t("filters.allMaps")}
        />
      }
    >
      {ask && (
        <PartyAsk
          key={`${ask.captureId}:${ask.row}`}
          captureId={ask.captureId}
          row={ask.row}
          heroName={heroName(ask.hero)}
          crop={ask.crop}
          suggestion={ask.suggestion}
          players={players.filter((p) => p.id !== me?.id && !p.is_me)}
          onDone={() => setAsk(null)}
        />
      )}

      {(partyRows > 0 || partyNames.length > 0) && (
        <p className="flex min-w-0 items-center gap-1 text-[11px] text-white/70">
          <Users className="size-3.5 shrink-0 text-good" />
          <span className="shrink-0">{t("live.partyDetected", { n: partyRows || partyNames.length })}</span>
          {partyNames.length > 0 && (
            <span className="truncate text-white/45">· {partyNames.join(", ")}</span>
          )}
          {unknownParty > 0 && (
            <span className="ml-auto shrink-0 rounded bg-white/10 px-1 text-[10px] text-white/60">
              {t("live.partyNeed", { n: unknownParty })}
            </span>
          )}
        </p>
      )}

      {banPhase ? (
        <div className="flex flex-col gap-1">
          <ol className="flex flex-col gap-1">
            {banList.slice(0, VOTE_PICKS).map((r, i) => (
              <li key={r.hero_id} className="flex flex-col">
                <div className="flex flex-wrap items-center gap-1">
                  <span className="w-4 text-xs font-bold text-red-300">{i + 1}</span>
                  <HeroAvatar hero={byId.get(r.hero_id)} size="sm" />
                  <span className="shrink-0 text-sm font-semibold">{heroName(r.hero_id)}</span>
                  <RoleIcon role={r.role} className={cn("size-3.5 shrink-0", ROLE_TEXT[r.role])} />
                  <TierBadge tier={r.tier} className="size-4 text-[10px]" />
                  <span className="ml-auto shrink-0 text-[10px] text-white/45 tabular-nums">
                    {t("bans.votes", { n: r.votes })}
                  </span>
                  <Ban className="size-3 shrink-0 text-red-300" />
                </div>
                <div className="ml-6">
                  <BanReasons reasons={r.reasons} byId={byId} />
                </div>
              </li>
            ))}
          </ol>
          {banList.length > VOTE_PICKS && (
            <div className="flex flex-col gap-0.5 border-t border-white/10 pt-1">
              <p className="text-[10px] text-white/45">{t("bans.moreTitle")}</p>
              {banList.slice(VOTE_PICKS).map((r, i) => (
                <div key={r.hero_id} className="flex items-center gap-1.5 text-[11px] text-white/70">
                  <span className="w-4 text-right text-white/40 tabular-nums">{VOTE_PICKS + i + 1}</span>
                  <HeroAvatar hero={byId.get(r.hero_id)} size="xs" />
                  <span className="truncate">{heroName(r.hero_id)}</span>
                  <RoleIcon role={r.role} className={cn("ml-auto size-3 shrink-0", ROLE_TEXT[r.role])} />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {dataNotice.length > 0 && (
            <p className="text-[10px] text-white/50">{dataNotice.join(" · ")}</p>
          )}
          <section className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <h3 className="text-[10px] font-semibold tracking-wide text-white/45 uppercase">
                {t("live.myPicks")}
              </h3>
              {meOnly && (
                <span className="ml-auto rounded bg-white/10 px-1 text-[9px] text-white/55">
                  {t("live.preferredOnly")}
                </span>
              )}
            </div>
            {soloPicks.length ? (
              <ol className="flex flex-col gap-1">
                {soloPicks.map((p, i) => (
                  <li key={p.hero_id} className="flex flex-col">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="w-4 text-xs font-bold text-orange-300">{i + 1}</span>
                      <HeroAvatar hero={byId.get(p.hero_id)} size="sm" />
                      <span className="shrink-0 text-sm font-semibold">{heroName(p.hero_id)}</span>
                      <RoleIcon role={p.role} className={cn("size-3.5 shrink-0", ROLE_TEXT[p.role])} />
                      <TierBadge tier={p.tier} className="size-4 text-[10px]" />
                      <span className="ml-auto shrink-0 text-[10px] text-white/45 tabular-nums">
                        {p.score.toFixed(2)}
                      </span>
                      {preferredBy(me, p.hero_id) && (
                        <Star
                          className="size-3.5 shrink-0 fill-orange-300 text-orange-300"
                          aria-label={t("live.preferred")}
                        />
                      )}
                      {meSlot?.hero === p.hero_id && <Check className="size-3.5 shrink-0 text-good" />}
                    </div>
                    <div className="ml-6">
                      <ReasonChips reasons={p.reasons} heroes={byId} compact />
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[11px] text-white/50">
                {recs.solo.isError ? t("pick.noCandidates") : t("live.calculating")}
              </p>
            )}
          </section>

          {recs.party && (
            <section className="flex flex-col gap-1 border-t border-white/10 pt-1.5">
              <div className="flex items-center gap-1">
                <h3 className="text-[10px] font-semibold tracking-wide text-white/45 uppercase">
                  {t("live.partyCombo")}
                </h3>
                {partyOnly && (
                  <span className="ml-auto rounded bg-white/10 px-1 text-[9px] text-white/55">
                    {t("live.preferredOnly")}
                  </span>
                )}
              </div>
              {combos.length ? (
                combos.map((combo, ci) => (
                  <div key={ci} className="flex flex-col gap-1 rounded-md border border-white/10 p-1">
                    <div className="flex items-center gap-1 text-[10px]">
                      <span className="font-semibold text-white/70">{t("pick.comboN", { n: ci + 1 })}</span>
                      <span className="ml-auto text-white/45 tabular-nums">{combo.score.toFixed(2)}</span>
                    </div>
                    {combo.synergies.length > 0 && (
                      <p className="truncate text-[10px] text-good">
                        {combo.synergies.map(([a, b]) => `${heroName(a)} + ${heroName(b)}`).join(" · ")}
                      </p>
                    )}
                    <ul className="flex flex-col gap-1">
                      {combo.picks.map((p) => {
                        const current = boardNow.allies.find((s) => s.id === p.member)?.hero === p.hero_id;
                        // 별은 그 줄의 주인(파티원)이 선호하는 영웅이라는 뜻이다
                        const member = recs.members.find((m) => m.slot.id === p.member);
                        const preferredByMember = preferredBy(member?.player, p.hero_id);
                        return (
                          <li key={p.member} className="flex flex-col">
                            <div className="flex items-center gap-2">
                              <span className="w-12 shrink-0 truncate text-[10px] text-white/55">{memberName(p.member)}</span>
                              <HeroAvatar hero={byId.get(p.hero_id)} size="sm" />
                              <span className="truncate text-sm font-semibold">{heroName(p.hero_id)}</span>
                              <RoleIcon role={p.role} className={cn("size-3.5 shrink-0", ROLE_TEXT[p.role])} />
                              <TierBadge tier={p.tier} className="size-4 text-[10px]" />
                              <span className="ml-auto flex shrink-0 items-center gap-1">
                                {preferredByMember && (
                                  <Star
                                    className="size-3.5 fill-orange-300 text-orange-300"
                                    aria-label={t("live.preferred")}
                                  />
                                )}
                                {current && <Check className="size-3.5 text-good" />}
                              </span>
                            </div>
                            <div className="ml-14">
                              <ReasonChips reasons={p.reasons} heroes={byId} compact />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))
              ) : (
                <p className="text-[11px] text-white/50">
                  {recs.partyQ.isError ? t("pick.noCandidates") : t("live.calculating")}
                </p>
              )}
            </section>
          )}
        </div>
      )}

      {threats.length > 0 && (
        <p className="flex items-center gap-1 text-xs text-red-300">
          <Flame className="size-3.5 shrink-0" />
          <span className="truncate">{threats.map(heroName).join(", ")}</span>
        </p>
      )}

      {(allyRoles.tank + allyRoles.damage + allyRoles.support > 0 ||
        enemyRoles.tank + enemyRoles.damage + enemyRoles.support > 0) && (
        <p className="flex flex-wrap gap-x-2 text-[10px] text-white/45">
          <span>{t("live.allyComp", allyRoles)}</span>
          <span>{t("live.enemyComp", enemyRoles)}</span>
        </p>
      )}

      {!banPhase && bans.length > 0 && (
        <div className="flex items-center gap-1 text-[10px] text-white/55">
          <Ban className="size-3.5 shrink-0 text-red-300" />
          <span className="shrink-0">{t("live.bansSet", { n: bans.length })}</span>
          <span className="flex gap-0.5">
            {bans.slice(0, 5).map((h, i) => (
              <HeroAvatar key={`${h!.hero_id}-${i}`} hero={h} size="xs" />
            ))}
          </span>
        </div>
      )}
    </Panel>
  );
}

function Header({ title, right }: { title: string; right?: string }) {
  return (
    <div
      data-tauri-drag-region
      className="flex cursor-grab items-center justify-between gap-2 text-[11px] text-white/70"
    >
      <span className="font-semibold text-white">{title}</span>
      {right && <span className="truncate">{right}</span>}
    </div>
  );
}

function Panel({
  header,
  children,
  contentRef,
}: {
  header: React.ReactNode;
  children: React.ReactNode;
  /** 내용 높이를 재서 오버레이 창을 맞춘다 (휠로 스크롤할 수 없으니까) */
  contentRef?: React.Ref<HTMLDivElement>;
}) {
  // deep: the unlocked overlay can be dragged from the panel background; buttons/selects still block
  // dragging (Tauri's drag script ignores clickable elements).
  return (
    <div
      data-tauri-drag-region="deep"
      className="m-1 flex flex-col overflow-y-auto rounded-xl bg-black/70 p-2.5 text-white shadow-lg backdrop-blur-sm"
    >
      <div ref={contentRef} className="flex flex-col gap-1.5">
        {header}
        {children}
      </div>
    </div>
  );
}

