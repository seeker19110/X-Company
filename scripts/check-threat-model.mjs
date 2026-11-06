// SEC-TM-006 (NIST SSDF PW.1.1): mọi mối đe doạ mức Cao trong docs/THREAT-MODEL.md có biện pháp trỏ tới bằng chứng thật —
// tệp test/cấu hình tồn tại (`đường/dẫn`) hoặc ID checklist khung (`XXX-YYY-NNN`) — và không ở quyết định `accept`.
// Mức phải khớp KN × TĐ (≥ 6 Cao, 3–4 TB, 1–2 Thấp). Rủi ro chấp nhận (mục 6) chưa có người xác nhận = cảnh báo.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = "docs/THREAT-MODEL.md";
const CHECKLIST_ID = /\b[A-Z]{2,5}-[A-Z0-9]{2,8}-\d{3}\b/;
const PATH_IN_TICKS = /`([\w./-]+\.[a-z0-9]+)`/g;
const LINK = /\]\(([^)\s]+)\)/g;

export function level(kn, td) {
  const p = kn * td;
  return p >= 6 ? "Cao" : p >= 3 ? "TB" : "Thấp";
}

/** Hàng bảng mục 4: `| T1 | STRIDE | Mối đe doạ | KN | TĐ | Mức | Quyết định | Biện pháp | Bằng chứng | Trạng thái |`. */
export function parseThreats(text) {
  const rows = [];
  for (const [i, line] of text.split("\n").entries()) {
    if (!/^\| T\d+ \|/.test(line)) continue;
    const c = line.split("|").map((s) => s.trim());
    rows.push({
      line: i + 1,
      id: c[1],
      kn: Number(c[4]),
      td: Number(c[5]),
      level: c[6],
      decision: c[7],
      evidence: c[9] ?? "",
    });
  }
  return rows;
}

/**
 * @param {string} text nội dung THREAT-MODEL.md
 * @param {(p: string) => boolean} exists tệp (đường dẫn so với gốc repo) có tồn tại
 * @returns {{errors: string[], warnings: string[], high: number}}
 */
export function checkThreats(text, exists) {
  const errors = [];
  const warnings = [];
  const rows = parseThreats(text);
  if (rows.length === 0) errors.push(`${FILE}: không đọc được hàng mối đe doạ nào (bảng mục 4)`);
  let high = 0;
  for (const r of rows) {
    const at = `${FILE}:${r.line} ${r.id}`;
    if (!Number.isInteger(r.kn) || !Number.isInteger(r.td) || r.kn < 1 || r.kn > 3 || r.td < 1 || r.td > 3) {
      errors.push(`${at}: KN/TĐ phải là 1–3`);
      continue;
    }
    if (r.level !== level(r.kn, r.td))
      errors.push(`${at}: Mức "${r.level}" lệch KN×TĐ = ${r.kn * r.td} → ${level(r.kn, r.td)}`);
    if (level(r.kn, r.td) !== "Cao") continue;
    high++;
    if (r.decision === "accept")
      errors.push(`${at}: mức Cao không được "accept" (SEC-TM-006) — giảm thiểu hoặc hạ mức có lý do`);
    if (/chưa có/i.test(r.evidence)) errors.push(`${at}: mức Cao còn bằng chứng "chưa có"`);
    const files = [...r.evidence.matchAll(PATH_IN_TICKS)].map((m) => m[1]);
    const links = [...r.evidence.matchAll(LINK)].map((m) => path.posix.join("docs", m[1]));
    for (const f of [...files, ...links])
      if (!exists(f)) errors.push(`${at}: bằng chứng \`${f}\` không tồn tại`);
    if (files.length + links.length === 0 && !CHECKLIST_ID.test(r.evidence))
      errors.push(`${at}: mức Cao thiếu bằng chứng (tệp test/cấu hình hoặc ID checklist khung)`);
  }
  for (const m of text.matchAll(/^- (T\d+) — .*<chủ dự án điền>/gm))
    warnings.push(`${m[1]}: rủi ro chấp nhận chưa có người xác nhận (mục 6) — việc chủ dự án`);
  return { errors, warnings, high };
}

function main() {
  const r = checkThreats(readFileSync(path.join(ROOT, FILE), "utf8"), (p) => existsSync(path.join(ROOT, p)));
  for (const w of r.warnings) console.log(`CẢNH BÁO: ${w}`);
  for (const e of r.errors) console.error(`✗ ${e}`);
  if (r.errors.length > 0) process.exit(1);
  console.log(`check:threat-model: OK (${r.high} mối đe doạ mức Cao đều có bằng chứng tồn tại)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
