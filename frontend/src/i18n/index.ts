import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import { loadLocal, removeLocal, saveLocal } from "../lib/storage";

/**
 * 번역 파일은 src/locales/<언어>/<영역>.json. 키는 "<영역>.<키>"로 쓴다 (예: t("pick.title")).
 * 언어를 추가하려면 폴더를 만들고 LANGUAGES에 넣으면 된다. `npm run i18n:check`가 키 누락을 검사한다.
 */
export const LANGUAGES = [
  { code: "ko", label: "한국어" },
  { code: "en", label: "English" },
] as const;

const LANG_KEY = "pickgak.lang";

/** Language the user picked in the UI ("auto" = follow the browser locale) */
export function chosenLanguage(): string {
  return loadLocal<string>(LANG_KEY, "auto", { raw: true });
}

export function setLanguage(code: string) {
  if (code === "auto") {
    removeLocal(LANG_KEY);
    const nav = navigator.languages?.length ? navigator.languages : [navigator.language];
    const match = nav.map((l) => l.toLowerCase().split("-")[0]).find((l) => LANGUAGES.some((x) => x.code === l));
    void i18n.changeLanguage(match ?? "en");
  } else {
    saveLocal(LANG_KEY, code, { raw: true });
    void i18n.changeLanguage(code);
  }
}

const files = import.meta.glob<{ default: Record<string, unknown> }>("../locales/*/*.json", { eager: true });

const resources: Record<string, { translation: Record<string, unknown> }> = {};
for (const [path, mod] of Object.entries(files)) {
  const [, lang, area] = path.match(/locales\/([^/]+)\/([^/]+)\.json$/)!;
  resources[lang] ??= { translation: {} };
  resources[lang].translation[area] = mod.default;
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    supportedLngs: LANGUAGES.map((l) => l.code),
    nonExplicitSupportedLngs: true,
    // Korean browser locale -> Korean, anything else -> English
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    // An explicit choice (setLanguage) wins; otherwise follow the browser every visit.
    // Detected languages are not cached, so a later browser-language change is respected.
    detection: { order: ["localStorage", "navigator"], lookupLocalStorage: LANG_KEY, caches: [] },
  });

// <html lang> uses the resolved base language (ko / en), not the raw browser tag (ko-KR)
i18n.on("languageChanged", () => {
  document.documentElement.lang = i18n.resolvedLanguage ?? "en";
});
document.documentElement.lang = i18n.resolvedLanguage ?? "en";

export default i18n;
