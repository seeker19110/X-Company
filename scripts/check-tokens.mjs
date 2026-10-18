// UX-DS-001/002/003, UX-A11Y-002: (a) tương phản WCAG của các cặp token ở MỌI theme (chữ ≥ 4,5; viền focus ≥ 3);
// (b) không màu cứng (#hex, rgb(), hsl()) ngoài khối token trong app/**/*.css|ts|tsx; (c) lib/web/theme.ts (theme_color
// của manifest + viewport) khớp token — tức không lệch so với bản sinh từ app/globals.css.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseTokens, renderTheme, THEME_OUT, TOKEN_CSS } from "./build-tokens.mjs";

const root = path.resolve(import.meta.dirname, "..");

/** Cặp [màu trước, màu nền, ngưỡng, ý nghĩa]. 4,5 = chữ thường (SC 1.4.3); 3 = thành phần UI/focus (SC 1.4.11). */
export const PAIRS = [
  ["--fg", "--bg", 4.5, "chữ chính / nền"],
  ["--muted", "--bg", 4.5, "chữ phụ / nền"],
  ["--brand", "--bg", 4.5, "liên kết, nút viền thương hiệu / nền"],
  ["--brand-fg", "--brand", 4.5, "chữ trên nút thương hiệu"],
  ["--danger", "--bg", 4.5, "chữ lỗi / nền"],
  ["--ok", "--bg", 4.5, "chữ thành công / nền"],
  ["--warn", "--bg", 4.5, "chữ cảnh báo / nền"],
  ["--focus", "--bg", 3, "viền focus / nền"],
];

export function parseHex(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** Độ chói tương đối theo WCAG 2.x. */
export function luminance([r, g, b]) {
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Tỷ lệ tương phản WCAG giữa hai màu hex (1..21). */
export function contrastRatio(a, b) {
  const ra = parseHex(a);
  const rb = parseHex(b);
  if (!ra || !rb) throw new Error(`màu không phải #rgb/#rrggbb: ${a} / ${b}`);
  const [hi, lo] = [luminance(ra), luminance(rb)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function checkContrast(css) {
  const errors = [];
  const { themes } = parseTokens(css);
  if (themes.size === 0) errors.push(`${TOKEN_CSS}: không có khối :root token`);
  for (const [theme, tokens] of themes) {
    for (const [fg, bg, min, what] of PAIRS) {
      const a = tokens.get(fg);
      const b = tokens.get(bg);
      if (!a || !b) {
        errors.push(`theme ${theme}: thiếu token ${!a ? fg : bg} (cặp ${what})`);
        continue;
      }
      let ratio;
      try {
        ratio = contrastRatio(a, b);
      } catch (e) {
        errors.push(`theme ${theme}: ${e.message}`);
        continue;
      }
      if (ratio < min) {
        errors.push(`theme ${theme}: ${what} (${fg} ${a} / ${bg} ${b}) = ${ratio.toFixed(2)}:1 < ${min}:1`);
      }
    }
  }
  return errors;
}

const HEX_BODY = "(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})";
const FUNC = /\b(?:rgb|rgba|hsl|hsla)\(/g;

/** Màu cứng trong một tệp. CSS: mọi nơi ngoài khối token. TS/TSX: chuỗi `"#hex"` hoặc rgb()/hsl(. */
export function hardcodedColors(file, src) {
  const out = [];
  if (file.endsWith(".css")) {
    const { outside } = parseTokens(src);
    for (const m of outside.matchAll(new RegExp(`#${HEX_BODY}\\b`, "g"))) out.push(m[0]);
    for (const m of outside.matchAll(FUNC)) out.push(m[0]);
  } else {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const m of code.matchAll(new RegExp(`["'\`](#${HEX_BODY})["'\`]`, "g"))) out.push(m[1]);
    for (const m of code.matchAll(FUNC)) out.push(m[0]);
  }
  return out;
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(css|ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

export function check(rootDir) {
  const errors = [];
  const css = readFileSync(path.join(rootDir, TOKEN_CSS), "utf8");
  errors.push(...checkContrast(css));
  for (const f of walk(path.join(rootDir, "app"))) {
    const rel = path.relative(rootDir, f).split(path.sep).join("/");
    const found = hardcodedColors(rel, readFileSync(f, "utf8"));
    if (found.length > 0) {
      errors.push(
        `${rel}: màu cứng ngoài khối token (${[...new Set(found)].join(", ")}) — dùng var(--token)`,
      );
    }
  }
  const themeFile = path.join(rootDir, THEME_OUT);
  if (!existsSync(themeFile) || readFileSync(themeFile, "utf8") !== renderTheme(css)) {
    errors.push(`${THEME_OUT} lệch token (theme_color) — chạy: node scripts/build-tokens.mjs`);
  }
  return errors;
}

if (process.argv[1] === import.meta.filename) {
  const errors = check(root);
  if (errors.length > 0) {
    console.error(errors.map((e) => `check-tokens: ${e}`).join("\n"));
    process.exit(1);
  }
  console.log("check-tokens: OK (tương phản các cặp token, không màu cứng, theme_color khớp token)");
}
