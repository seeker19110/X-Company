// UX-DS-001: token gốc nằm ở MỘT nơi (app/globals.css, khối :root). Đầu ra khác (hằng theme_color/background_color
// cho manifest + viewport) được SINH từ đó vào lib/web/theme.ts; `check-tokens` đỏ khi tệp sinh lệch nguồn.
// Dùng: node scripts/build-tokens.mjs   (ghi lib/web/theme.ts)
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
export const TOKEN_CSS = "app/globals.css";
export const THEME_OUT = "lib/web/theme.ts";

const TOKEN_BLOCK = /(:root|\[data-theme[^\]]*\])\s*\{([^{}]*)\}/g;

/** Bỏ chú thích CSS để không đếm màu trong lời giải thích. */
export function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Đọc các khối token: `:root` đầu tiên là theme gốc; khối `:root`/`[data-theme=…]` sau đó (vd. trong
 * @media prefers-color-scheme: dark) là theme thêm, kế thừa gốc. Trả { themes: Map(tên → Map(token → giá trị)), outside }.
 */
export function parseTokens(css) {
  const clean = stripCssComments(css);
  const themes = new Map();
  let base = null;
  let n = 0;
  const outside = clean.replace(TOKEN_BLOCK, (_all, selector, body) => {
    const own = new Map();
    for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) own.set(m[1], m[2].trim());
    if (base === null) {
      base = own;
      themes.set("gốc", new Map(own));
    } else {
      n += 1;
      themes.set(`${selector.trim()}#${n}`, new Map([...base, ...own]));
    }
    return "";
  });
  return { themes, outside };
}

export function renderTheme(css) {
  const base = parseTokens(css).themes.get("gốc");
  const brand = base?.get("--brand");
  const bg = base?.get("--bg");
  if (!brand || !bg) throw new Error("globals.css thiếu --brand hoặc --bg trong :root");
  return [
    `// SINH TỰ ĐỘNG từ ${TOKEN_CSS} bởi scripts/build-tokens.mjs — không sửa tay (UX-DS-001).`,
    `export const THEME_COLOR = ${JSON.stringify(brand)};`,
    `export const BACKGROUND_COLOR = ${JSON.stringify(bg)};`,
    "",
  ].join("\n");
}

if (process.argv[1] === import.meta.filename) {
  writeFileSync(path.join(root, THEME_OUT), renderTheme(readFileSync(path.join(root, TOKEN_CSS), "utf8")));
  console.log(`build-tokens: đã ghi ${THEME_OUT}`);
}
