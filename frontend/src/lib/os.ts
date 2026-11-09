export type ClientOs = "windows" | "linux" | "mac" | "other";

/** 브라우저가 알려 주는 운영체제 (다운로드 순서를 정하는 데만 쓴다) */
export function clientOs(): ClientOs {
  if (typeof navigator === "undefined") return "other";
  const ua = (navigator.userAgent || "").toLowerCase();
  // 모바일은 데스크톱 앱을 설치할 수 없다 (안드로이드 UA에는 linux가 들어 있다)
  if (/android|iphone|ipad|ipod/.test(ua)) return "other";
  if (ua.includes("windows")) return "windows";
  if (ua.includes("mac os") || ua.includes("macintosh")) return "mac";
  if (ua.includes("linux") || ua.includes("x11")) return "linux";
  return "other";
}

export interface ReleaseFile {
  name: string;
  kind: string;
  os: "linux" | "windows";
}

/**
 * 지금 쓰는 운영체제 파일을 먼저, 그 안에서는 설치 패키지(rpm/deb/exe)를 AppImage보다 먼저.
 * 같은 순위는 서버가 준 순서를 그대로 둔다 (Array.prototype.sort는 안정 정렬).
 */
export function orderFiles<T extends ReleaseFile>(files: readonly T[], os: ClientOs): T[] {
  // an OS we cannot install on is still shown, just after the useful group
  const group = (f: T) => {
    if (os === "windows") return f.os === "windows" ? 0 : 1;
    return f.os === "linux" ? 0 : 1;
  };
  const rank = (f: T) => group(f) * 10 + (f.kind === "appimage" ? 1 : 0);
  return [...files].sort((a, b) => rank(a) - rank(b));
}

/** "추천" 표시: 지금 OS의 설치 패키지 (AppImage는 포터블) */
export function isRecommended(file: ReleaseFile, os: ClientOs): boolean {
  if (file.kind === "appimage") return false;
  return file.os === os || (os === "other" && file.os === "linux");
}
