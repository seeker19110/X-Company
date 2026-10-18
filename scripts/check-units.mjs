// check:units (XC-UNITS-009): không số ma thuật chuyển đổi đơn vị ngoài lib/nen/units.ts — `* 1000`, `/ 1000`,
// `* 60_000`, `/ 1024`, `* 3600`, `86_400_000`. Dùng hằng/hàm của units.ts.
// Thêm: cột số trong migrations/*.sql phải mang đơn vị trong TÊN (hậu tố `_ms`, `_sec`, `minutes`, `_bytes`, `_m`, `_pct`…)
// hoặc là đại lượng không đơn vị đã rà (`id`, `version`, `*_count`, `attempts`, `priority`, `n`, `*_status`, `lat`/`lng` = độ WGS84).
// Cột mới không khớp → đỏ; không sửa migration đã áp (cột cũ đã khớp hoặc nằm trong nhóm đã rà ở trên).
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

const UNIT_NAME = /(^|_)(ms|sec|s|minutes|hours|days|bytes|kb|m|km|cm|kg|pct|percent|bps)$/;
const DIMENSIONLESS_NAME = /(^|_)(id|seq|version|count|attempts|status|priority|n|lat|lng)$/;
const NUMERIC_COLUMN =
  /(?:^\s*|\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?)([a-z_][a-z0-9_]*)\s+(?:smallint|integer|int[248]?|bigint|numeric|decimal|real|double\s+precision|float[48]?)\b/i;
const NOT_A_COLUMN =
  /^(primary|foreign|unique|check|constraint|exclude|create|alter|like|references|on|add|drop)$/i;

export function columnViolations(file, sql) {
  const out = [];
  sql.split("\n").forEach((line, i) => {
    const m = NUMERIC_COLUMN.exec(line.replace(/--.*$/, ""));
    const name = m?.[1]?.toLowerCase();
    if (name === undefined || NOT_A_COLUMN.test(name)) return;
    if (!UNIT_NAME.test(name) && !DIMENSIONLESS_NAME.test(name))
      out.push(`${file}:${i + 1}: cột số "${name}" thiếu hậu tố đơn vị (_ms/_sec/_minutes/_bytes/_pct…)`);
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
  const sqls = readdirSync("migrations").filter((f) => f.endsWith(".sql"));
  const badCols = sqls.flatMap((f) =>
    columnViolations(`migrations/${f}`, readFileSync(path.join("migrations", f), "utf8")),
  );
  if (bad.length > 0 || badCols.length > 0) {
    if (bad.length > 0)
      console.error(
        `check:units — ${bad.length} số ma thuật (dùng lib/nen/units.ts):\n  ${bad.join("\n  ")}`,
      );
    if (badCols.length > 0)
      console.error(`check:units — ${badCols.length} cột số không hậu tố đơn vị:\n  ${badCols.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`check:units: OK (${files.length} tệp, ${sqls.length} migration)`);
}
