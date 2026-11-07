// WF-ENV-010: dữ liệu staging/preview/e2e chỉ là seed TỔNG HỢP sinh trong repo — script seed không được kéo dữ liệu từ
// nguồn ngoài (mạng, tệp ngoài repo, CSDL khác), nên không thể "copy production" qua đường seed.
// Kiểm tĩnh mọi scripts/seed-*.{ts,mjs,js}; check:docs gọi `checkSeedPolicy`; chính sách người ở docs/ops/RUNBOOK.md.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** Gói ngoài được import (ngoài đường dẫn tương đối trong repo). */
const ALLOWED_PACKAGES = new Set(["node:fs", "pg"]);
/** Tệp seed được đọc: chỉ đầu ra của chính seed-e2e (thông tin đăng nhập thử, gitignore). */
const ALLOWED_READS = new Set(["e2e/.seed.json"]);
/** Biến môi trường seed được đọc trực tiếp: chỉ CSDL đích (cấu hình khác đi qua lib/ như ứng dụng). */
const ALLOWED_ENV = new Set(["DATABASE_URL"]);
/** Tên miền dành riêng cho ví dụ/test (RFC 2606, RFC 6761) — URL trong dữ liệu mẫu chỉ được trỏ tới đây. */
const RESERVED_HOST = /(^|\.)(test|example|invalid|localhost|example\.(com|net|org))$/;
export const SEED_MARKER = "KHÔNG dùng cho production";

/** Lỗi chính sách của một script seed (rỗng = đạt). */
export function checkSeedText(text, file) {
  const errs = [];
  const at = (i) => `${file}:${text.slice(0, i).split("\n").length}`;
  if (!text.split("\n").slice(0, 5).join("\n").includes(SEED_MARKER))
    errs.push(`WF-ENV-010: ${file} thiếu dòng đầu nêu "${SEED_MARKER}"`);
  for (const m of text.matchAll(/\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
    const spec = m[1];
    if (spec.startsWith("./") || spec.startsWith("../")) continue;
    if (!ALLOWED_PACKAGES.has(spec))
      errs.push(`WF-ENV-010: ${at(m.index)} import "${spec}" — seed chỉ dùng node:fs, pg và mã trong repo`);
  }
  for (const m of text.matchAll(/\brequire\s*\(/g))
    errs.push(`WF-ENV-010: ${at(m.index)} require() — seed chỉ dùng import tĩnh để kiểm được`);
  for (const m of text.matchAll(/\b(fetch|WebSocket|XMLHttpRequest|EventSource)\s*\(/g))
    errs.push(`WF-ENV-010: ${at(m.index)} gọi mạng ${m[1]}() — seed không đọc nguồn ngoài`);
  for (const m of text.matchAll(
    /\b(readFileSync|readFile|createReadStream|openSync|readdirSync)\s*\(\s*([^,)]*)/g,
  )) {
    const arg = m[2].trim();
    const lit = /^["'`]([^"'`$]*)["'`]$/.exec(arg)?.[1];
    if (lit === undefined || !ALLOWED_READS.has(lit))
      errs.push(
        `WF-ENV-010: ${at(m.index)} ${m[1]}(${arg || "…"}) — seed chỉ đọc ${[...ALLOWED_READS].join(", ")} (chuỗi cố định)`,
      );
  }
  // Mọi `process.env` không đi kèm `.TÊN_ĐƯỢC_PHÉP` đều đỏ: `[…]`, destructuring `const { X } = process.env`, truyền cả
  // object (review #100: destructuring từng lọt).
  for (const m of text.matchAll(/process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*))?/g))
    if (!m[1] || !ALLOWED_ENV.has(m[1]))
      errs.push(
        `WF-ENV-010: ${at(m.index)} process.env${m[1] ? `.${m[1]}` : " (không qua .TÊN)"} — seed chỉ đọc ${[...ALLOWED_ENV].join(", ")}`,
      );
  for (const m of text.matchAll(/\b(?:https?|wss?|postgres(?:ql)?):\/\/([^/\s"'`?#\\]+)/gi)) {
    // authority = [userinfo@]host[:port] — bỏ userinfo (tới @ cuối) và cổng.
    const host = m[1].replace(/^.*@/, "").replace(/:\d*$/, "").toLowerCase();
    if (!RESERVED_HOST.test(host) && host !== "127.0.0.1")
      errs.push(
        `WF-ENV-010: ${at(m.index)} URL tới ${host} — dữ liệu mẫu chỉ trỏ tên miền dành riêng (.test, example.com…)`,
      );
  }
  return errs;
}

/** Mọi script seed trong thư mục (mặc định scripts/). Không có script nào = lỗi (kiểm đặt sai chỗ). */
export function checkSeedPolicy(dir = "scripts") {
  const files = readdirSync(dir)
    .filter((f) => /^seed-.*\.(ts|mjs|js)$/.test(f))
    .sort();
  if (files.length === 0)
    return { files, errors: [`WF-ENV-010: không tìm thấy scripts/seed-*.ts trong ${dir}`] };
  return {
    files,
    errors: files.flatMap((f) => checkSeedText(readFileSync(path.join(dir, f), "utf8"), `${dir}/${f}`)),
  };
}
