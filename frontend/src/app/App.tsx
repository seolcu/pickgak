import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import { Toaster } from "sonner";
import { Skeleton } from "../components/ui/misc";
import { PickPage } from "../features/pick/PickPage";
import { PrefsProvider } from "../hooks/prefs";
import { ApiError } from "../lib/api";
import { ThemeProvider, useTheme } from "../theme/ThemeProvider";
import { Layout } from "./Layout";

// 메인(픽) 화면 외에는 처음 열 때 불러온다
const MetaPage = lazy(() => import("../features/meta/MetaPage").then((m) => ({ default: m.MetaPage })));
const TrendsPage = lazy(() => import("../features/trends/TrendsPage").then((m) => ({ default: m.TrendsPage })));
const PlayersPage = lazy(() => import("../features/players/PlayersPage").then((m) => ({ default: m.PlayersPage })));
const HeroPage = lazy(() => import("../features/heroes/HeroPage").then((m) => ({ default: m.HeroPage })));
const MapsPage = lazy(() => import("../features/maps/MapsPage").then((m) => ({ default: m.MapsPage })));
const SettingsPage = lazy(() => import("../features/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const DownloadPage = lazy(() =>
  import("../features/download/DownloadPage").then((m) => ({ default: m.DownloadPage })),
);
const AccountPage = lazy(() => import("../features/account/AccountPage").then((m) => ({ default: m.AccountPage })));

const page = (el: React.ReactNode) => <Suspense fallback={<Skeleton className="h-96" />}>{el}</Suspense>;

// 세션이 끝났거나 다른 기기에서 '모든 기기 로그아웃'을 했으면 화면도 바로 비회원으로 돌린다
const signedOut = (e: unknown) => {
  if (e instanceof ApiError && e.status === 401 && e.code === "login_required") {
    queryClient.setQueryData(["account"], null);
  }
};

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: signedOut }),
  mutationCache: new MutationCache({ onError: signedOut }),
  defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 30_000 } },
});

function ThemedToaster() {
  const { resolved } = useTheme();
  return <Toaster theme={resolved} position="top-center" richColors closeButton />;
}

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <PrefsProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<PickPage />} />
                <Route path="meta" element={page(<MetaPage />)} />
                <Route path="trends" element={page(<TrendsPage />)} />
                <Route path="maps" element={page(<MapsPage />)} />
                <Route path="heroes/:id" element={page(<HeroPage />)} />
                <Route path="players" element={page(<PlayersPage />)} />
                <Route path="settings" element={page(<SettingsPage />)} />
                <Route path="account" element={page(<AccountPage />)} />
                <Route path="download" element={page(<DownloadPage />)} />
                <Route path="*" element={<PickPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
          <ThemedToaster />
        </PrefsProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
