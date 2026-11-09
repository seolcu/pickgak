import { Download, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Banner } from "../../components/ui/Banner";
import { Button, ButtonLink } from "../../components/ui/Button";
import { isDesktop } from "../../lib/platform";
import { loadLocal, saveLocal } from "../../lib/storage";

const KEY = "pickgak.appBanner.closed";

/** 웹 픽 화면 위의 데스크톱 앱 안내. 닫으면 다시 안 보인다 (앱 안에서는 안 보임) */
export function AppBanner() {
  const { t } = useTranslation();
  const [closed, setClosed] = useState(() => loadLocal(KEY, false));
  if (isDesktop || closed) return null;
  return (
    <Banner
      icon={<Download />}
      actions={
        <>
          <ButtonLink to="/download" size="sm">
            {t("download.bannerMore")}
          </ButtonLink>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setClosed(true);
              saveLocal(KEY, true);
            }}
            aria-label={t("download.bannerClose")}
            className="size-8"
          >
            <X className="size-4" />
          </Button>
        </>
      }
    >
      <p className="min-w-0 flex-1 leading-snug font-medium">{t("download.bannerTitle")}</p>
    </Banner>
  );
}
