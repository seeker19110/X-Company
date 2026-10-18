// npm run check:docs — kiểm tài liệu vận hành/bảo mật/tuân thủ + spec (T-039). Không ghi file; exit 1 nếu có lỗi.
// Gồm: frontmatter spec · AC ↔ S-ID ↔ test (WF-SDD-003) · threat model · RISKS · SLO · ops docs · data map ↔ migrations ·
// kiểm kê CSV · fixture không có email/SĐT thật · tệp dữ liệu lớn · liên kết nội bộ.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = process.env.CHECK_NOW ? new Date(process.env.CHECK_NOW) : new Date();
const errors = [];
const out = (s) => process.stdout.write(`${s}\n`);
const fail = (m) => errors.push(m);
const p = (r) => join(ROOT, r);
const has = (r) => existsSync(p(r));
const read = (r) => readFileSync(p(r), "utf8");
const SKIP = new Set([
  "node_modules",
  ".git",
  ".next",
  ".xtemplates",
  "coverage",
  ".data",
  "test-results",
  "playwright-report",
]);

function walk(dir, filter = () => true) {
  const res = [];
  if (!existsSync(dir)) return res;
  for (const n of readdirSync(dir)) {
    if (SKIP.has(n)) continue;
    const f = join(dir, n);
    if (statSync(f).isDirectory()) res.push(...walk(f, filter));
    else if (filter(f)) res.push(relative(ROOT, f).split("\\").join("/"));
  }
  return res;
}
const frontmatter = (txt) => {
  const m = txt.match(/^---\n([\s\S]*?)\n---\n/);
  const o = {};
  if (m)
    for (const l of m[1].split("\n")) {
      const i = l.indexOf(":");
      if (i > 0)
        o[l.slice(0, i).trim()] = l
          .slice(i + 1)
          .trim()
          .replace(/^"|"$/g, "");
    }
  return o;
};
const section = (txt, re) => {
  const m = txt.match(new RegExp(`^## ${re}[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m"));
  return m ? m[1] : null;
};
const tableRows = (txt) =>
  txt
    .split("\n")
    .filter((l) => l.startsWith("|") && !/^\|[\s|:-]+\|$/.test(l))
    .map((l) =>
      l
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim()),
    );
const decisions = has("docs/autopilot/DECISIONS.md") ? read("docs/autopilot/DECISIONS.md") : "";
const decisionIds = new Set([...decisions.matchAll(/^### (D-\d{3})/gm)].map((m) => m[1]));

// ---- 1. Test mang mã S-ID trong tiêu đề test/describe (tests/, e2e/)
const sidInTests = new Map();
for (const f of [
  ...walk(p("tests"), (x) => /\.(ts|tsx)$/.test(x)),
  ...walk(p("e2e"), (x) => /\.(ts|tsx)$/.test(x)),
]) {
  for (const line of read(f).split("\n")) {
    if (!/\b(test|it|describe)(\.\w+)?\(/.test(line)) continue;
    for (const m of line.matchAll(/\bS-[A-Z]+-\d{2}\b/g)) {
      if (!sidInTests.has(m[0])) sidInTests.set(m[0], new Set());
      sidInTests.get(m[0]).add(f);
    }
  }
}

// ---- 2. Spec (WF-SDD-001/002/003, PM-SPEC-001/003/020)
const project = has("PROJECT.md") ? read("PROJECT.md") : "";
const featureIds = [
  ...new Set([...(section(project, "3\\.")?.matchAll(/\| (F-\d{3}) \|/g) ?? [])].map((m) => m[1])),
];
const specs = walk(p("docs/specs"), (x) => /SPEC-.*\.md$/.test(x));
const coveredFeatures = new Set();
const allAc = new Set();
const GROUPS = [
  "Rỗng/null",
  "Cực đại",
  "Trùng lặp",
  "Song song",
  "Mất mạng",
  "Thời gian",
  "Quyền",
  "Tiền/đơn vị",
];
let acTotal = 0;
let acWithTest = 0;
for (const f of specs) {
  const txt = read(f);
  const fm = frontmatter(txt);
  if (fm.status !== "approved") fail(`${f}: frontmatter status phải là approved`);
  if (!fm.approved_by) fail(`${f}: thiếu approved_by`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fm.approved_at ?? "")) fail(`${f}: approved_at phải là YYYY-MM-DD`);
  if (!/^Trạng thái: Approved for implementation/m.test(txt))
    fail(`${f}: thiếu dòng "Trạng thái: Approved for implementation"`);
  for (const id of (fm.features ?? "").match(/F-\d{3}/g) ?? []) coveredFeatures.add(id);

  const scen = new Set(
    [...(section(txt, "Kịch bản")?.matchAll(/^- (S-[A-Z]+-\d{2})\b/gm) ?? [])].map((m) => m[1]),
  );
  const acSec = section(txt, "Tiêu chí chấp nhận");
  if (!acSec) {
    fail(`${f}: thiếu mục "Tiêu chí chấp nhận"`);
    continue;
  }
  const rows = tableRows(acSec).filter((r) => /^AC-[A-Z]+-\d{2}$/.test(r[0]));
  if (rows.length === 0) fail(`${f}: không có AC-…`);
  if (!rows.some((r) => r[1] === "lỗi")) fail(`${f}: cần ≥ 1 AC loại "lỗi"`);
  const mapped = new Set();
  for (const r of rows) {
    if (allAc.has(r[0])) fail(`${f}: trùng ID ${r[0]}`);
    allAc.add(r[0]);
    acTotal++;
    const sids = r[3]?.match(/S-[A-Z]+-\d{2}/g) ?? [];
    if (sids.length === 0) {
      fail(`${f}: ${r[0]} không có S-ID`);
      continue;
    }
    let ok = true;
    for (const s of sids) {
      mapped.add(s);
      if (!scen.has(s)) {
        fail(`${f}: ${r[0]} → ${s} không có trong mục Kịch bản`);
        ok = false;
      }
      if (!sidInTests.has(s)) {
        fail(`${f}: THIẾU test mang mã ${s} (tiêu đề test/describe trong tests/ hoặc e2e/) cho ${r[0]}`);
        ok = false;
      }
    }
    if (ok) acWithTest++;
  }
  for (const s of scen) if (!mapped.has(s)) fail(`${f}: kịch bản ${s} chưa có AC tương ứng`);

  const edge = section(txt, "Ca biên");
  if (!edge) fail(`${f}: thiếu mục "Ca biên"`);
  else {
    const er = tableRows(edge).filter((r) => r.length >= 4 && r[0] !== "Nhóm");
    let real = 0;
    for (const g of GROUPS) {
      const r = er.find((x) => x[0].startsWith(g));
      if (!r) {
        fail(`${f}: bảng Ca biên thiếu nhóm "${g}"`);
        continue;
      }
      if (/^không áp dụng/i.test(r[1])) {
        if (r[1].length < 30) fail(`${f}: nhóm "${g}" "không áp dụng" thiếu lý do`);
      } else real++;
      for (const m of r[3].matchAll(/`((?:tests|e2e)\/[^`]+)`/g))
        if (!has(m[1])) fail(`${f}: nhóm "${g}" trỏ tệp test không tồn tại ${m[1]}`);
    }
    if (real < 6) fail(`${f}: Ca biên chỉ phủ ${real}/8 nhóm thật (cần ≥ 6)`);
  }
  const oq = section(txt, "Câu hỏi mở");
  if (!oq) fail(`${f}: thiếu mục "Câu hỏi mở"`);
  else {
    for (const m of oq.matchAll(/D-\d{3}/g))
      if (!decisionIds.has(m[0])) fail(`${f}: ${m[0]} không có trong docs/autopilot/DECISIONS.md`);
    for (const l of oq.split("\n").filter((x) => x.startsWith("- "))) {
      if (/Đã quyết:/.test(l) && !/Đã quyết: (D-\d{3}|\S+ \d{4}-\d{2}-\d{2})/.test(l))
        fail(`${f}: "Đã quyết" thiếu D-NNN/tên + ngày: ${l.slice(0, 60)}`);
    }
  }
}
for (const id of featureIds)
  if (!coveredFeatures.has(id)) fail(`PROJECT.md ${id} chưa có spec (frontmatter features) approved`);
