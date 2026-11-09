// 번역 키 검사: 모든 언어가 같은 키를 갖는지, 코드에서 쓰는 고정 키가 기준 언어(ko)에 있는지.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const localesDir = join(root, "locales");
const BASE = "ko";

const flatten = (obj, prefix = "") =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );

const keysOf = (lang) =>
  new Set(
    readdirSync(join(localesDir, lang))
      .filter((f) => f.endsWith(".json"))
      .flatMap((f) => flatten(JSON.parse(readFileSync(join(localesDir, lang, f), "utf8")), `${f.slice(0, -5)}.`)),
  );

const langs = readdirSync(localesDir);
const base = keysOf(BASE);
let errors = 0;
for (const lang of langs.filter((l) => l !== BASE)) {
  const keys = keysOf(lang);
  for (const k of base) if (!keys.has(k)) (errors++, console.error(`[${lang}] missing: ${k}`));
  for (const k of keys) if (!base.has(k)) (errors++, console.error(`[${lang}] extra (not in ${BASE}): ${k}`));
}

// 코드에서 t("area.key") 형태로 쓰는 고정 키 (템플릿 문자열로 만든 동적 키는 제외)
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name)) : /\.(tsx?)$/.test(d.name) ? [join(dir, d.name)] : [],
  );
for (const file of walk(root)) {
  for (const [, key] of readFileSync(file, "utf8").matchAll(/\bt\(\s*["']([a-zA-Z_]+\.[a-zA-Z_.]+)["']/g)) {
    if (!base.has(key)) (errors++, console.error(`${file.replace(root, "src/")}: unknown key ${key}`));
  }
}

if (errors) {
  console.error(`\n${errors} i18n problem(s)`);
  process.exit(1);
}
console.log(`i18n ok: ${base.size} keys × ${langs.length} languages`);
