import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { loadLocal, saveLocal } from "../lib/storage";

/** 선택 가능한 테마. tokens.css에 같은 이름의 [data-theme] 블록이 있어야 한다. */
export const THEMES = ["light", "dark"] as const;
export type ThemeName = (typeof THEMES)[number];
export type ThemeSetting = ThemeName | "system";

const KEY = "pickgak.theme"; // index.html의 초기 적용 스크립트와 같은 키

interface ThemeState {
  setting: ThemeSetting;
  resolved: ThemeName;
  setSetting: (s: ThemeSetting) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

const systemTheme = (): ThemeName =>
  window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";

export function ThemeProvider({ children }: { children: ReactNode }) {
  // index.html이 이미 문자열 그대로 저장한 값을 쓰므로 JSON이 아닌 원문으로 읽고 쓴다
  const [setting, setSetting] = useState<ThemeSetting>(() => loadLocal(KEY, "system", { raw: true }) as ThemeSetting);
  const [system, setSystem] = useState<ThemeName>(systemTheme);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = () => setSystem(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolved = setting === "system" ? system : setting;

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    saveLocal(KEY, setting, { raw: true });
  }, [resolved, setting]);

  return <ThemeContext.Provider value={{ setting, resolved, setSetting }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
