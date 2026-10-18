// check:perf-budget — ngân sách hiệu năng máy đọc (FE-PERF-004, XC-PERF-003, XC-GREEN-001/002).
// Đo trên output `next build` (Turbopack): JS gzip "first load" mỗi trang = rootMainFiles + polyfill + entryJSFiles của trang
// (từ build-manifest.json và page_client-reference-manifest.js); số request = 1 tài liệu + JS + CSS của trang.
// So với perf-budget.json (đỏ khi vượt) và docs/perf/baseline-*.json mới nhất (cảnh báo khi lệch > tolerancePct).
// Chưa có .next/BUILD_ID → chạy `npm run -s build` (có thể tắt bằng PERF_NO_BUILD=1 → đỏ, nói rõ lý do).
//   node scripts/check-perf-budget.mjs                       kiểm
//   node scripts/check-perf-budget.mjs --write-baseline F    đo và ghi baseline (F = đường dẫn .json)
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const KB = 1024;

function walk(dir, pred, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, pred, out);
    else if (pred(name)) out.push(p);
  }
  return out;
}

/** Route URL từ đường dẫn manifest: `app/(public)/[...slug]/page_client-reference-manifest.js` → `/[...slug]`. */
export function routeOfManifest(rel) {
  const segs = rel
    .split(path.sep)
    .join("/")
    .replace(/\/page_client-reference-manifest\.js$/, "")
    .split("/")
    .filter((s) => s !== "" && !/^\(.*\)$/.test(s));
  return "/" + segs.join("/");
}

/** Đo build tại `root` (thư mục chứa `.next`). Ném lỗi nếu chưa build. */
export function measureBuild(root) {
  const nextDir = path.join(root, ".next");
  if (!existsSync(path.join(nextDir, "BUILD_ID"))) throw new Error("chưa có .next/BUILD_ID (chưa build)");
  const gz = new Map();
  const gzKB = (rel) => {
    if (!gz.has(rel)) gz.set(rel, gzipSync(readFileSync(path.join(nextDir, rel)), { level: 9 }).length);
    return gz.get(rel);
  };
  const bm = JSON.parse(readFileSync(path.join(nextDir, "build-manifest.json"), "utf8"));
  const shared = [...new Set([...(bm.polyfillFiles ?? []), ...(bm.rootMainFiles ?? [])])];
  const appDir = path.join(nextDir, "server", "app");
  const routes = {};
  for (const f of walk(appDir, (n) => n === "page_client-reference-manifest.js")) {
    const rel = path.relative(appDir, f);
    if (rel.startsWith("_global-error") || rel.startsWith("_not-found")) continue;
    const src = readFileSync(f, "utf8");
    const body = src.slice(src.indexOf("= {") + 2).replace(/;\s*$/, "");
    const m = JSON.parse(body);
    const js = new Set(shared);
    for (const files of Object.values(m.entryJSFiles ?? {})) for (const x of files) js.add(x);
    const css = new Set();
    for (const files of Object.values(m.entryCSSFiles ?? {}))
      for (const x of files) css.add(typeof x === "string" ? x : (x.path ?? ""));
    css.delete("");
    const jsBytes = [...js].reduce((a, x) => a + gzKB(x), 0);
    const cssBytes = [...css].reduce((a, x) => a + gzKB(x.replace(/^\/?(_next\/)?/, "")), 0);
    routes[routeOfManifest(rel)] = {
      js_gzip_kb: round1(jsBytes / KB),
      css_gzip_kb: round1(cssBytes / KB),
      requests: 1 + js.size + css.size,
    };
  }
  const allJs = walk(path.join(nextDir, "static"), (n) => n.endsWith(".js"));
  const totalJs = allJs.reduce((a, f) => a + gzKB(path.relative(nextDir, f)), 0);
  return { routes, static_js_gzip_kb_total: round1(totalJs / KB), static_js_files: allJs.length };
}

const round1 = (n) => Math.round(n * 10) / 10;

