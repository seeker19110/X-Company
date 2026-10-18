// eol-check — OPS-MAINT-003, BASE-DEP-003: đối chiếu runtime/CSDL đang dùng với endoflife.date.
// Nguồn phiên bản: .nvmrc (Node) và image postgres trong .github/workflows/ci.yml. Đã EOL → exit 1 (mọi chế độ).
// Còn < 90 ngày → cảnh báo (::warning::), `--strict` (job lịch tuần) → exit 1. Lỗi mạng → cảnh báo, không đỏ.
// `EOL_DATA_DIR=<thư mục chứa nodejs.json, postgresql.json>` đọc dữ liệu cục bộ thay vì mạng (test/offline).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const WARN_DAYS = 90;
const DAY = 86_400_000;

/** Sản phẩm ↔ nơi đọc phiên bản đang dùng ↔ slug endoflife.date. */
export function detectProducts(read) {
  const out = [];
  const nvm = read(".nvmrc").trim().replace(/^v/, "");
  if (nvm) out.push({ slug: "nodejs", label: "Node.js", cycle: nvm.split(".")[0], source: ".nvmrc" });
  const pg = read(".github/workflows/ci.yml").match(/image:\s*postgres:(\d+)/);
  if (pg)
    out.push({ slug: "postgresql", label: "PostgreSQL", cycle: pg[1], source: ".github/workflows/ci.yml" });
  return out;
}

/** level: ok | warn (< WARN_DAYS) | expired | unknown (không có chu kỳ trong dữ liệu). */
export function evaluate(cycle, data, now = new Date()) {
  const row = (Array.isArray(data) ? data : []).find((r) => String(r.cycle) === String(cycle));
  if (!row) return { level: "unknown", detail: `chu kỳ ${cycle} không có trong dữ liệu endoflife.date` };
  if (row.eol === false || row.eol === undefined) return { level: "ok", detail: "chưa có ngày EOL" };
  const eol = new Date(`${row.eol}T00:00:00Z`);
  if (Number.isNaN(eol.getTime())) return { level: "unknown", detail: `ngày EOL không hợp lệ: ${row.eol}` };
  const days = Math.floor((eol.getTime() - now.getTime()) / DAY);
  if (days < 0) return { level: "expired", detail: `đã EOL ngày ${row.eol}`, days };
  if (days < WARN_DAYS) return { level: "warn", detail: `EOL ngày ${row.eol} (còn ${days} ngày)`, days };
  return { level: "ok", detail: `EOL ngày ${row.eol} (còn ${days} ngày)`, days };
}

async function load(slug, fetchImpl = fetch) {
  const dir = process.env.EOL_DATA_DIR;
  if (dir) return JSON.parse(readFileSync(join(dir, `${slug}.json`), "utf8"));
  let last;
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await fetchImpl(`https://endoflife.date/api/${slug}.json`, {
        signal: AbortSignal.timeout(15_000),
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, i * 1000));
    }
  }
  throw last;
}

/** Trả { exit, lines }. Tách khỏi CLI để test. */
export async function run({ strict = false, read, now = new Date(), loader = load } = {}) {
  const lines = [];
  let exit = 0;
  for (const p of detectProducts(read)) {
    let data;
    try {
      data = await loader(p.slug);
    } catch (e) {
      lines.push(
        `::warning::eol-check: không lấy được dữ liệu ${p.label} (${e instanceof Error ? e.message : e}) — bỏ qua`,
      );
      continue;
    }
    const r = evaluate(p.cycle, data, now);
    const msg = `${p.label} ${p.cycle} (${p.source}): ${r.detail}`;
    if (r.level === "expired" || (r.level === "warn" && strict)) {
      lines.push(`::error::eol-check: ${msg}`);
      exit = 1;
    } else if (r.level === "warn" || r.level === "unknown") lines.push(`::warning::eol-check: ${msg}`);
    else lines.push(`eol-check: ${msg}`);
  }
  return { exit, lines };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const read = (f) => (existsSync(resolve(ROOT, f)) ? readFileSync(resolve(ROOT, f), "utf8") : "");
  const { exit, lines } = await run({ strict: process.argv.includes("--strict"), read });
  for (const l of lines) console.log(l);
  process.exit(exit);
}
