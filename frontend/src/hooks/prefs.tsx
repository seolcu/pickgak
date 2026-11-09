import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { effectiveFilters, type StatFilters } from "../lib/api";
import { loadLocal, saveLocal } from "../lib/storage";

/** 여러 화면이 공유하는 통계 조건과 전장 선택. 브라우저에 기억한다. */
interface Prefs {
  /** 화면에 보이는 선택 (빠른 대전이어도 마지막 등급 선택을 기억) */
  filters: StatFilters;
  setFilters: (f: StatFilters) => void;
  /** 실제 요청에 쓰는 조건 (빠른 대전이면 등급 합산) */
  query: StatFilters;
  map: string;
  setMap: (m: string) => void;
}

const PrefsContext = createContext<Prefs | null>(null);
const DEFAULT: StatFilters = { region: "korea", rq: "2", rank: "all" };

function loadFilters(): StatFilters {
  // 예전 버전에 저장된 값(input 등)은 버리고 필요한 키만 가져온다
  const saved = loadLocal<Partial<StatFilters>>("pickgak.filters", {});
  return {
    region: saved.region ?? DEFAULT.region,
    rq: saved.rq ?? DEFAULT.rq,
    rank: saved.rank ?? DEFAULT.rank,
  };
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<StatFilters>(loadFilters);
  const [map, setMap] = useState<string>(() => loadLocal("pickgak.map", "all"));
  useEffect(() => saveLocal("pickgak.filters", filters), [filters]);
  useEffect(() => saveLocal("pickgak.map", map), [map]);
  // 메인 창과 오버레이는 같은 저장소를 쓴다. 다른 창에서 바꾼 필터/전장을 따라간다.
  useEffect(() => {
    const on = (e: StorageEvent) => {
      if (e.key === "pickgak.filters") setFilters(loadFilters());
      if (e.key === "pickgak.map") setMap(loadLocal("pickgak.map", "all"));
    };
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, []);
  const query = useMemo(() => effectiveFilters(filters), [filters]);
  return <PrefsContext.Provider value={{ filters, setFilters, query, map, setMap }}>{children}</PrefsContext.Provider>;
}

export function usePrefs() {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error("usePrefs must be used inside PrefsProvider");
  return ctx;
}