/** So số đo với ngân sách; trả danh sách lỗi (rỗng = đạt). */
export function evaluate(measured, budget) {
  const errs = [];
  for (const [route, b] of Object.entries(budget.routes ?? {})) {
    const m = measured.routes[route];
    if (!m) {
      errs.push(
        `${route}: có ngân sách nhưng không có trong build (đổi tên route? cập nhật perf-budget.json)`,
      );
      continue;
    }
    if (m.js_gzip_kb > b.max_js_gzip_kb)
      errs.push(`${route}: JS gzip ${m.js_gzip_kb} KB > ngân sách ${b.max_js_gzip_kb} KB`);
    if (m.requests > b.max_requests)
      errs.push(`${route}: ${m.requests} request > ngân sách ${b.max_requests}`);
  }
  for (const route of Object.keys(measured.routes))
    if (!(route in (budget.routes ?? {})))
      errs.push(`${route}: trang chưa có ngân sách (thêm vào perf-budget.json)`);
  if (measured.static_js_gzip_kb_total > budget.max_static_js_gzip_kb_total)
    errs.push(
      `tổng JS .next/static gzip ${measured.static_js_gzip_kb_total} KB > ngân sách ${budget.max_static_js_gzip_kb_total} KB`,
    );
  return errs;
}

/** Cảnh báo (không đỏ) khi lệch baseline quá tolerancePct. */
export function driftWarnings(measured, baseline, tolerancePct) {
  const out = [];
  const lim = 1 + tolerancePct / 100;
  for (const [route, b] of Object.entries(baseline.pages ?? {})) {
    const m = measured.routes[route];
    if (m && m.js_gzip_kb > b.js_gzip_kb * lim)
      out.push(`${route}: JS ${m.js_gzip_kb} KB vượt baseline ${b.js_gzip_kb} KB quá ${tolerancePct}%`);
  }
  return out;
}

export function latestBaseline(dir) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => /^baseline-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  const last = files[files.length - 1];
  return last ? path.join(dir, last) : null;
}

function git(args) {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
}

function main() {
  const root = process.cwd();
  const wi = process.argv.indexOf("--write-baseline");
  if (!existsSync(path.join(root, ".next", "BUILD_ID"))) {
    if (process.env.PERF_NO_BUILD === "1") {
      console.error(
        "check:perf-budget — chưa build (.next/BUILD_ID) và PERF_NO_BUILD=1; chạy `npm run build` trước",
      );
      process.exit(1);
    }
    console.log("check:perf-budget: chưa có bản build — chạy `npm run -s build` …");
    const r = spawnSync("npm", ["run", "-s", "build"], {
      stdio: "inherit",
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    });
    if (r.status !== 0) {
      console.error("check:perf-budget — build lỗi");
      process.exit(1);
    }
  }
  const measured = measureBuild(root);
  if (wi >= 0) {
    const target = process.argv[wi + 1];
    if (!target) {
      console.error("thiếu đường dẫn sau --write-baseline");
      process.exit(2);
    }
    const base = {
      date: new Date().toISOString().slice(0, 10),
      commit: process.env.PERF_BASELINE_COMMIT || git(["rev-parse", "HEAD"]),
      tool: "scripts/check-perf-budget.mjs (gzip -9 trên output next build, Turbopack)",
      note: "KB gzip JS 'first load' mỗi trang (rootMain + polyfill + entry của trang); requests = 1 tài liệu + JS + CSS của trang. Không gồm ảnh/phông/XHR; số trên mạng thật do Lighthouse (lighthouserc.json) đo.",
      pages: measured.routes,
      static_js_gzip_kb_total: measured.static_js_gzip_kb_total,
      static_js_files: measured.static_js_files,
    };
    writeFileSync(target, JSON.stringify(base, null, 2) + "\n");
    console.log(`đã ghi baseline ${target}`);
    return;
  }
  const budget = JSON.parse(readFileSync("perf-budget.json", "utf8"));
  const errs = evaluate(measured, budget);
  const bl = latestBaseline("docs/perf");
  if (bl) {
    for (const w of driftWarnings(
      measured,
      JSON.parse(readFileSync(bl, "utf8")),
      budget.baseline_tolerance_pct ?? 10,
    ))
      console.warn(`cảnh báo: ${w} (${bl})`);
  } else errs.push("thiếu docs/perf/baseline-YYYY-MM-DD.json (XC-GREEN-001)");
  if (errs.length > 0) {
    console.error(`check:perf-budget — ${errs.length} lỗi:\n  ${errs.join("\n  ")}`);
    process.exit(1);
  }
  console.log(
    `check:perf-budget: OK — ${Object.keys(measured.routes).length} trang, tổng JS static ${measured.static_js_gzip_kb_total} KB gzip (trần ${budget.max_static_js_gzip_kb_total})`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
