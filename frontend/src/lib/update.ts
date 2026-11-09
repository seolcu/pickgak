import { invoke, listen } from "./platform";

/** 내려받을 파일 (서버의 latest.json 항목, Rust update.rs와 같은 모양) */
export interface UpdateFile {
  name: string;
  kind: "rpm" | "deb" | "appimage" | "exe";
  size: number;
  sha256: string | null;
}

/** 업데이트 확인 결과 (Rust update.rs의 UpdateInfo와 같은 모양) */
export interface UpdateInfo {
  current: string;
  latest: string;
  released: string;
  newer: boolean;
  /** 이 앱이 설치된 형태 */
  install: "native" | "appimage" | "flatpak" | "windows";
  /** 이 설치 형태에 맞는 파일 (Flatpak은 없다) */
  file: UpdateFile | null;
  /** Flatpak에서 대신 실행할 명령 */
  command: string | null;
}

export interface UpdateProgress {
  done: number;
  total: number;
  name: string;
}

export const checkUpdate = () => invoke<UpdateInfo>("update_check");
export const installUpdate = () => invoke<void>("update_install");
export const onUpdateProgress = (cb: (p: UpdateProgress) => void) => listen<UpdateProgress>("update://progress", cb);
