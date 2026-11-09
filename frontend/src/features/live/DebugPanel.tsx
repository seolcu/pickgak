import { Bug, Check, ClipboardCopy, FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import type { Hero } from "../../lib/api";
import { cn } from "../../lib/cn";
import { appVersion, invoke, listen } from "../../lib/platform";
import { rankLabel } from "../../lib/ranks";
import type { Capture } from "./LiveBar";
import { buildReport, MAX_LOG, stamp, type LiveStatus, type LogEntry } from "./debugReport";

/** 앱이 보내는 "TAB이 왜 안 먹혔는지" (Rust live.rs의 IgnoredFocus와 같은 모양) */
interface IgnoredFocus {
  reason: "other" | "wayland" | "no-ewmh";
  /** 포커스를 가진 X 창 ("class | title"), Wayland 창이면 null */
  window: string | null;
}

/** 앱이 보내는 캡처 실패 (Rust live.rs의 CaptureError와 같은 모양) */
interface CaptureError {
  why: string;
  /** 게임 창을 못 찾았을 때 포커스를 가진 창 */
  focus: string | null;
}

/** 무시 이유를 옮길 번역 키. 템플릿 문자열 대신 표로 두어 키 검사가 찾게 한다 */
const FOCUS_KEY: Record<IgnoredFocus["reason"], string> = {
  other: "live.debugFocusOther",
  wayland: "live.debugFocusWayland",
  "no-ewmh": "live.debugFocusNoEwmh",
};

/**
 * 테스트용 디버그 화면 (데스크톱 앱): TAB 이벤트 기록, 최근 캡처를 무엇으로 읽었는지(점수판 위치·초상화 칸·금지·등급·맵 글자),
 * 줄마다 읽은 영웅과 점수. 보고서는 사진 없이 글로만 복사한다.
 */
export function DebugPanel({ latest, byId, status }: { latest: Capture | null; byId: Map<string, Hero>; status: LiveStatus | null }) {
  const { t, i18n } = useTranslation();
  const [log, setLog] = useState<LogEntry[]>([]);
  const [copied, setCopied] = useState(false);
  const [version, setVersion] = useState("unknown");
  /** 클립보드가 막혔을 때 직접 고를 수 있게 띄우는 보고서 */
  const [fallback, setFallback] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    appVersion()
      .then((v) => alive && setVersion(v))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const add = (kind: LogEntry["kind"], text: string, detail?: string, note?: string) =>
      setLog((l) => [{ at: Date.now(), kind, text, detail, note }, ...l].slice(0, MAX_LOG));
    const offs: Promise<() => void>[] = [
      listen<boolean>("live://tab", (down) => add("tab", down ? t("live.debugTabDown") : t("live.debugTabUp"))),
      listen<IgnoredFocus>("live://ignored", (e) =>
        add(
          "ignored",
          t("live.debugIgnored"),
          e.reason === "other"
            ? e.window
              ? t("live.debugFocusOther", { window: e.window })
              : t("live.debugFocusUnknown")
            : t(FOCUS_KEY[e.reason]),
        ),
      ),
      listen<CaptureError>("live://error", (e) =>
        add(
          "error",
          t("live.debugCaptureFailed", {
            why:
              e.why === "game window not found"
                ? t("live.debugNoGameWindow")
                : e.why === "scoreboard not visible"
                  ? t("live.debugNoScoreboard")
                  : e.why === "released before the scoreboard"
                    ? t("live.debugReleasedEarly")
                    : e.why,
          }),
          e.focus ? t("live.debugFocusAt", { window: e.focus }) : undefined,
        ),
      ),
      listen<Capture>("live://capture", (c) =>
        add(
          "capture",
          t("live.debugCapture", { size: `${c.width}x${c.height}`, grab: c.grab_ms, read: c.debug.process_ms }),
          c.scoreboard ? t("live.debugRows", { n: c.rows.length }) : t("live.notScoreboard"),
          c.debug.saved ? undefined : t("live.debugNotSaved"),
        ),
      ),
    ];
    return () => offs.forEach((p) => p.then((off) => off()));
  }, [t]);

  const copy = async () => {
    const report = buildReport({ version, locale: i18n.language, status, log, capture: latest });
    try {
      await navigator.clipboard.writeText(report);
      setFallback(null);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // WebView가 클립보드를 막는 경우가 있다: 같은 글을 골라서 복사하게 둔다
      setFallback(report);
    }
  };

  return (
    <section aria-label={t("live.debug")} className="flex flex-col gap-3 rounded-xl border border-dashed border-accent/50 bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Bug className="size-4 text-accent" />
        <span className="font-semibold">{t("live.debug")}</span>
        {status?.error ? (
          <span className="text-xs text-bad">{t("live.error", { why: status.error })}</span>
        ) : (
          <>
            <span className="text-xs text-muted">{t("live.debugStatus", { heroes: status?.heroes ?? 0, templates: status?.templates ?? 0 })}</span>
            <span className="text-xs text-muted">
              {status?.ocr
                ? t("live.debugNames", { names: status?.names ?? 0 })
                : t("live.debugNamesNoOcr", { names: status?.names ?? 0 })}
            </span>
            {status?.ocr && (
              <span className="text-xs text-muted">
                {status.ocr_bundled ? t("live.debugOcrBundled") : t("live.debugOcrSystem")}
              </span>
            )}
            {(latest?.debug.ocr_ms ?? 0) > 0 && (
              <span className="text-xs text-muted">{t("live.debugOcrMs", { ms: latest?.debug.ocr_ms })}</span>
            )}
            <span className={cn("text-xs", status?.overlay_visible ? "text-muted" : "text-bad")}>
              {status?.overlay_visible ? t("live.debugOverlayOn") : t("live.debugOverlayOff")}
            </span>
            {status?.game_fullscreen && (
              <span className="text-xs text-damage">{t("live.debugFullscreen")}</span>
            )}
          </>
        )}
        <div className="ml-auto flex gap-1.5">
          <Button size="sm" onClick={() => invoke("live_open_captures").catch(() => {})}>
            <FolderOpen className="size-3.5" />
            {t("live.debugOpenFolder")}
          </Button>
          <Button size="sm" onClick={copy}>
            {copied ? <Check className="size-3.5 text-good" /> : <ClipboardCopy className="size-3.5" />}
            {copied ? t("live.debugCopied") : t("live.debugCopy")}
          </Button>
        </div>
      </div>
      <p className="text-[11px] text-muted">{t("live.debugHint")}</p>

      {fallback !== null && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-damage">{t("live.debugCopyFailed")}</p>
          <textarea
            readOnly
            value={fallback}
            aria-label={t("live.debugReportText")}
            onFocus={(e) => e.currentTarget.select()}
            className="h-40 w-full rounded-md border border-border bg-surface p-2 font-mono text-[11px]"
          />
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {latest ? <CaptureView c={latest} byId={byId} /> : <p className="text-muted">{t("live.debugNoCapture")}</p>}
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs font-semibold text-muted">{t("live.debugLog")}</span>
          <ol className="flex max-h-80 flex-col gap-0.5 overflow-y-auto font-mono text-[11px]" aria-label={t("live.debugLog")}>
            {log.length === 0 && <li className="text-muted">{t("live.debugEmptyLog")}</li>}
            {log.map((e, i) => (
              <li key={`${e.at}-${i}`} className="flex gap-2">
                <span className="shrink-0 text-muted">{stamp(e.at)}</span>
                <span className="min-w-0 break-words">
                  <span
                    className={cn(
                      e.kind === "error" && "text-bad",
                      e.kind === "ignored" && "text-damage",
                      e.kind === "capture" && "text-text",
                      e.kind === "tab" && "text-muted",
                    )}
                  >
                    {e.text}
                  </span>
                  {e.detail && <span className="text-muted"> · {e.detail}</span>}
                  {e.note && <span className="text-damage"> · {e.note}</span>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <p className="text-[11px] text-muted">{t("live.debugPrivacy")}</p>
    </section>
  );
}

function Legend({ color, text }: { color: string; text: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="size-2.5 rounded-[2px] border-2" style={{ borderColor: color }} />
      {text}
    </span>
  );
}

/** 캡처 썸네일 위에 읽은 위치를 겹쳐 그린다 (좌표는 전체 캡처 기준이라 viewBox로 맞춘다) */
function CaptureView({ c, byId }: { c: Capture; byId: Map<string, Hero> }) {
  const { t } = useTranslation();
  const d = c.debug;
  const name = (l: string | null) => {
    if (l === null) return "?";
    if (l === "__unknown__") return "?";
    if (l === "__dead__") return t("live.dead");
    if (l === "__empty__") return t("live.empty");
    return byId.get(l)?.name ?? l;
  };
  const heroes = (v: (string | null)[]) => v.map((x) => (x ? (byId.get(x)?.name ?? x) : "?")).join(", ") || "-";
  const ranks = c.ranks.map((r) => (r ? rankLabel(r, t) : "?")).join(", ") || "-";
  const stroke = Math.max(2, c.height / 400);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="relative">
        <img src={c.thumb} alt="" className="w-full rounded-md" />
        <svg viewBox={`0 0 ${c.width} ${c.height}`} preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden>
          {d.table && (
            <line x1={d.table[0]} x2={d.table[2]} y1={d.table[1]} y2={d.table[1]} stroke="#facc15" strokeWidth={stroke * 2} />
          )}
          {d.portraits.map(([x, y, w, h], i) => {
            const row = c.rows[i];
            const stats = c.stats?.[i];
            return (
              <g key={i}>
                <rect x={x} y={y} width={w} height={h} fill="none" stroke={row?.label ? "#22c55e" : "#ef4444"} strokeWidth={stroke} />
                <text
                  x={x + w + stroke * 3}
                  y={y + h / 2}
                  fill="#fff"
                  fontSize={c.height / 48}
                  dominantBaseline="middle"
                  paintOrder="stroke"
                  stroke="#000"
                  strokeWidth={stroke}
                >
                  {name(row?.label ?? null)} {Math.round((row?.score ?? 0) * 100)}
                  {stats && ` · ${stats.slice(0, 3).map((v) => v ?? "-").join("/")}`}
                </text>
              </g>
            );
          })}
          {[...d.bans, ...d.ranks].map(([x, y, w, h], i) => (
            <rect key={`b${i}`} x={x} y={y} width={w} height={h} fill="none" stroke="#38bdf8" strokeWidth={stroke} />
          ))}
          {d.map_text && (
            <rect x={d.map_text[0]} y={d.map_text[1]} width={d.map_text[2]} height={d.map_text[3]} fill="none" stroke="#c084fc" strokeWidth={stroke} />
          )}
        </svg>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
        <Legend color="#facc15" text={t("live.debugLegendTable")} />
        <Legend color="#22c55e" text={t("live.debugLegendPortrait")} />
        <Legend color="#38bdf8" text={t("live.debugLegendBanRank")} />
        <Legend color="#c084fc" text={t("live.debugLegendMap")} />
      </div>
      {!c.scoreboard && <p className="text-xs text-damage">{t("live.debugNoTable")}</p>}
      {c.scoreboard && !c.sane && <p className="text-xs text-damage">{t("live.debugDuplicates")}</p>}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-muted">{t("live.debugWindow")}</dt>
        <dd className="truncate" title={d.window}>
          {d.window || "-"}
        </dd>
        <dt className="text-muted">{t("live.debugTiming")}</dt>
        <dd className="flex flex-wrap items-center gap-1">
          <span>{t("live.debugTimingValue", { size: `${c.width}x${c.height}`, grab: c.grab_ms, read: d.process_ms })}</span>
          <span className={d.saved ? "text-muted" : "text-damage"}>
            {d.saved ? t("live.debugSaved") : t("live.debugNotSaved")}
          </span>
        </dd>
        <dt className="text-muted">{t("live.debugReading")}</dt>
        <dd className="flex flex-wrap gap-x-2 gap-y-0.5">
          {(
            [
              [t("live.debugMe"), c.me === null ? "-" : String(c.me)],
              [t("live.debugMap"), c.map ?? "-"],
              [t("live.debugBans"), heroes(c.bans)],
              [t("live.debugRanks"), ranks],
              [t("live.debugRowH"), d.row_h.toFixed(1)],
              [t("live.debugParty"), String((d.party ?? []).filter(Boolean).length)],
            ] as const
          ).map(([key, value]) => (
            <span key={key}>
              <span className="text-muted">{key}</span> {value}
            </span>
          ))}
        </dd>
      </dl>
    </div>
  );
}
