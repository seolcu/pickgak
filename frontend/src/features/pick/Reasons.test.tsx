import { renderToStaticMarkup } from "react-dom/server";
import i18next from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { beforeAll, describe, expect, it } from "vitest";
import reasons from "../../locales/ko/reasons.json";
import type { Hero, Reason } from "../../lib/api";
import { ReasonChips } from "./Reasons";

const hero = (hero_id: string, name: string): Hero => ({
  hero_id,
  name,
  role: "damage",
  subrole: null,
  color: null,
  thumbnail: null,
});
const heroes = new Map(
  [hero("winston", "윈스턴"), hero("sierra", "시에라"), hero("doctrine", "독트린"), hero("ana", "아나")].map(
    (h) => [h.hero_id, h],
  ),
);

// 오버레이 스크린샷(2026-10-30)의 겐지 추천: 칩 7개가 한 영웅 밑에 쌓여 목록이 잘렸다
const genji: Reason[] = [
  { kind: "map", win_rate: 53.9, pick_rate: 10, win_diff: -0.6, tier: "S" },
  { kind: "meta", tier: "S", win_rate: 54.5, pick_rate: 10 },
  { kind: "countered", enemy: "winston", strength: 1.2 },
  { kind: "threat_counter", enemy: "sierra" },
  { kind: "threat_counter", enemy: "doctrine" },
  { kind: "counter", enemy: "ana", strength: 0.5 },
  { kind: "preferred" },
];

const chips = (html: string) => html.match(/<li/g)?.length ?? 0;

// 앱의 i18n 초기화는 document를 건드리므로, 이 테스트는 이유 문구만 담은 인스턴스를 쓴다
const i18n = i18next.createInstance();
const render = (el: React.ReactElement) => renderToStaticMarkup(<I18nextProvider i18n={i18n}>{el}</I18nextProvider>);

describe("ReasonChips compact", () => {
  beforeAll(() =>
    i18n.use(initReactI18next).init({
      lng: "ko",
      resources: { ko: { translation: { reasons } } },
      interpolation: { escapeValue: false },
    }),
  );

  it("drops what badges already show, merges kinds and caps the count", () => {
    const html = render(<ReasonChips reasons={genji} heroes={heroes} compact />);
    expect(chips(html)).toBe(3);
    expect(html).toContain("위험 시에라·독트린 카운터");
    expect(html).toContain("아나 상대 유리");
    expect(html).toContain("윈스턴에 불리");
    expect(html).not.toContain("S티어");
    expect(html).not.toContain("선호 영웅");
  });

  it("keeps the full list outside the overlay", () => {
    const html = render(<ReasonChips reasons={genji} heroes={heroes} mapName="아이헨발데" />);
    expect(chips(html)).toBe(genji.length);
  });
});
