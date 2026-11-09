import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { isDesktop } from "../../lib/platform";
import { loadLocal, saveLocal } from "../../lib/storage";
import { checkUpdate, installUpdate, onUpdateProgress, type UpdateInfo } from "../../lib/update";

/** "나중에"를 누른 버전. 다음 버전이 나오면 다시 알린다 */
const SKIP_KEY = "pickgak.update.skip";

/**
 * 업데이트 확인과 설치. 성공하면 Rust 쪽이 앱을 다시 시작하므로 install()은 끝나지 않는다.
 * 실패는 번역된 문구로 돌려준다 (Rust는 "update.xxx" 코드만 보낸다).
 */
export function useUpdate() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  /** 내려받기 진행률 (%) */
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(() => loadLocal(SKIP_KEY, ""));

  const message = useCallback(
    (e: unknown) => {
      const code = String(e);
      return code.startsWith("update.") ? t(code) : `${t("update.failed")} (${code})`;
    },
    [t],
  );

  const check = useCallback(async () => {
    if (!isDesktop) return;
    setChecking(true);
    setError(null);
    try {
      setInfo(await checkUpdate());
    } catch (e) {
      setError(message(e));
    } finally {
      setChecking(false);
    }
  }, [message]);

  const install = useCallback(async () => {
    if (!isDesktop || installing || !info) return;
    setInstalling(true);
    setProgress(null);
    setError(null);
    const off = await onUpdateProgress((p) => setProgress(p.total > 0 ? Math.round((p.done / p.total) * 100) : null));
    try {
      await installUpdate();
    } catch (e) {
      const msg = message(e);
      setError(msg);
      toast.error(msg);
      setInstalling(false);
      setProgress(null);
    } finally {
      off();
    }
  }, [info, installing, message]);

  const skip = useCallback(() => {
    if (!info) return;
    saveLocal(SKIP_KEY, info.latest);
    setSkipped(info.latest);
  }, [info]);

  return {
    info,
    checking,
    installing,
    progress,
    error,
    check,
    install,
    skip,
    /** 이 버전을 "나중에"로 미뤄 배너를 숨긴다 */
    hidden: !!info && skipped === info.latest,
  };
}
