// check:units (XC-UNITS-009): không số ma thuật chuyển đổi đơn vị ngoài lib/nen/units.ts — `* 1000`, `/ 1000`,
// `* 60_000`, `/ 1024`, `* 3600`, `86_400_000`. Dùng hằng/hàm của units.ts.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const MAGIC = /[*/]\s?1000\b|[*/]\s?60_?000\b|[*/]\s?1024\b|[*/]\s?3600(_?000)?\b|\b86_?400(_?000)?\b/;
const ROOTS = ["lib", "app", "proxy.ts", "instrumentation.ts"];
const ALLOW = new Set([path.join("lib", "nen", "units.ts")]);

export function violations(file, src) {
  const out = [];
  src.split("\n").forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "");
    if (MAGIC.test(code)) out.push(`${file}:${i + 1}: ${line.trim()}`);
  });
  return out;
}

function walk(p, acc) {
  if (statSync(p).isDirectory()) for (const e of readdirSync(p)) walk(path.join(p, e), acc);
  else if (/\.(ts|tsx)$/.test(p)) acc.push(p);
  return acc;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = ROOTS.flatMap((r) => walk(r, [])).filter((f) => !ALLOW.has(f));
  const bad = files.flatMap((f) => violations(f, readFileSync(f, "utf8")));
  if (bad.length > 0) {
    console.error(`check:units — ${bad.length} số ma thuật (dùng lib/nen/units.ts):\n  ${bad.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`check:units: OK (${files.length} tệp)`);
}
