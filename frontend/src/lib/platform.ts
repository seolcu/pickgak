/**
 * 실행 환경: 데스크톱 앱(Tauri)인지 웹인지.
 * 데스크톱에서는 API를 Rust 쪽이 대신 호출한다 (CORS·Origin 문제 없음). 이미지 주소는 서버 절대 주소로 바꾼다.
 */
export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const SERVER = "https://pickgak.seolcu.com";

/** 화면에 쓰는 API 자원 주소 (예: 전장 이미지) */
export const apiAsset = (path: string) => (isDesktop ? `${SERVER}/api${path}` : `/api${path}`);

/** 데스크톱 앱 명령 호출 (웹에서는 쓰지 않는다). 웹 번들에 Tauri 코드가 섞이지 않게 필요할 때 불러온다 */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function listen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<T>(event, (e) => handler(e.payload));
}

/** 앱 버전 (디버그 보고서에 적는다). 웹에서는 쓰지 않는다 */
export async function appVersion(): Promise<string> {
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}
