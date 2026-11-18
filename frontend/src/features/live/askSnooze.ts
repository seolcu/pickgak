/**
 * 파티원 이름 질문을 한 번 띄운 뒤 같은 사람(이름 제안이 없으면 같은 영웅 줄)은 한동안 다시 묻지 않는다.
 * 예전에는 판이 바뀔 때마다 다시 물어서, 답하지 않고 게임을 하는 사람에게는 판마다 같은 질문이 떴다.
 * 앱을 다시 켜도 이어지도록 저장한다.
 */
export const ASK_SNOOZE_KEY = "pickgak.partyAsk.snooze";
/** 같은 질문을 다시 띄우기까지의 시간 */
export const ASK_SNOOZE_MS = 12 * 60 * 60 * 1000;

export type Snooze = Record<string, number>;

export function isSnoozed(s: Snooze, key: string, now: number): boolean {
  const until = s[key];
  return typeof until === "number" && until > now;
}

/** key를 지금부터 ASK_SNOOZE_MS 동안 미룬다. 기한이 지난 항목은 함께 지운다. */
export function snooze(s: Snooze, key: string, now: number): Snooze {
  const out: Snooze = {};
  for (const [k, until] of Object.entries(s)) {
    if (typeof until === "number" && until > now) out[k] = until;
  }
  out[key] = now + ASK_SNOOZE_MS;
  return out;
}

/** 저장된 값이 이상하면 빈 것으로 본다 */
export function parseSnooze(v: unknown): Snooze {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Snooze = {};
  for (const [k, until] of Object.entries(v as Record<string, unknown>)) {
    if (typeof until === "number" && Number.isFinite(until)) out[k] = until;
  }
  return out;
}

/** 답이 저장되지 못했을 때: 안내대로 다음 TAB에서 다시 물을 수 있게 미룬 것을 푼다 */
export function unsnooze(s: Snooze, key: string): Snooze {
  const out = { ...s };
  delete out[key];
  return out;
}
