import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Download, Feather, Flame, Layers, Monitor, ScanLine, ShieldCheck, Smartphone } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LogoMark } from "../../components/Logo";
import { Badge } from "../../components/ui/Badge";
import { Card, Skeleton } from "../../components/ui/misc";
import { api, type AppRelease } from "../../lib/api";
import { buttonClass } from "../../components/ui/Button";
import { clientOs, isRecommended, orderFiles } from "../../lib/os";
import { isDesktop } from "../../lib/platform";

const FEATURES = [
  { key: "f1", icon: ScanLine },
  { key: "f2", icon: Layers },
  { key: "f3", icon: Flame },
  { key: "f4", icon: Feather },
] as const;

const INSTALL: Record<AppRelease["files"][number]["kind"], ((name: string) => string) | null> = {
  rpm: (name) => `sudo dnf install ./${name}`,
  deb: (name) => `sudo apt install ./${name}`,
  appimage: (name) => `chmod +x ./${name}`,
  // Windows는 설치 파일을 실행하면 돼서 복사할 명령이 없다
  exe: null,
};

/** 데스크톱 앱 소개와 내려받기. 파일은 서버가 내려준다 (코드 저장소가 비공개라서) */
export function DownloadPage() {
  const { t } = useTranslation();
  const release = useQuery({ queryKey: ["app-latest"], queryFn: api.appLatest, retry: false, staleTime: 5 * 60_000 });
  const os = clientOs();
  const files = release.data ? orderFiles(release.data.files, os) : [];
  const osLabel = os === "windows" ? t("download.osWindows") : t("download.osLinux");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 pb-6">
      <section className="flex flex-col items-start gap-4 rounded-2xl border border-border bg-gradient-to-br from-accent-soft to-surface px-5 py-7 sm:px-8 sm:py-10">
        <div className="flex items-center gap-3">
          <LogoMark className="size-11" />
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{t("download.title")}</h1>
        </div>
        <p className="max-w-2xl text-base leading-relaxed text-text/90 sm:text-lg">{t("download.lead")}</p>
        {isDesktop ? (
          <p className="inline-flex items-center gap-2 rounded-lg bg-surface px-3 py-2 text-sm font-medium">
            <Monitor className="size-4 text-accent" />
            {t("download.inApp")}
          </p>
        ) : (
          <>
            <a
              href="#download"
              className="hidden h-11 items-center gap-2 rounded-lg bg-accent px-5 text-sm font-semibold text-accent-fg hover:brightness-105 sm:inline-flex"
            >
              <Download className="size-4" />
              {t("download.cta")}
            </a>
            <p className="inline-flex items-start gap-2 text-sm text-muted sm:hidden">
              <Smartphone className="mt-0.5 size-4 shrink-0" />
              {t("download.mobileNote")}
            </p>
          </>
        )}
      </section>

      <section aria-labelledby="features" className="flex flex-col gap-3">
        <h2 id="features" className="text-lg font-bold">
          {t("download.featuresTitle")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {FEATURES.map(({ key, icon: Icon }) => (
            <Card key={key} className="flex gap-3.5 p-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <Icon className="size-5" />
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <h3 className="font-semibold">{t(`download.${key}Title`)}</h3>
                <p className="text-sm leading-relaxed text-muted">{t(`download.${key}`)}</p>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <Card className="flex gap-3.5 border-ally/40 p-4">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-good" />
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold">{t("download.safetyTitle")}</h2>
          <p className="text-sm leading-relaxed text-muted">{t("download.safety")}</p>
        </div>
      </Card>

      <section id="download" aria-labelledby="download-title" className="flex scroll-mt-20 flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="download-title" className="text-lg font-bold">
            {t("download.downloadTitle")}
          </h2>
          {release.data && (
            <span className="text-sm text-muted">
              {t("download.version", { v: release.data.version })}
              {release.data.released && ` · ${t("download.released", { date: release.data.released })}`}
            </span>
          )}
        </div>
        {(os === "windows" || os === "linux") && release.data && (
          <p className="text-xs text-muted">{t("download.osOrder", { os: osLabel })}</p>
        )}
        {release.isPending ? (
          <Skeleton className="h-32" />
        ) : release.data ? (
          <div className="grid gap-3 md:grid-cols-2">
            {files.map((f) => (
              <DownloadCard key={f.name} file={f} recommended={isRecommended(f, os)} />
            ))}
          </div>
        ) : (
          <Card className="p-5 text-sm text-muted">{t("download.none")}</Card>
        )}
      </section>

      {os !== "windows" && os !== "mac" && <FlatpakInstall />}

      <div className="grid gap-3 md:grid-cols-2">
        <Card className="flex flex-col gap-2 p-4">
          <h2 className="font-semibold">{t("download.stepsTitle")}</h2>
          <ol className="flex flex-col gap-2 text-sm">
            {(["step1", "step2", "step3"] as const).map((k, i) => (
              <li key={k} className="flex items-start gap-2.5">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-accent-fg">
                  {i + 1}
                </span>
                <span className="leading-5">{t(`download.${k}`)}</span>
              </li>
            ))}
          </ol>
        </Card>
        <Card className="flex flex-col gap-2 p-4">
          <h2 className="font-semibold">{t("download.requirementsTitle")}</h2>
          <p className="text-sm leading-relaxed text-muted">{t("download.requirements")}</p>
        </Card>
      </div>
    </div>
  );
}

/** Flatpak은 파일이 아니라 저장소라서 따로 안내한다 */
function FlatpakInstall() {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const commands = [
    "flatpak remote-add --if-not-exists pickgak https://pickgak.seolcu.com/api/flatpak/com.seolcu.pickgak.flatpakrepo",
    "flatpak install pickgak com.seolcu.pickgak",
  ];
  const copy = () =>
    void navigator.clipboard?.writeText(commands.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  return (
    <Card className="flex flex-col gap-2 p-4">
      <h2 className="font-semibold">{t("download.flatpakTitle")}</h2>
      <p className="text-sm text-muted">{t("download.flatpakHint")}</p>
      <div className="flex items-start gap-2 rounded-lg bg-surface-2 py-2 pr-1.5 pl-3">
        <code className="min-w-0 flex-1 text-xs break-all whitespace-pre-wrap">{commands.join("\n")}</code>
        <button
          type="button"
          onClick={copy}
          aria-label={t("download.copy")}
          title={copied ? t("download.copied") : t("download.copy")}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-text"
        >
          {copied ? <Check className="size-4 text-good" /> : <Copy className="size-4" />}
        </button>
      </div>
      <p className="text-xs text-muted">{t("download.flatpakUpdate")}</p>
      <p className="text-xs text-muted">{t("download.flatpakTray")}</p>
    </Card>
  );
}

function DownloadCard({ file, recommended }: { file: AppRelease["files"][number]; recommended: boolean }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const command = INSTALL[file.kind]?.(file.name) ?? null;
  const copy = () => {
    if (!command) return;
    void navigator.clipboard?.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    // 그리드 칸은 기본 min-width가 내용 폭이라, 한 줄 설치 명령이 모바일에서 카드를 화면 밖으로 민다
    <Card className="flex min-w-0 flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="font-semibold">{t(`download.${file.kind}`)}</p>
            {recommended && <Badge tone="accent">{t("download.recommended")}</Badge>}
            {file.kind === "appimage" && <Badge tone="muted">{t("download.portable")}</Badge>}
          </div>
          <p className="truncate text-xs text-muted tabular-nums">
            {file.name} · {t("download.size", { mb: (file.size / 1024 / 1024).toFixed(1) })}
          </p>
        </div>
        <a
          href={`/api/app/download/${encodeURIComponent(file.name)}`}
          download
          className={buttonClass("primary", "lg", "shrink-0")}
        >
          <Download className="size-4" />
          <span className="hidden sm:inline">{t("download.cta")}</span>
        </a>
      </div>
      {command ? (
        <div className="flex items-center gap-2 rounded-lg bg-surface-2 py-1.5 pr-1.5 pl-3">
          <code className="min-w-0 flex-1 overflow-x-auto text-xs whitespace-nowrap">{command}</code>
          <button
            type="button"
            onClick={copy}
            aria-label={t("download.copy")}
            title={copied ? t("download.copied") : t("download.copy")}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-text"
          >
            {copied ? <Check className="size-4 text-good" /> : <Copy className="size-4" />}
          </button>
        </div>
      ) : (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">{t("download.exeHint")}</p>
      )}
      {file.sha256 && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer select-none">{t("download.checksum")}</summary>
          <code className="mt-1 block break-all">{file.sha256}</code>
        </details>
      )}
    </Card>
  );
}
