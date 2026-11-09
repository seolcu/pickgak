import { Check, Copy, DownloadCloud, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { isDesktop } from "../../lib/platform";
import { useUpdate } from "./useUpdate";

/** 앱을 켠 뒤 조용히 확인하기까지 */
const CHECK_AFTER_MS = 3000;

/** 새 버전이 있으면 화면 위에 띄우는 줄. "나중에"를 누른 버전은 다시 띄우지 않는다 */
export function UpdateBanner() {
  const { t } = useTranslation();
  const update = useUpdate();
  const { check } = update;

  useEffect(() => {
    if (!isDesktop) return;
    const id = setTimeout(() => void check(), CHECK_AFTER_MS);
    return () => clearTimeout(id);
  }, [check]);

  if (!isDesktop || !update.info?.newer || update.hidden) return null;
  const { info, installing, progress, error } = update;

  return (
    <Banner
      className="mb-4"
      icon={<DownloadCloud />}
      title={t("update.available", { v: info.latest })}
      actions={
        <>
          {info.install === "flatpak" ? (
            <FlatpakCommand command={info.command} />
          ) : (
            <Button size="sm" onClick={() => void update.install()} disabled={installing}>
              {installing ? <Loader2 className="size-4 animate-spin" /> : <DownloadCloud className="size-4" />}
              {installing ? t("update.installing") : t("update.install")}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={update.skip} disabled={installing}>
            {t("update.later")}
          </Button>
        </>
      }
    >
      <span className="text-xs text-muted">{t("update.current", { v: info.current })}</span>
      {installing && progress !== null && <span className="text-xs text-muted">{t("update.downloading", { p: progress })}</span>}
      {installing && <span className="w-full text-xs text-muted">{t("update.installHint")}</span>}
      {error && <span className="w-full text-xs text-bad">{error}</span>}
    </Banner>
  );
}

/** Flatpak은 앱이 자기 패키지를 바꿀 수 없어서 명령을 보여 주고 복사하게 한다 */
export function FlatpakCommand({ command }: { command: string | null }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  if (!command) return null;
  const copy = () =>
    void navigator.clipboard?.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-lg border border-border bg-surface py-1 pr-1 pl-2">
      <code className="truncate font-mono text-[11px]" title={command}>
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={t("update.copyCommand")}
        title={copied ? t("update.copied") : t("update.copyCommand")}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-text"
      >
        {copied ? <Check className="size-3.5 text-good" /> : <Copy className="size-3.5" />}
      </button>
    </span>
  );
}
