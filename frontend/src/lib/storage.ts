/** localStorage 래퍼. 사생활 보호 모드 등에서 실패해도 앱은 기본값으로 동작한다. */
export function loadLocal<T>(key: string, fallback: T, opts: { raw?: boolean } = {}): T {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return opts.raw ? (v as T) : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function saveLocal(key: string, value: unknown, opts: { raw?: boolean } = {}) {
  try {
    localStorage.setItem(key, opts.raw ? String(value) : JSON.stringify(value));
  } catch {
    /* 저장할 수 없는 환경은 무시 */
  }
}

export function removeLocal(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* 저장할 수 없는 환경은 무시 */
  }
}
