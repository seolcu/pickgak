import { describe, expect, it } from "vitest";
import type { Capture } from "./LiveBar";
import { buildReport, MAX_LOG, type LogEntry } from "./debugReport";

const capture = (): Capture => ({
  id: 1,
  at: 1_700_000_000_000,
  width: 2560,
  height: 1440,
  scoreboard: true,
  map: null,
  bans: ["reaper", null],
  ranks: ["gold"],
  rows: [
    { team: "ally", label: "reaper", score: 0.9123, crop: "data:image/png;base64,AAAA", name: null, name_crop: null },
    { team: "enemy", label: null, score: 0.4, crop: "data:image/png;base64,BBBB", name: null, name_crop: null },
  ],
  me: 0,
  sane: true,
  stats: [
    [9, 1, 5, 8614, 907, 6864],
    [null, 0, 3, 1200, 0, 300],
  ],
  grab_ms: 40,
  thumb: "data:image/jpeg;base64,CCCC",
  debug: {
    window: "steam_app_2357570 | Overwatch",
    process_ms: 210,
    ocr_ms: 0,
    saved: true,
    table: [100, 200, 2400],
    row_h: 120.4,
    party: [true, false],
    portraits: [
      [10, 20, 30, 40],
      [10, 60, 30, 40],
    ],
    bans: [[1, 2, 30, 30]],
    ranks: [],
    map_text: [5, 6, 70, 20],
  },
});

const entry = (i: number): LogEntry => ({ at: 1_700_000_000_000 + i, kind: "tab", text: `tab ${i}` });

describe("debug report", () => {
  it("never carries the images", () => {
    const report = buildReport({ version: "2.5.2", locale: "ko", status: null, log: [], capture: capture() });
    expect(report).not.toContain("base64");
    expect(report).not.toContain("data:image");
    expect(report).not.toContain("thumb");
    expect(report).not.toContain("crop");
  });

  it("keeps what the reading was based on", () => {
    const report = JSON.parse(
      buildReport({ version: "2.5.2", locale: "ko", status: { listening: true, error: null, templates: 54, heroes: 54, names: 0, ocr: false, ocr_bundled: false, overlay_visible: true, overlay_topmost: true, game_fullscreen: false }, log: [], capture: capture() }),
    );
    expect(report.version).toBe("2.5.2");
    expect(report.capture.size).toEqual([2560, 1440]);
    expect(report.capture.process_ms).toBe(210);
    expect(report.capture.boxes).toMatchObject({ table: [100, 200, 2400], map_text: [5, 6, 70, 20] });
    expect(report.capture.boxes.portraits).toHaveLength(2);
    expect(report.capture.row_h).toBe(120.4);
    expect(report.capture.rows[0]).toMatchObject({ label: "reaper", score: 0.912, stats: [9, 1, 5, 8614, 907, 6864] });
    expect(report.capture.rows[1].stats).toEqual([null, 0, 3, 1200, 0, 300]);
  });

  it("copes with no capture and caps the log", () => {
    const log = Array.from({ length: MAX_LOG }, (_, i) => entry(i));
    const report = JSON.parse(buildReport({ version: "2.5.2", locale: "en", status: null, log, capture: null }));
    expect(report.capture).toBeNull();
    expect(report.log).toHaveLength(40);
    expect(report.log[0]).toContain("tab 0");
  });
});
