import type { Capture } from "./LiveBar";

/** 디버그 로그 한 줄. text와 detail은 남길 때 번역해 둔다 */
export interface LogEntry {
  at: number;
  kind: "tab" | "ignored" | "capture" | "error";
  text: string;
  /** 덧붙이는 설명 (무시된 이유, 포커스 창 등) */
  detail?: string;
  /** 눈에 띄게 남길 사유 (디스크에 안 저장함 등) */
  note?: string;
}

/** 앱이 보고하는 TAB 감지 상태 (Rust live.rs의 Status와 같은 모양) */
export interface LiveStatus {
  listening: boolean;
  error: string | null;
  templates: number;
  heroes: number;
  /** 기억한 플레이어 이름 이미지 수 */
  names: number;
  /** tesseract(한국어) 사용 가능 여부 */
  ocr: boolean;
  /** 앱에 포함된 OCR인지 (아니면 시스템 PATH) */
  ocr_bundled: boolean;
  /** 오버레이 창이 만들어져 보이는지 (안 보이면 이 값으로 원인을 좁힌다) */
  overlay_visible: boolean;
  /** 오버레이가 항상 위(topmost)인지 */
  overlay_topmost: boolean;
  /** 마지막 TAB 때 게임이 독점 전체 화면이었는지 (그 위에는 창을 그릴 수 없다) */
  game_fullscreen: boolean;
}

/** 로그를 들고 있을 최대 줄 수 */
export const MAX_LOG = 100;

/** 시:분:초.밀리초 (로그 줄 앞에 붙인다) */
export const stamp = (at: number) =>
  `${new Date(at).toLocaleTimeString(undefined, { hour12: false })}.${String(at % 1000).padStart(3, "0")}`;

export interface ReportInput {
  version: string;
  locale: string;
  status: LiveStatus | null;
  log: LogEntry[];
  capture: Capture | null;
}

/**
 * 복사용 보고서. 사진(thumb, crop)은 넣지 않는다: 좌표와 읽은 값만으로 원인을 좁힌다.
 * 창 제목은 들어가므로 공유 전에 확인하라고 화면에서 안내한다.
 */
export function buildReport({ version, locale, status, log, capture }: ReportInput): string {
  return JSON.stringify(
    {
      app: "PickGak desktop",
      version,
      locale,
      status,
      log: log.slice(0, 40).map((e) => `${stamp(e.at)} ${e.kind} ${e.text}${e.detail ? ` · ${e.detail}` : ""}`),
      capture: capture
        ? {
            id: capture.id,
            at: new Date(capture.at).toISOString(),
            size: [capture.width, capture.height],
            grab_ms: capture.grab_ms,
            window: capture.debug.window,
            process_ms: capture.debug.process_ms,
            ocr_ms: capture.debug.ocr_ms,
            saved: capture.debug.saved,
            scoreboard: capture.scoreboard,
            sane: capture.sane,
            me: capture.me,
            map: capture.map,
            bans: capture.bans,
            ranks: capture.ranks,
            row_h: +capture.debug.row_h.toFixed(1),
            boxes: {
              table: capture.debug.table,
              portraits: capture.debug.portraits,
              bans: capture.debug.bans,
              ranks: capture.debug.ranks,
              map_text: capture.debug.map_text,
            },
            rows: capture.rows.map((r, i) => ({
              team: r.team,
              label: r.label,
              score: +r.score.toFixed(3),
              name: r.name
                ? {
                    player: r.name.player,
                    name: r.name.name,
                    score: +r.name.score.toFixed(3),
                    known: r.name.known,
                    candidates: r.name.candidates.map((c) => ({
                      player: c.player,
                      name: c.name,
                      score: +c.score.toFixed(3),
                    })),
                  }
                : null,
              stats: capture.stats?.[i] ?? null,
            })),
          }
        : null,
    },
    null,
    2,
  );
}
