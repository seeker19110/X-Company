// check:perf-target (QA-PERF-007): cấm cấu hình CI/script đặt đích bộ tải ngoài loopback, và bắt buộc perf-load đi qua
// resolvePerfTarget. Đọc .github/workflows/*.yml, package.json, scripts/** (trừ chính tệp này và perf-target.mjs) — không
// quét .env*/docs: biến chỉ được đọc trong perf-load.mjs và luôn qua resolvePerfTarget lúc chạy (chặn lần hai).
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isLoopbackUrl } from "./lib/perf-target.mjs";

// `=` của shell không có khoảng trắng phía sau (`PERF_BASE_URL= node x` là gán rỗng); `:` của YAML thì có.
const ASSIGN = /PERF_BASE_URL(?:=|\s*:\s*)["']?([^"'\s}]*)/g;

/** Lỗi trong một tệp: mỗi gán PERF_BASE_URL có giá trị cụ thể ngoài loopback. Giá trị là biến (`$X`, `${{ … }}`) cũng bị chặn. */
export function violations(file, text) {
  const out = [];
  for (const m of text.matchAll(ASSIGN)) {
    const v = m[1];
    if (v === "") continue; // gán rỗng → resolvePerfTarget dùng máy chủ harness
    if (!isLoopbackUrl(v)) out.push(`${file}: PERF_BASE_URL="${v}" không phải loopback`);
  }
  return out;
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

export function check(root) {
  const errs = [];
  const files = [
    ...walk(path.join(root, ".github", "workflows")),
    path.join(root, "package.json"),
    ...walk(path.join(root, "scripts")).filter((f) => !/check-perf-target\.mjs$|perf-target\.mjs$/.test(f)),
  ];
  for (const f of files) errs.push(...violations(path.relative(root, f), readFileSync(f, "utf8")));
  const load = readFileSync(path.join(root, "scripts", "perf-load.mjs"), "utf8");
  if (!/resolvePerfTarget\(process\.env\.PERF_BASE_URL/.test(load))
    errs.push("scripts/perf-load.mjs: đích phải đi qua resolvePerfTarget(process.env.PERF_BASE_URL, …)");
  return errs;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const errs = check(process.cwd());
  if (errs.length > 0) {
    for (const e of errs) console.error(`check:perf-target ✗ ${e}`);
    process.exit(1);
  }
  console.log("check:perf-target: OK (bộ tải chỉ nhắm loopback)");
}