if (featureIds.length === 0) fail("không đọc được danh sách F-NNN ở PROJECT.md mục 3");
out(
  `Spec: ${specs.length} tệp · AC ${acTotal} · có test mang S-ID ${acWithTest} · F-NNN ${featureIds.length}`,
);

// ---- 3. PROJECT.md (STD-SEC-001, STD-PROC-001, PM-REQ-007, PM-RISK-007, QA-DATA-001)
{
  const ids = project.match(/R-\d{3}/g) ?? [];
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  if (dup.length) fail(`PROJECT.md trùng ID yêu cầu: ${[...new Set(dup)].join(", ")}`);
  if (ids.length < 5) fail("PROJECT.md thiếu ID R-NNN");
  if (!/ASVS 5\.0\.0 L[123]/.test(project)) fail("PROJECT.md thiếu khai báo ASVS 5.0.0 Lx");
  const iso = section(project, "5\\.")?.split("### Đặc tính")[1] ?? "";
  const numRows = tableRows(iso).filter((r) => r.length >= 3 && /\d/.test(r[2]) && r[0] !== "Đặc tính");
  if (!/25010/.test(project) || numRows.length < 3)
    fail("PROJECT.md: bảng ISO/IEC 25010 cần ≥ 3 hàng có ngưỡng số");
  if (!/^## \d+\. Khung pháp lý/m.test(project)) fail('PROJECT.md thiếu mục "Khung pháp lý"');
  for (const k of ["91/2025/QH15", "356/2025/NĐ-CP", "45/2019/QH14"])
    if (!project.includes(k)) fail(`PROJECT.md Khung pháp lý thiếu ${k}`);
  const dt = project.match(/^## \d+\. Dữ liệu test\n([\s\S]*)/m)?.[1] ?? "";
  if (!/\*\*Cấm\*\*/.test(dt)) fail('PROJECT.md mục "Dữ liệu test" thiếu câu cấm dump production');
}
for (const f of ["docs/DPIA.md"])
  if (!has(f) || !/chờ pháp chế duyệt/i.test(read(f))) fail(`${f}: phải tồn tại và ghi "chờ pháp chế duyệt"`);
if (!has("SCOPE.md")) fail("thiếu SCOPE.md");

// ---- 4. Threat model (SEC-TM-001/003/005, STD-SEC-003, BASE-SEC-011)
if (!has("docs/THREAT-MODEL.md")) fail("thiếu docs/THREAT-MODEL.md");
else {
  const tm = read("docs/THREAT-MODEL.md");
  const upd = frontmatter(tm).updated;
  const adrDates = walk(p("docs/adr"), (x) => x.endsWith(".md"))
    .map((f) => read(f).match(/Ngày:\s*(\d{4}-\d{2}-\d{2})/)?.[1])
    .filter(Boolean)
    .sort();
  const latest = adrDates.at(-1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(upd ?? "")) fail("THREAT-MODEL: thiếu frontmatter updated");
  else if (latest && upd < latest) fail(`THREAT-MODEL updated ${upd} cũ hơn ADR mới nhất ${latest}`);
  if (!/```mermaid[\s\S]*subgraph[\s\S]*```/.test(tm) || (tm.match(/subgraph /g) ?? []).length < 3)
    fail("THREAT-MODEL: thiếu DFD Mermaid có ≥ 3 ranh giới (subgraph)");
  for (const kw of ["SMTP", "Push", "PostgreSQL", "Worker", "GitHub"])
    if (!tm.split("```mermaid")[1]?.includes(kw)) fail(`THREAT-MODEL: DFD thiếu thành phần ${kw}`);
  if (!/^## \d+\. Kẻ tấn công giả định/m.test(tm)) fail("THREAT-MODEL: thiếu mục Kẻ tấn công giả định");
  for (let i = 1; i <= 10; i++) {
    const id = `A${String(i).padStart(2, "0")}:2025`;
    if (!new RegExp(`^\\| ${id} `, "m").test(tm)) fail(`THREAT-MODEL: thiếu dòng OWASP ${id}`);
  }
  const rows = tableRows(tm).filter((r) => /^T\d+$/.test(r[0]));
  const score = { 1: 1, 2: 2, 3: 3 };
  const DECISION = new Set(["mitigate", "eliminate", "transfer", "accept"]);
  let caoOk = 0;
  for (const r of rows) {
    if (r.length !== 10) {
      fail(`THREAT-MODEL ${r[0]}: cần 10 cột (đang ${r.length})`);
      continue;
    }
    const [id, , , kn, td, level, dec, , ev] = r;
    if (!score[kn] || !score[td]) {
      fail(`${id}: KN/TĐ phải là 1–3`);
      continue;
    }
    const prod = score[kn] * score[td];
    const want = prod >= 6 ? "Cao" : prod >= 3 ? "TB" : "Thấp";
    if (level !== want) fail(`${id}: mức ${level} lệch KN×TĐ=${prod} (phải là ${want})`);
    if (!DECISION.has(dec)) fail(`${id}: quyết định "${dec}" không hợp lệ`);
    const paths = [...ev.matchAll(/`([^`\s]+\.[a-z]+)`/g)]
      .map((m) => m[1])
      .filter((x) => /^(tests|e2e|lib|\.github|docs|scripts)\//.test(x));
    const missing = paths.filter((x) => !has(x));
    if (missing.length && !/chưa có/.test(ev))
      fail(`${id}: bằng chứng trỏ tệp không tồn tại: ${missing.join(", ")}`);
    for (const s of ev.match(/S-[A-Z]+-\d{2}/g) ?? [])
      if (!/chưa có/.test(ev) && !sidInTests.has(s)) fail(`${id}: ${s} không có test`);
    if (level === "Cao") {
      if (paths.some((x) => has(x))) caoOk++;
      else fail(`${id}: mức Cao chưa có bằng chứng tồn tại (test/cấu hình)`);
    }
  }
  if (rows.length < 10) fail("THREAT-MODEL: quá ít mối đe doạ");
  out(
    `Threat model: ${rows.length} mối đe doạ · Cao có bằng chứng ${caoOk} · updated ${upd} (ADR mới nhất ${latest})`,
  );
}

// ---- 5. RISKS (PM-RISK-001/006)
if (has("docs/RISKS.md")) {
  const rk = read("docs/RISKS.md");
  const rows = tableRows(rk).filter((r) => /^RK-\d{3}$/.test(r[0]));
  if (rows.length < 4) fail("RISKS: cần ≥ 4 rủi ro RK-NNN");
  for (const r of rows)
    if (r.length !== 10 || r.some((c) => !c)) fail(`RISKS ${r[0]}: cần đủ 10 cột không rỗng`);
  const deps = tableRows(rk.split("## Phụ thuộc")[1] ?? "").filter((r) => r.length === 6);
  for (const n of [
    "Next.js",
    "React",
    "pg",
    "PostgreSQL",
    "@node-rs/argon2",
    "markdown-it",
    "zod",
    "Playwright",
  ]) {
    const r = deps.find((x) => x[0].startsWith(n));
    if (!r) fail(`RISKS: bảng Phụ thuộc thiếu ${n}`);
    else if (r.some((c) => !c)) fail(`RISKS: ${n} thiếu cột`);
  }
  if (!rk.includes("NEXT_TELEMETRY_DISABLED=1"))
    fail("RISKS: thiếu cách tắt telemetry Next (NEXT_TELEMETRY_DISABLED=1)");
} else fail("thiếu docs/RISKS.md");

// ---- 6. Ops docs
const need = [
  "docs/ops/RUNBOOK.md",
  "docs/ops/INCIDENT-RESPONSE.md",
  "docs/ops/runbooks/restore-db.md",
  "docs/ops/runbooks/restore-files.md",
  "docs/ops/runbooks/data-breach.md",
  "docs/ops/SLO.md",
  "docs/ops/VULN-SLA.md",
  "docs/ops/RPO-RTO.md",
  "docs/ops/incidents/README.md",
  "docs/handover/accounts.md",
  "docs/handover/renewals.md",
  "docs/privacy/data-map.yaml",
  "docs/compliance/data-inventory.csv",
  "docs/compliance/test-data-policy.md",
];
for (const f of need) if (!has(f)) fail(`thiếu ${f}`);
if (has("docs/ops/RUNBOOK.md")) {
  const rb = read("docs/ops/RUNBOOK.md");
  const ld = frontmatter(rb).last_drilled;
  if (!ld) fail("RUNBOOK: thiếu last_drilled");
  else if (/^\d{4}-\d{2}-\d{2}$/.test(ld)) {
    if (NOW - new Date(ld) > 183 * 864e5) fail(`RUNBOOK: last_drilled ${ld} quá 6 tháng`);
  } else out(`CẢNH BÁO: RUNBOOK last_drilled = "${ld}"`);
  for (const h of ["Lộ bí mật", "SESSION_SECRET", "QR_SIGNING_KEYS", "Mật khẩu DB"])
    if (!rb.includes(h)) fail(`RUNBOOK: thiếu "${h}"`);
}
if (has("docs/ops/INCIDENT-RESPONSE.md")) {
  const ir = read("docs/ops/INCIDENT-RESPONSE.md");
  for (const sev of ["SEV1", "SEV2", "SEV3", "SEV4"]) {
    const r = tableRows(ir).find((x) => x[0] === sev);
    if (!r) fail(`INCIDENT-RESPONSE: thiếu ${sev}`);
    else if ((r[2]?.match(/\(\d\)/g) ?? []).length < 2) fail(`INCIDENT-RESPONSE: ${sev} cần ≥ 2 ví dụ`);
  }
  for (const h of [
    "Trước khi chạy lệnh lên dữ liệu",
    "Nhánh sự cố bảo mật",
    "Giảm thiệt hại",
    "Bảo toàn chứng cứ",
  ])
    if (!ir.toLowerCase().includes(h.toLowerCase())) fail(`INCIDENT-RESPONSE: thiếu "${h}"`);
}
if (has("docs/ops/runbooks/data-breach.md")) {
  const db = read("docs/ops/runbooks/data-breach.md");
  for (const k of ["72 giờ", "Mẫu 08", "pháp chế xác minh", "Singapore", "EU"])
    if (!db.includes(k)) fail(`data-breach: thiếu "${k}"`);
}
if (has("docs/ops/RPO-RTO.md")) {
  const rr = read("docs/ops/RPO-RTO.md");
  if (!/ĐỀ XUẤT/.test(rr) || !/\| Kho \| RPO .*\| RTO .*\| Cơ chế .*\| Lần diễn tập/.test(rr))
    fail("RPO-RTO: thiếu bảng kho → RPO → RTO → cơ chế → diễn tập hoặc nhãn ĐỀ XUẤT");
}
if (has("docs/ops/VULN-SLA.md") && !/Critical[\s\S]*High[\s\S]*Medium/.test(read("docs/ops/VULN-SLA.md")))
  fail("VULN-SLA: thiếu SLA theo mức");

// ---- 7. SLO (OPS-SLO-001) — kiểm cấu trúc
if (has("docs/ops/SLO.md")) {
  const slo = read("docs/ops/SLO.md");
  const sliRows = tableRows(slo).filter((r) => /^SLI-\d/.test(r[0]));
  if (!sliRows.some((r) => r[1] === "availability")) fail("SLO: cần ≥ 1 SLI availability");
  if (!sliRows.some((r) => r[1] === "latency")) fail("SLO: cần ≥ 1 SLI latency");
  for (const r of sliRows) {
    if (!r[2] || !r[3] || !/\d/.test(r[4] ?? ""))
      fail(`SLO ${r[0]}: thiếu định nghĩa tốt/tổng hoặc mục tiêu`);
    const block = slo.split(new RegExp(`^## ${r[0].replace(/\s.*/, "")} `, "m"))[1]?.split(/^## /m)[0] ?? "";
    const q = block.match(/```(promql|sql)\n([\s\S]*?)```/);
    if (!q) {
      fail(`SLO ${r[0]}: thiếu khối query promql/sql`);
      continue;
    }
    const body = q[2];
    if (
      (body.match(/\(/g) ?? []).length !== (body.match(/\)/g) ?? []).length ||
      (body.match(/'/g) ?? []).length % 2
    )
      fail(`SLO ${r[0]}: query ngoặc/nháy không cân`);
    if (
      q[1] === "sql" &&
      !(/\bgood\b/i.test(body) && /\btotal\b/i.test(body) && /\bSELECT\b[\s\S]*\bFROM\b/i.test(body))
    )
      fail(`SLO ${r[0]}: SQL cần alias good/total và SELECT…FROM`);
    if (q[1] === "promql" && !/\/\s*(#.*)?\n?\s*sum\(/.test(body))
      fail(`SLO ${r[0]}: PromQL phải là tỷ lệ good/total`);
  }
}

// ---- 8. Data map ↔ migrations ↔ kiểm kê (CMP-PRIV-001, STD-PRIV-002, BASE-SEC-013)
function parseMap(txt) {
  const res = {};
  let key = null;
  let cur = null;
  for (const raw of txt.split("\n")) {
    const l = raw.replace(/\s+$/, "");
    if (!l || l.trimStart().startsWith("#")) continue;
    let m;
    if ((m = l.match(/^([a-z_]+):\s*(.*)$/)) && !l.startsWith(" ")) {
      key = m[1];
      if (m[2]) res[key] = m[2];
      else res[key] = [];
      cur = null;
      continue;
    }
    if ((m = l.match(/^\s+- ([a-z_]+):\s*(.*)$/))) {
      cur = {};
      res[key].push(cur);
      cur[m[1]] = unq(m[2]);
      continue;
    }
    if ((m = l.match(/^\s+([a-z_]+):\s*(.*)$/)) && cur) cur[m[1]] = unq(m[2]);
  }
  return res;
}
const unq = (s) => (s.startsWith('"') ? JSON.parse(s) : s);
const PII_TOKENS = new Set([
  "email",
  "phone",
  "address",
  "lat",
  "lng",
  "geo",
  "ip",
  "name_full",
  "birth",
  "dob",
  "cccd",
  "national",
  "tax",
  "password",
  "token",
  "cover",
  "message",
]);
const PII_NAMES = new Set([
  "device",
  "full_name",
  "display_name",
  "user_agent",
  "ip_hash",
  "cover_letter",
  "hired_on",
  "terminated_on",
  "work_email",
  "tax_code",
  "password_hash",
  "token_hash",
]);
const isCandidate = (c) => PII_NAMES.has(c) || c.split("_").some((t) => PII_TOKENS.has(t));
{
  const cols = new Set();
  for (const f of walk(p("migrations"), (x) => x.endsWith(".sql")).sort()) {
    const s = read(f).replace(/--[^\n]*/g, "");
    for (const m of s.matchAll(/CREATE TABLE (\w+) \(([\s\S]*?)\n\);/g)) {
      let depth = 0,
        cur = "";
      const parts = [];
      for (const ch of m[2]) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        if (ch === "," && depth === 0) {
          parts.push(cur);
          cur = "";
        } else cur += ch;
      }
      parts.push(cur);
      for (const part of parts) {
        const w = part.trim().split(/\s+/)[0];
        if (w && !/^(UNIQUE|FOREIGN|CHECK|PRIMARY|EXCLUDE|CONSTRAINT)$/i.test(w)) cols.add(`${m[1]}.${w}`);
      }
    }
    // Một ALTER TABLE có thể thêm nhiều cột: `ADD COLUMN a …, ADD COLUMN b …` — quét cả câu tới dấu `;`.
    for (const m of s.matchAll(/ALTER TABLE (?:IF EXISTS )?(\w+)([^;]*);/g))
      for (const c of m[2].matchAll(/\bADD COLUMN (?:IF NOT EXISTS )?(\w+)/g)) cols.add(`${m[1]}.${c[1]}`);
    for (const m of s.matchAll(/ALTER TABLE (\w+)\s+DROP COLUMN (?:IF EXISTS )?(\w+)/g))
      cols.delete(`${m[1]}.${m[2]}`);
  }
  if (has("docs/privacy/data-map.yaml")) {
    const map = parseMap(read("docs/privacy/data-map.yaml"));
    const pii = map.pii ?? [];
    const non = map.reviewed_non_pii ?? [];
    const piiKeys = new Set();
    const REQ = [
      "table",
      "column",
      "class",
      "subject",
      "purpose",
      "legal_basis",
      "retention",
      "copies",
      "recipients",
      "status",
    ];
    for (const e of pii) {
      const k = `${e.table}.${e.column}`;
      if (piiKeys.has(k)) fail(`data-map: trùng ${k}`);
      piiKeys.add(k);
      for (const r of REQ) if (!e[r]) fail(`data-map ${k}: thiếu ${r}`);
      if (!["thuong", "nhay_cam", "bi_mat"].includes(e.class)) fail(`data-map ${k}: class không hợp lệ`);
      if (e.status === "implemented" && !cols.has(k))
        fail(`data-map ${k}: cột không có trong migrations/*.sql (status: implemented)`);
      if (e.status === "planned" && cols.has(k))
        out(`CẢNH BÁO: data-map ${k} đã có trong schema — đổi status thành implemented`);
    }
    const nonKeys = new Set(non.map((e) => `${e.table}.${e.column}`));
    let cand = 0;
    for (const k of cols) {
      if (!isCandidate(k.split(".")[1])) continue;
      cand++;
      if (!piiKeys.has(k) && !nonKeys.has(k)) fail(`cột PII chưa khai báo trong data-map: ${k}`);
    }
    for (const k of nonKeys) if (!cols.has(k)) fail(`data-map reviewed_non_pii ${k} không có trong schema`);
    for (const e of map.linked_tables ?? [])
      if (![...cols].some((c) => c.startsWith(`${e.table}.`)))
        fail(`data-map linked_tables ${e.table} không có trong schema`);
    out(
      `Data map: ${pii.length} cột PII khai báo · ${cand} cột ứng viên trong schema · ${cols.size} cột tổng`,
    );
    // kiểm kê CSV
    if (has("docs/compliance/data-inventory.csv")) {
      const lines = read("docs/compliance/data-inventory.csv").trim().split("\n");
      const header = lines.shift().split(",");
      const csvKeys = new Set();
      for (const l of lines) {
        const f = [];
        let cur = "",
          q = false;
        for (const ch of l) {
          if (ch === '"') q = !q;
          else if (ch === "," && !q) {
            f.push(cur);
            cur = "";
          } else cur += ch;
        }
        f.push(cur);
        if (f.length !== header.length || f.some((x) => !x)) {
          fail(`data-inventory: dòng thiếu cột: ${l.slice(0, 50)}`);
          continue;
        }
        csvKeys.add(`${f[1]}.${f[2]}`);
      }
      for (const k of piiKeys) if (!csvKeys.has(k)) fail(`data-inventory thiếu ${k}`);
      for (const k of csvKeys) if (!piiKeys.has(k)) fail(`data-inventory có ${k} không có trong data-map`);
    }
  }
}

// ---- 9. Dữ liệu test (QA-DATA-001/002)
{
  const policy = has("docs/compliance/test-data-policy.md")
    ? read("docs/compliance/test-data-policy.md")
    : "";
  const allowedPhones = new Set(
    [...(policy.split("## Số mẫu được phép")[1]?.split("##")[0] ?? "").matchAll(/`([+\d]+)`/g)].map(
      (m) => m[1],
    ),
  );
  const exceptions = new Set(
    [...(policy.split("## Ngoại lệ đã biết")[1] ?? "").matchAll(/\| (\S+\.\w+) \| (\S+@\S+) \|/g)].map(
      (m) => `${m[1]}|${m[2]}`,
    ),
  );
  const usedExceptions = new Set();
  const okDomain = (d) =>
    /^(example\.(com|org|net)|.*\.(test|example|invalid|localhost))$/i.test(d) ||
    /^(test|example|invalid|localhost)$/i.test(d);
  const files = [
    ...walk(p("tests")),
    ...walk(p("e2e")),
    ...walk(p("scripts"), (x) => !/check-(repo-)?docs\.mjs$/.test(x)),
  ].filter((f) => /\.(ts|tsx|mjs|js|json|sql|csv|sh)$/.test(f));
  for (const f of files) {
    const txt = read(f);
    for (const m of txt.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g)) {
      if (okDomain(m[1])) continue;
      const key = `${f}|${m[0]}`;
      if (exceptions.has(key)) usedExceptions.add(key);
      else fail(`fixture có email ngoài domain cho phép: ${m[0]} (${f})`);
    }
    for (const m of txt.matchAll(/(?<![\d])(?:\+84|84|0)[35789]\d{8}(?!\d)/g)) {
      if (!allowedPhones.has(m[0])) fail(`fixture có số điện thoại dạng thật: ${m[0]} (${f})`);
    }
  }
  for (const k of exceptions)
    if (!usedExceptions.has(k))
      out(`CẢNH BÁO: ngoại lệ email không còn khớp, xoá khỏi test-data-policy.md: ${k}`);
  if (usedExceptions.size)
    out(
      `CẢNH BÁO: ${usedExceptions.size} email fixture thuộc danh sách ngoại lệ (nợ) — đổi sang @example.test`,
    );
  // tệp dữ liệu lớn / có cột PII
  for (const f of walk(ROOT, (x) => /\.(sql|csv|json)$/.test(x) && !x.endsWith("package-lock.json"))) {
    const rel = relative(ROOT, p(f)).split("\\").join("/");
    if (statSync(p(rel)).size > 1024 * 1024) fail(`tệp dữ liệu > 1 MB: ${rel}`);
    if (
      rel.endsWith(".csv") &&
      rel !== "docs/compliance/data-inventory.csv" &&
      /(^|,)\s*"?(email|phone|dien_thoai)\b/i.test(read(rel).split("\n")[0])
    )
      fail(`CSV có cột PII ngoài kiểm kê: ${rel}`);
  }
}

// ---- 10. Liên kết nội bộ
{
  const lc = ".xtemplates/scripts/check-links.py";
  if (has(lc)) {
    const r = spawnSync("python3", [p(lc), ROOT], { encoding: "utf8" });
    if (r.error) out("CẢNH BÁO: không chạy được python3 — bỏ qua kiểm liên kết");
    else if (r.status !== 0)
      for (const l of (r.stdout + r.stderr).split("\n").filter(Boolean)) fail(`liên kết: ${l}`);
  } else out("CẢNH BÁO: không có check-links.py — bỏ qua kiểm liên kết");
}

if (errors.length) {
  for (const e of errors) process.stderr.write(`✗ ${e}\n`);
  process.stderr.write(`check:docs: ${errors.length} lỗi\n`);
  process.exit(1);
}
out("check:docs: OK");
