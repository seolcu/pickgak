import { Database, Languages, LayoutTemplate, Monitor, MonitorDown, Moon, Palette, ShieldCheck, Sun, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "../../components/ui/Button";
import { Page, PageHeader } from "../../components/ui/Page";
import { SectionCard } from "../../components/ui/SectionCard";
import { Segmented } from "../../components/ui/Segmented";
import { useConfig } from "../../hooks/data";
import { chosenLanguage, LANGUAGES, setLanguage } from "../../i18n";
import { usePrefs } from "../../hooks/prefs";
import { HOME_LAYOUT_KEY, type HomeLayout } from "../pick/homeLayout";
import { loadLocal, saveLocal } from "../../lib/storage";
import { invoke, isDesktop } from "../../lib/platform";
import type { UpdateInfo } from "../../lib/update";
import { useTheme, type ThemeSetting } from "../../theme/ThemeProvider";
import { FlatpakCommand } from "../update/UpdateBanner";
import { useUpdate } from "../update/useUpdate";

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { setting, setSetting } = useTheme();
  const config = useConfig().data;
  const { setMap } = usePrefs();
  const [lang, setLang] = useState(chosenLanguage);
  const [layout, setLayout] = useState<HomeLayout>(() => loadLocal(HOME_LAYOUT_KEY, "board"));

  return (
    <Page width="narrow">
      <PageHeader title={t("settings.title")} />

      <SectionCard icon={<Palette />} title={t("settings.theme")}>
        <Segmented<ThemeSetting>
          label={t("settings.theme")}
          value={setting}
          onChange={setSetting}
          options={[
            { value: "system", label: <><Monitor className="size-4" />{t("settings.themeSystem")}</> },
            { value: "light", label: <><Sun className="size-4" />{t("settings.themeLight")}</> },
            { value: "dark", label: <><Moon className="size-4" />{t("settings.themeDark")}</> },
          ]}
        />
      </SectionCard>

      <SectionCard icon={<Languages />} title={t("settings.language")}>
        <Segmented
          label={t("settings.language")}
          value={lang}
          onChange={(l) => {
            setLang(l);
            setLanguage(l);
          }}
          options={[
            { value: "auto", label: t("settings.languageAuto") },
            ...LANGUAGES.map((l) => ({ value: l.code, label: l.label })),
          ]}
        />
      </SectionCard>

      {isDesktop && (
        <SectionCard icon={<LayoutTemplate />} title={t("settings.game")}>
          <Segmented<HomeLayout>
            label={t("settings.homeLayout")}
            value={layout}
            onChange={(v) => {
              setLayout(v);
              saveLocal(HOME_LAYOUT_KEY, v);
            }}
            options={[
              { value: "coach", label: t("settings.layoutCoach") },
              { value: "board", label: t("settings.layoutBoard") },
              { value: "hub", label: t("settings.layoutHub") },
            ]}
          />
          <p className="text-xs text-muted">{t("settings.homeLayoutHint")}</p>
        </SectionCard>
      )}

      <SectionCard icon={<Database />} title={t("settings.data")}>
        <p className="text-sm text-muted">{t("settings.dataHint")}</p>
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {(config?.regions ?? []).map((r) => {
            const last = config?.last_collected[r];
            return (
              <li key={r} className="flex justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2">
                <span className="font-medium">{t(`regions.${r}`)}</span>
                <span className="text-muted tabular-nums">
                  {last ? new Date(last).toLocaleString(i18n.language) : t("settings.notYet")}
                </span>
              </li>
            );
          })}
        </ul>
        {config?.collecting && <p className="text-xs text-muted">{t("data.updatingHint")}</p>}
        {isDesktop && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                if (!window.confirm(t("settings.forgetMapsConfirm"))) return;
                invoke("live_forget_maps")
                  .then(() => {
                    setMap("all");
                    toast(t("settings.forgetMapsDone"));
                  })
                  .catch(() => toast.error(t("errors.unknown")));
              }}
            >
              <Trash2 className="size-4" />
              {t("settings.forgetMaps")}
            </Button>
            <span className="text-xs text-muted">{t("settings.forgetMapsHint")}</span>
          </div>
        )}
      </SectionCard>

      {isDesktop && <UpdateSection />}

      <SectionCard icon={<ShieldCheck />} title={t("settings.safety")}>
        <p className="text-sm text-muted">{t("settings.safetyText")}</p>
      </SectionCard>
    </Page>
  );
}

const KIND: Record<UpdateInfo["install"], string> = {
  native: "update.kindNative",
  appimage: "update.kindAppimage",
  flatpak: "update.kindFlatpak",
  windows: "update.kindWindows",
};

/** 데스크톱 앱에서만: 현재 버전과 업데이트 확인·설치 */
function UpdateSection() {
  const { t } = useTranslation();
  const update = useUpdate();
  const { info, checking, installing, progress, error, check } = update;
  useEffect(() => {
    void check();
  }, [check]);

  return (
    <SectionCard icon={<MonitorDown />} title={t("update.title")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="font-medium">{t("update.current", { v: info?.current ?? "-" })}</span>
        {info && (
          <span className="text-muted">{info.newer ? t("update.latest", { v: info.latest }) : t("update.upToDate")}</span>
        )}
        {info && <span className="text-xs text-muted">{t("update.kind", { kind: t(KIND[info.install]) })}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => void check()} disabled={checking || installing}>
          {checking ? t("update.checking") : t("update.check")}
        </Button>
        {info?.newer && info.install !== "flatpak" && (
          <Button size="sm" onClick={() => void update.install()} disabled={installing}>
            {installing ? t("update.installing") : t("update.install")}
          </Button>
        )}
        {installing && progress !== null && <span className="text-xs text-muted">{t("update.downloading", { p: progress })}</span>}
      </div>
      {info?.newer && info.install === "flatpak" && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted">{t("update.flatpakHint")}</p>
          <FlatpakCommand command={info.command} />
        </div>
      )}
      {installing && <p className="text-xs text-muted">{t("update.installHint")}</p>}
      {error && <p className="text-xs text-bad">{error}</p>}
    </SectionCard>
  );
}
