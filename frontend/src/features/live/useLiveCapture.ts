import { useEffect, useState } from "react";
import { invoke, listen, isDesktop } from "../../lib/platform";
import type { Capture } from "./LiveBar";

/** 데스크톱 앱이 마지막으로 읽은 TAB 화면. 오버레이는 메인 창 없이 이것만으로도 정보를 보여 준다 */
export function useLiveCapture() {
  const [latest, setLatest] = useState<Capture | null>(null);
  useEffect(() => {
    if (!isDesktop) return;
    let off: (() => void) | undefined;
    let alive = true;
    invoke<Capture[]>("live_recent")
      .then((r) => {
        if (alive && r[0]) setLatest(r[0]);
      })
      .catch(() => {});
    listen<Capture>("live://capture", (c) => {
      if (alive) setLatest(c);
    }).then((f) => (alive ? (off = f) : f()));
    return () => {
      alive = false;
      off?.();
    };
  }, []);
  return latest;
}
