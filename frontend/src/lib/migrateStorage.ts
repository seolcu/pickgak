/**
 * 이름을 옵픽(owpick)에서 픽각(pickgak)으로 바꾸면서, 브라우저에 저장된 설정(판, 필터, 테마, 언어 등)을 옮긴다.
 * i18n·테마가 저장값을 읽기 전에 실행되도록 main.tsx에서 가장 먼저 import 한다.
 */
const OLD = "owpick.";
const NEW = "pickgak.";

try {
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(OLD)) continue;
    const next = NEW + key.slice(OLD.length);
    if (localStorage.getItem(next) === null) localStorage.setItem(next, localStorage.getItem(key)!);
    localStorage.removeItem(key);
  }
} catch {
  /* 저장소를 쓸 수 없는 환경은 무시 */
}
