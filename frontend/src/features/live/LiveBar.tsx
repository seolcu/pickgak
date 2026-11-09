import * as Dialog from "@radix-ui/react-dialog";
import { Bug, Check, Flame, Lock, ScanLine, Unlock, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import type { Hero, Role } from "../../lib/api";
import { cn } from "../../lib/cn";
import { invoke, listen } from "../../lib/platform";
import { usePrefs } from "../../hooks/prefs";
import { useMaps } from "../../hooks/data";
import { loadLocal, saveLocal } from "../../lib/storage";
import { DebugPanel } from "./DebugPanel";
import { TAB_ONLY_KEY } from "./OverlayApp";
import { suspectSmurfs } from "./smurf";
import type { LiveStatus } from "./debugReport";

export interface NameCandidate {
  player: number;
  name: string;
  score: number;
}

/** 이름 줄 읽기: 확인된 이름 이미지가 맞으면 known, 아니면 물어볼 후보 */
export interface NameMatch {
  player: number;
  name: string;
  score: number;
  known: boolean;
  candidates: NameCandidate[];
}

/** 데스크톱 앱이 TAB 화면을 읽은 결과 (Rust live.rs의 Capture와 같은 모양) */
export interface Capture {
  id: number;
  at: number;
  scoreboard: boolean;
  /** TAB 화면 오른쪽 위 맵 글자로 알아본 맵 (전에 그 맵을 고른 적이 있을 때) */
  map: string | null;
  /** 경쟁전 TAB 화면 왼쪽 위 금지 영웅 (순서대로, 못 알아본 아이콘은 null) */
  bans: (string | null)[];
  /** 경쟁전 TAB 화면 오른쪽 위 경기 등급 범위 엠블럼 (낮은 것부터, 배치고사·경쟁전 밖에서는 비어 있다) */
  ranks: (string | null)[];
  rows: {
    team: "ally" | "enemy";
    label: string | null;
    score: number;
    crop: string;
    /** 이름 줄 판독 (초록 파티 줄만 채워진다) */
    name: NameMatch | null;
    /** 아직 누구인지 모를 때 보여 줄 이름 글자 그림 (data URL) */
    name_crop: string | null;
    /** 이름을 등록된 이름 전부와(OCR 포함) 견줘 봤지만 가까운 게 없음. 이때 오버레이는 목록에서 고르게 묻는다 */
    name_tried?: boolean;
  }[];
  me: number | null;
  sane: boolean;
  /** 줄마다 [처치, 도움, 죽음, 피해, 치유, 경감] */
  stats: (number | null)[][] | null;
  grab_ms: number;
  thumb: string;
  /** 디버그 화면용: 읽은 근거 (전체 캡처의 픽셀 좌표) */
  debug: {
    window: string;
    process_ms: number;
    /** OCR 워커가 쓴 시간 (캡처 이벤트는 이 시간을 기다리지 않는다) */
    ocr_ms: number;
    saved: boolean;
    table: [number, number, number] | null;
    row_h: number;
    portraits: [number, number, number, number][];
    /** 줄마다 파티 표시 (아군 줄만) */
    party: boolean[];
    bans: [number, number, number, number][];
    ranks: [number, number, number, number][];
    map_text: [number, number, number, number] | null;
  };
  width: number;
  height: number;
}

/** 역할 고정 5대5 줄 순서: 돌격, 공격, 공격, 지원, 지원 (우리 팀 0~4, 상대 팀 5~9) */
const ROW_ROLE: Role[] = ["tank", "damage", "damage", "support", "support"];
const AUTO_KEY = "pickgak.live.autofill";
/** 디버그 화면을 펼쳐 둘지 (테스트할 때 켠다) */
const DEBUG_KEY = "pickgak.live.debug";
/** 오버레이가 마우스를 받는 상태인지 (이름 질문이 끝나면 원래대로 돌린다) */
export const OVERLAY_LOCKED_KEY = "pickgak.overlay.locked";
/** "새 판"을 누른 시각. 그 뒤에 찍은 캡처와 그 뒤에 고른 맵만 같은 판으로 본다 */
export const MATCH_START_KEY = "pickgak.matchStart";
/** 오버레이에서 이름 확인을 되돌린 사람. 메인 창이 그 사람의 자동 지정을 푼다 */
export const NAME_UNDO_KEY = "pickgak.live.nameUndo";
/** 판에 자동으로 넣을 만큼 최근인 캡처 */
const FRESH_MS = 5 * 60 * 1000;

const isUnknown = (label: string | null) => label === null;

/**
 * 데스크톱 앱 전용 줄: TAB 감지 상태, 최근 캡처, 처음 보는 초상화 알려 주기, 오버레이.
 * TAB을 누르고 있을 때만 게임 창을 한 장 찍는다. 게임 프로세스에는 아무것도 하지 않는다.
 */
export function LiveBar({
  heroes,
  byId,
  onReading,
}: {
  heroes: Hero[];
  byId: Map<string, Hero>;
  /** 인식 결과를 판에 넣기 (자동 채우기가 켜져 있을 때) */
  onReading: (c: Capture) => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [latest, setLatest] = useState<Capture | null>(null);
  const [auto, setAuto] = useState(() => loadLocal(AUTO_KEY, true));
  const [debug, setDebug] = useState(() => loadLocal(DEBUG_KEY, false));
  // The window always starts click-through; the saved key only tells a name question whether to
  // restore an unlocked overlay afterwards.
  const [overlay, setOverlay] = useState({ visible: true, locked: true });
  const [tabOnly, setTabOnly] = useState(() => loadLocal(TAB_ONLY_KEY, false));
  const [open, setOpen] = useState(false);
  const { setMap, query } = usePrefs();
  const maps = useMaps(query).data ?? [];

  useEffect(() => {
    saveLocal(OVERLAY_LOCKED_KEY, true);
  }, []);

  useEffect(() => {
    let off: (() => void) | undefined;
    let alive = true;
    invoke<LiveStatus>("live_status").then(setStatus).catch(() => {});
    invoke<Capture[]>("live_recent").then((r) => alive && r[0] && setLatest(r[0])).catch(() => {});
    listen<Capture>("live://capture", (c) => {
      setLatest(c);
      invoke<LiveStatus>("live_status").then(setStatus).catch(() => {});
    }).then((f) => (alive ? (off = f) : f()));
    return () => {
      alive = false;
      off?.();
    };
  }, []);

  const readingKey = latest?.rows
    .map((r) => `${r.label ?? ""}:${r.name?.player ?? ""}:${r.name?.known ? 1 : 0}`)
    .join();
  // 새 캡처가 오면 (점수판이고 앞뒤가 맞을 때) 판에 넣는다
  useEffect(() => {
    // 앱을 다시 켰을 때 지난 세션의 마지막 캡처를 판에 다시 넣지 않도록, 최근 것만
    if (latest && auto && latest.scoreboard && latest.sane && Date.now() - latest.at < FRESH_MS) onReading(latest);
    // 같은 캡처를 두 번 넣지 않도록 id만 본다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest?.id, latest?.map, readingKey]);

  const unknown = latest?.scoreboard ? latest.rows.filter((r) => isUnknown(r.label)).length : 0;
  const allyRows = latest ? latest.rows.flatMap((r, i) => (r.team === "ally" ? [i] : [])) : [];
  const enemyRows = latest ? latest.rows.flatMap((r, i) => (r.team === "enemy" ? [i] : [])) : [];
  // 양학 판별은 5대5 경기에서만 (같은 역할끼리 비교한다)
  const suspects =
    latest?.stats && allyRows.length === 5 && enemyRows.length === 5
      ? suspectSmurfs([...allyRows, ...enemyRows].map((i) => latest.stats![i]))
      : [];
  const nameOf = (row: number) => {
    const l = latest?.rows[enemyRows[row - 5]]?.label;
    return l && !l.startsWith("__") ? (byId.get(l)?.name ?? l) : t(`roles.${ROW_ROLE[(row - 5) % 5]}`);
  };
  const teachMap = (id: string) => {
    if (!latest || !id) return;
    setMap(id);
    invoke("live_teach_map", { captureId: latest.id, map: id }).catch(() => {});
  };
  const setOverlayState = (next: { visible: boolean; locked: boolean }) => {
    setOverlay(next);
    saveLocal(OVERLAY_LOCKED_KEY, next.locked);
    invoke("overlay_set", next).catch(() => {});
  };

  return (
    <>
      <section
        aria-label={t("live.title")}
        className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3 py-1.5 text-sm"
      >
        <ScanLine className="size-4 text-accent" />
        <span className="font-semibold">{t("live.title")}</span>
        <span aria-live="polite" className={cn("text-xs", status?.error ? "text-bad" : "text-muted")}>
          {status?.error
            ? t("live.error", { why: status.error })
            : status?.listening
              ? t("live.listening", { n: status.heroes })
              : t("live.starting")}
        </span>
        {latest && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="ml-1 inline-flex items-center gap-1.5 rounded-md border border-border px-1.5 py-0.5 text-xs hover:bg-surface-2"
          >
            <img src={latest.thumb} alt="" className="h-6 rounded-sm" />
            {latest.scoreboard ? t("live.lastCapture", { time: new Date(latest.at).toLocaleTimeString() }) : t("live.notScoreboard")}
            {unknown > 0 && <Badge tone="solid">{t("live.teachCount", { n: unknown })}</Badge>}
          </button>
        )}
        {latest?.scoreboard && latest.debug.map_text && (
          <select
            aria-label={t("live.mapTeach")}
            title={t("live.mapTeachHint")}
            value={latest.map ?? ""}
            onChange={(e) => teachMap(e.target.value)}
            className="h-8 max-w-40 rounded-md border border-border bg-surface px-2 text-xs"
          >
            <option value="">{t("live.mapTeach")}</option>
            {maps.map((m) => (
              <option key={m.map_id} value={m.map_id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
        <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => {
              setAuto(e.target.checked);
              saveLocal(AUTO_KEY, e.target.checked);
            }}
          />
          {t("live.autofill")}
        </label>
        <label className="inline-flex items-center gap-1.5 text-xs text-muted" title={t("live.tabOnlyHint")}>
          <input
            type="checkbox"
            checked={tabOnly}
            onChange={(e) => {
              setTabOnly(e.target.checked);
              saveLocal(TAB_ONLY_KEY, e.target.checked);
              // 숨어 있는 동안 마우스를 막으면 안 되니 클릭이 게임으로 가게 잠근다
              if (e.target.checked && !overlay.locked) setOverlayState({ ...overlay, locked: true });
            }}
          />
          {t("live.tabOnly")}
        </label>
        {!tabOnly && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setOverlayState({ ...overlay, locked: !overlay.locked })}
            title={overlay.locked ? t("live.unlockHint") : t("live.lockHint")}
            aria-label={overlay.locked ? t("live.unlockHint") : t("live.lockHint")}
          >
            {overlay.locked ? <Lock className="size-4" /> : <Unlock className="size-4" />}
          </Button>
        )}
        <Button
          size="icon"
          variant={debug ? "secondary" : "ghost"}
          onClick={() => {
            setDebug(!debug);
            saveLocal(DEBUG_KEY, !debug);
          }}
          aria-pressed={debug}
          aria-label={t("live.debug")}
          title={t("live.debugHint")}
        >
          <Bug className="size-4" />
        </Button>
        {latest && (
          <CaptureDialog open={open} onOpenChange={setOpen} capture={latest} heroes={heroes} byId={byId} />
        )}
      </section>
      {suspects.length > 0 && (
        <div
          aria-live="polite"
          className="flex flex-col gap-1 rounded-xl border border-bad/30 bg-enemy-soft px-3 py-2 text-sm"
        >
          {suspects.map((x) => (
            <p key={x.row} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-bad">
              <Flame className="size-4 shrink-0" />
              <span className="font-medium">{t("live.smurf", { name: nameOf(x.row), elims: x.elims, kd: x.kd })}</span>
              <span className="inline-flex items-center gap-1 text-xs text-muted">
                <Check className="size-3.5" />
                {t("live.threatMarked")}
              </span>
            </p>
          ))}
        </div>
      )}
      {debug && <DebugPanel latest={latest} byId={byId} status={status} />}
    </>
  );
}

function CaptureDialog({
  open,
  onOpenChange,
  capture,
  heroes,
  byId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  capture: Capture;
  heroes: Hero[];
  byId: Map<string, Hero>;
}) {
  const { t } = useTranslation();
  const label = (l: string | null) =>
    l === null
      ? t("live.unknownPortrait")
      : l === "__unknown__"
        ? "?"
        : l === "__dead__"
          ? t("live.dead")
          : l === "__empty__"
            ? t("live.empty")
            : (byId.get(l)?.name ?? l);
  const teach = (row: number, hero: string) => invoke("live_teach", { captureId: capture.id, row, hero }).catch(() => {});

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[min(96vw,760px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between">
            <Dialog.Title className="font-semibold">{t("live.captureTitle")}</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label={t("common.close")}>
                <X className="size-4" />
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="text-xs text-muted">{t("live.captureHint")}</Dialog.Description>
          <img src={capture.thumb} alt="" className="w-full rounded-lg" />
          {capture.scoreboard ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {(["ally", "enemy"] as const).map((team) => {
                const idx = capture.rows.flatMap((r, i) => (r.team === team ? [i] : []));
                return (
                  <ol key={team} className="flex flex-col gap-1.5">
                    <li className={cn("text-xs font-semibold", team === "enemy" ? "text-enemy" : "text-ally")}>
                      {t(team === "enemy" ? "pick.enemies" : "pick.allies")}
                    </li>
                    {idx.map((row, i) => {
                      const r = capture.rows[row];
                      const role: Role | null = idx.length === 5 ? ROW_ROLE[i] : null;
                      return (
                        <li key={row} className="flex items-center gap-2">
                          <img src={r.crop} alt="" className="size-10 rounded-md" />
                          {capture.stats && (
                            <span className="w-16 shrink-0 text-[11px] text-muted tabular-nums" title={t("live.statsHint")}>
                              {capture.stats[row].slice(0, 3).map((v) => v ?? "-").join("/")}
                            </span>
                          )}
                          <span className={cn("w-24 truncate text-sm", r.label === null && "font-semibold text-accent")}>
                            {label(r.label)}
                            {row === capture.me && <span className="ml-1 text-xs text-accent">({t("pick.me")})</span>}
                          </span>
                          <select
                            aria-label={t("live.whoIsThis")}
                            value=""
                            onChange={(e) => e.target.value && teach(row, e.target.value)}
                            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-sm"
                          >
                            <option value="">{r.label === null ? t("live.whoIsThis") : t("live.relabel")}</option>
                            {heroes
                              .filter((h) => !role || h.role === role)
                              .map((h) => (
                                <option key={h.hero_id} value={h.hero_id}>
                                  {h.name}
                                </option>
                              ))}
                            <option value="__unknown__">? ({t("live.notSeenYet")})</option>
                            <option value="__dead__">{t("live.dead")}</option>
                          </select>
                        </li>
                      );
                    })}
                  </ol>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted">{t("live.notScoreboardHint")}</p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
