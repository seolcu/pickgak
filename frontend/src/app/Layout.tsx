import { BarChart3, CircleUserRound, Crosshair, Download, MapPinned, Moon, Search, Settings, Sun, TrendingUp, UsersRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router";
import { CommandPalette, usePaletteHotkey } from "../components/CommandPalette";
import { DataBadge } from "../components/DataState";
import { UpdateBanner } from "../features/update/UpdateBanner";
import { useAccount } from "../hooks/data";
import { LogoMark } from "../components/Logo";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/Button";
import { LANGUAGES, setLanguage } from "../i18n";
import { cn } from "../lib/cn";
import { isDesktop } from "../lib/platform";
import { useTheme } from "../theme/ThemeProvider";

// mobile: 모바일 하단 탭에도 보일지 (설정은 모바일에서 헤더 아이콘으로)
const NAV = [
  { to: "/", key: "pick", icon: Crosshair, mobile: true },
  { to: "/meta", key: "meta", icon: BarChart3, mobile: true },
  { to: "/maps", key: "maps", icon: MapPinned, mobile: true },
  { to: "/trends", key: "trends", icon: TrendingUp, mobile: true },
  { to: "/players", key: "players", icon: UsersRound, mobile: true },
  { to: "/settings", key: "settings", icon: Settings, mobile: false },
] as const;

export function Layout() {
  const { t, i18n } = useTranslation();
  const { resolved, setSetting } = useTheme();
  const nextLang = LANGUAGES.find((l) => !i18n.language.startsWith(l.code)) ?? LANGUAGES[0];
  const [palette, setPalette] = useState(false);
  const togglePalette = useCallback(() => setPalette((v) => !v), []);
  usePaletteHotkey(togglePalette);

  // 탭 제목도 언어에 맞춰 (한국어: 픽각, 영어: PickGak)
  useEffect(() => {
    document.title = t("app.name");
  }, [t, i18n.language]);

  return (
    <div className="min-h-dvh pb-24 lg:pb-0">
      <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1800px] items-center gap-4 px-4 lg:px-8">
          <NavLink to="/" className="flex shrink-0 items-center gap-2.5" aria-label={t("app.name")}>
            <LogoMark className="size-8" />
            <span className="text-lg leading-none font-extrabold tracking-tight">{t("app.name")}</span>
            {/* 부제: 작게, 로고와 떨어뜨려서 (좁은 화면에서는 숨김) */}
            <span className="ml-1.5 hidden border-l border-border pl-3 text-xs leading-none font-medium text-muted xl:inline">
              {t("app.subtitle")}
            </span>
          </NavLink>
          <nav className="ml-4 hidden gap-1 lg:flex" aria-label={t("app.nav")}>
            {NAV.map(({ to, key, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  cn(
                    "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium whitespace-nowrap",
                    isActive ? "bg-surface-2 text-text" : "text-muted hover:text-text",
                  )
                }
              >
                <Icon className="size-4" />
                {t(`nav.${key}`)}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <DataBadge />
            <button
              type="button"
              onClick={() => setPalette(true)}
              aria-label={t("palette.title")}
              className="mr-1 inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-sm text-muted hover:text-text sm:min-w-56 lg:min-w-0 2xl:min-w-56"
            >
              <Search className="size-4" />
              {/* lg~2xl에서는 아이콘만 (메뉴·배지·계정이 한 줄에 들어가게) */}
              <span className="hidden flex-1 text-left sm:inline lg:hidden 2xl:inline">{t("palette.button")}</span>
              <kbd className="hidden rounded border border-border px-1.5 text-[10px] sm:inline lg:hidden 2xl:inline">
                Ctrl K
              </kbd>
            </button>
            {/* 데스크톱 앱 받기 (웹에서만, 넓은 화면) */}
            {!isDesktop && (
              <NavLink
                to="/download"
                className={({ isActive }) =>
                  cn(
                    "mr-1 hidden h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold whitespace-nowrap md:inline-flex",
                    isActive ? "bg-accent-soft text-accent" : "bg-accent text-accent-fg hover:brightness-105",
                  )
                }
              >
                <Download className="size-4" />
                {t("download.cta")}
              </NavLink>
            )}
            <AccountButton />
            <Link
              to="/settings"
              aria-label={t("nav.settings")}
              className="inline-flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-text lg:hidden"
            >
              <Settings className="size-4" />
            </Link>
            {/* 언어·테마는 좁은 화면에서 설정 화면으로 (헤더가 붐비지 않게) */}
            <div className="hidden items-center gap-1 sm:flex">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLanguage(nextLang.code)}
                aria-label={t("settings.language")}
              >
                {nextLang.label}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSetting(resolved === "dark" ? "light" : "dark")}
                aria-label={t("settings.toggleTheme")}
              >
                {resolved === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1800px] px-4 py-5 lg:px-8">
        {/* 데스크톱 앱에서만: 새 버전이 있으면 조용히 알린다 */}
        <UpdateBanner />
        <Outlet />
      </main>

      {/* 모바일 하단 탭 */}
      <nav
        aria-label={t("app.nav")}
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        {NAV.filter((n) => n.mobile).map(({ to, key, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              cn(
                "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium",
                isActive ? "text-accent" : "text-muted",
              )
            }
          >
            <Icon className="size-5" />
            {t(`nav.${key}`)}
          </NavLink>
        ))}
      </nav>

      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}

/** 헤더의 계정 버튼: 비회원은 '로그인', 회원은 아이디 */
function AccountButton() {
  const { t } = useTranslation();
  const { account, isFetched } = useAccount();
  return (
    <Link
      to="/account"
      title={account ? t("account.title") : t("account.loginHint")}
      className={cn(
        "inline-flex h-9 max-w-36 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium hover:bg-surface-2",
        account ? "text-text" : "text-muted hover:text-text",
        !isFetched && "invisible",
      )}
    >
      <CircleUserRound className="size-4 shrink-0" />
      <span className="hidden truncate sm:inline">{account ? account.username : t("account.login")}</span>
    </Link>
  );
}
