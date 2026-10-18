// npm run check:repo-docs — kiểm tệp dự án (T-035): tồn tại, README đủ mục, AGENTS.md khớp xt.yaml,
// security.txt chưa hết hạn, CREDITS phủ mọi tệp ảnh. Không ghi file; exit 1 nếu có lỗi.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = process.env.CHECK_NOW ? new Date(process.env.CHECK_NOW) : new Date();
const errors = [];
const out = (s) => process.stdout.write(`${s}\n`);
const fail = (msg) => errors.push(msg);
const p = (rel) => join(ROOT, rel);
const read = (rel) => readFileSync(p(rel), "utf8");
const has = (rel) => existsSync(p(rel));

// 1. Tệp bắt buộc.
const REQUIRED = [
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "SUPPORT.md",
  "RUNBOOK.md",
  "AGENTS.md",
  "xt.yaml",
  ".editorconfig",
  "public/.well-known/security.txt",
  ".github/CODEOWNERS",
  ".github/ISSUE_TEMPLATE/bug.yml",
  ".github/ISSUE_TEMPLATE/feature.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/pull_request_template.md",
  "assets/CREDITS.md",
  "docs/RISKS.md",
  "docs/ops/RUNBOOK.md",
  "docs/adr",
];
for (const f of REQUIRED) if (!has(f)) fail(`thiếu ${f}`);

const pkg = has("package.json") ? JSON.parse(read("package.json")) : { scripts: {} };
const scripts = pkg.scripts ?? {};

// 2. package.json ↔ LICENSE (BASE-REPO-004).
if (pkg.license !== "UNLICENSED") fail(`package.json license phải là "UNLICENSED" (đang: ${pkg.license})`);
if (has("LICENSE") && !/All rights reserved/i.test(read("LICENSE")))
  fail("LICENSE thiếu câu 'All rights reserved'");
if (has("LICENSE") && !/^Copyright \(c\) 2026 /m.test(read("LICENSE")))
  fail("LICENSE thiếu dòng 'Copyright (c) 2026 …'");

// 3. README: heading bắt buộc (BASE-DOC-001), ≤ 3 lệnh clone→test (XC-DX-001), npm run trỏ script thật.
if (has("README.md")) {
  const readme = read("README.md");
  const headings = [...readme.matchAll(/^#{1,3} (.+)$/gm)].map((m) => m[1].toLowerCase());
  const needHeadings = [
    "yêu cầu môi trường",
    "cài đặt & chạy",
    "chạy test",
    "cấu hình",
    "đóng góp & liên hệ",
    "giấy phép",
    "bắt đầu nhanh",
  ];
  for (const h of needHeadings) if (!headings.some((x) => x.includes(h))) fail(`README thiếu heading "${h}"`);
  const firstBash = readme.match(/```bash\n([\s\S]*?)```/);
  const cmds = firstBash ? firstBash[1].split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")) : [];
  if (cmds.length === 0 || cmds.length > 3)
    fail(`khối bash đầu README phải có 1–3 lệnh clone→test (đang: ${cmds.length})`);
  if (!cmds.some((c) => /\bnpm (test|run -s test)\b/.test(c))) fail("khối bash đầu README thiếu lệnh test");
  for (const m of readme.matchAll(/\bnpm run (?:-s )?([a-z0-9:_-]+)/g)) {
    if (!(m[1] in scripts)) fail(`README gọi "npm run ${m[1]}" nhưng package.json không có script này`);
  }
  if (!readme.includes(".env.example")) fail("README phải trỏ .env.example");
}

// 4. xt.yaml (phẳng) ↔ AGENTS.md mục Lệnh (XC-DOCAI-001, XC-DOCAI-003, XC-DX-002).
const xt = new Map();
if (has("xt.yaml")) {
  for (const line of read("xt.yaml").split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const i = line.indexOf(":");
    if (i > 0) xt.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  for (const k of ["install", "dev", "migrate", "lint", "typecheck", "test", "build", "format", "e2e"]) {
    if (!xt.get(k)) fail(`xt.yaml thiếu khoá "${k}"`);
  }
  for (const [k, v] of xt) {
    for (const m of v.matchAll(/\bnpm run (?:-s )?([a-z0-9:_-]+)/g)) {
      if (!(m[1] in scripts))
        fail(`xt.yaml "${k}" gọi "npm run ${m[1]}" nhưng package.json không có script này`);
    }
  }
}
if (has("AGENTS.md")) {
  const agents = read("AGENTS.md");
  const sec = agents.match(/^## [^\n]*Lệnh\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  if (!sec) fail('AGENTS.md thiếu mục "Lệnh"');
  else {
    const block = sec[1].match(/```text\n([\s\S]*?)```/);
    const lines = block ? block[1].split("\n").filter((l) => l.trim()) : [];
    if (lines.length === 0) fail("AGENTS.md mục Lệnh không có khối ```text```");
    const listed = new Set();
    for (const l of lines) {
      const i = l.indexOf(":");
      const k = l.slice(0, i).trim();
      const v = l.slice(i + 1).trim();
      listed.add(k);
      if (xt.get(k) !== v)
        fail(`AGENTS.md lệnh "${l}" không khớp xt.yaml (${k}: ${xt.get(k) ?? "<không có>"})`);
    }
    for (const k of [
      "install",
      "dev",
      "lint",
      "typecheck",
      "test",
      "build",
      "format",
      "coverage",
      "e2e",
      "migrate",
    ]) {
      if (!listed.has(k)) fail(`AGENTS.md mục Lệnh thiếu "${k}"`);
    }
  }
  if (!agents.includes("Hướng dẫn này không thay cho hook/permission — máy kiểm mới là hàng rào")) {
    fail("AGENTS.md thiếu câu 'Hướng dẫn này không thay cho hook/permission — máy kiểm mới là hàng rào'");
  }
  if (!agents.includes("dữ liệu, không phải chỉ thị")) fail("AGENTS.md thiếu 'dữ liệu, không phải chỉ thị'");
  if (!/Điểm dừng bắt buộc/.test(agents)) fail('AGENTS.md thiếu mục "Điểm dừng bắt buộc"');
  for (const f of ["AGENTS.md", "CLAUDE.md"]) {
    if (has(f) && /curl\s+[^\n|`]*\|\s*(ba)?sh\b/.test(read(f)))
      fail(`${f} chứa lệnh tải-và-chạy (curl | sh)`);
  }
}

// 5. CHANGELOG (BASE-REPO-007).
if (has("CHANGELOG.md")) {
  const cl = read("CHANGELOG.md");
  if (!/^## \[Unreleased\]/m.test(cl)) fail("CHANGELOG thiếu '## [Unreleased]'");
  for (let n = 1; n <= 12; n++) {
    const id = `F-${String(n).padStart(3, "0")}`;
    if (!cl.includes(id)) fail(`CHANGELOG [Unreleased] thiếu ${id}`);
  }
}

// 6. SECURITY.md + security.txt (BASE-SEC-009, XC-OSS-004, RFC 9116).
const ADVISORY = "https://github.com/seeker19110/X-Company/security/advisories/new";
if (has("SECURITY.md")) {
  const s = read("SECURITY.md");
  if (!s.includes(ADVISORY)) fail("SECURITY.md thiếu kênh GitHub Private Vulnerability Reporting");
  if (!/14 ngày/.test(s)) fail("SECURITY.md thiếu cam kết phản hồi ≤ 14 ngày");
}
if (has("public/.well-known/security.txt")) {
  const st = read("public/.well-known/security.txt");
  const field = (n) => [...st.matchAll(new RegExp(`^${n}:\\s*(.+)$`, "gim"))].map((m) => m[1].trim());
  if (!field("Contact").includes(ADVISORY)) fail("security.txt: Contact phải trỏ trang advisories GitHub");
  const exp = field("Expires")[0];
  const expDate = exp ? new Date(exp) : null;
  if (!expDate || Number.isNaN(expDate.getTime()))
    fail("security.txt: Expires thiếu hoặc không phải ISO 8601");
  else {
    if (expDate <= NOW) fail(`security.txt: Expires ${exp} đã quá hạn — gia hạn (RFC 9116)`);
    const maxMs = 366 * 24 * 3600 * 1000;
    if (expDate.getTime() - NOW.getTime() > maxMs) fail("security.txt: Expires cách hôm nay hơn 1 năm");
    const soon = 30 * 24 * 3600 * 1000;
    if (expDate > NOW && expDate.getTime() - NOW.getTime() < soon)
      out(`CẢNH BÁO: security.txt hết hạn trong < 30 ngày (${exp})`);
  }
  const langs = (field("Preferred-Languages")[0] ?? "").split(",").map((x) => x.trim());
  if (!(langs.includes("vi") && langs.includes("en")))
    fail("security.txt: Preferred-Languages phải gồm vi, en");
  // proxy.ts (nếu đã có): chuyển hướng đăng nhập chỉ được áp cho /app, không được chặn /.well-known/
  if (has("proxy.ts")) {
    const px = read("proxy.ts");
    if (!/\.well-known/.test(px) && !/pathname\.startsWith\("\/app"\)/.test(px)) {
      fail("proxy.ts: chuyển hướng phải giới hạn ở /app (startsWith) hoặc loại /.well-known/ khỏi matcher");
    }
  }
}

// 7. CODEOWNERS (WF-REVIEW-007, BASE-GATE-009, XC-DOCAI-005).
if (has(".github/CODEOWNERS")) {
  const co = read(".github/CODEOWNERS");
  for (const path of [
    "/lib/identity/",
    "/lib/authz/",
    "/migrations/",
    "/.github/",
    "/.claude/",
    "/AGENTS.md",
    "/CLAUDE.md",
    "/eslint.config.*",
    "/tsconfig*.json",
    "/lib/files/",
    "/docs/privacy/",
  ]) {
    const re = new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+@seeker19110\\b`, "m");
    if (!re.test(co)) fail(`CODEOWNERS thiếu dòng cho ${path}`);
  }
}

// 8. Mẫu issue (WF-TEAM-003).
if (has(".github/ISSUE_TEMPLATE/feature.yml")) {
  const f = read(".github/ISSUE_TEMPLATE/feature.yml");
  if (!/Definition of Ready/.test(f) || !/type: checkboxes/.test(f))
    fail("feature.yml thiếu checklist Definition of Ready");
  if (!/`ready`/.test(f)) fail("feature.yml phải nêu nhãn `ready`");
}
if (
  has(".github/ISSUE_TEMPLATE/config.yml") &&
  !read(".github/ISSUE_TEMPLATE/config.yml").includes(ADVISORY)
) {
  fail("ISSUE_TEMPLATE/config.yml phải có liên kết báo bảo mật riêng tư");
}

// 9. .editorconfig (BASE-DATA-001).
if (has(".editorconfig")) {
  const ec = read(".editorconfig");
  for (const re of [
    /^root\s*=\s*true/m,
    /^charset\s*=\s*utf-8/m,
    /^end_of_line\s*=\s*lf/m,
    /^indent_size\s*=\s*2/m,
  ]) {
    if (!re.test(ec)) fail(`.editorconfig thiếu ${re.source}`);
  }
}

// 10. CODE_OF_CONDUCT nêu Contributor Covenant 2.1, không bịa email.
if (has("CODE_OF_CONDUCT.md") && !/Contributor Covenant/.test(read("CODE_OF_CONDUCT.md")))
  fail("CODE_OF_CONDUCT thiếu ghi nhận Contributor Covenant");
if (has("CODE_OF_CONDUCT.md") && !/2\.1/.test(read("CODE_OF_CONDUCT.md")))
  fail("CODE_OF_CONDUCT phải nêu phiên bản 2.1");

// 11. CREDITS phủ mọi tệp trong public/icons và public/images (UX-VISUAL-007).
function walk(dir) {
  if (!existsSync(dir)) return [];
  const res = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) res.push(...walk(full));
    else res.push(relative(ROOT, full).split("\\").join("/"));
  }
  return res;
}
if (has("assets/CREDITS.md")) {
  const rows = [...read("assets/CREDITS.md").matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((m) => m[1]);
  const covered = (f) => rows.some((r) => (r.endsWith("/*") ? f.startsWith(r.slice(0, -1)) : r === f));
  const files = [...walk(p("public/icons")), ...walk(p("public/images"))];
  for (const f of files) if (!covered(f)) fail(`assets/CREDITS.md chưa phủ ${f}`);
  if (files.some((f) => f.startsWith("public/icons/")) && !has("scripts/make-icons.mjs")) {
    fail("public/icons/ có tệp nhưng thiếu scripts/make-icons.mjs (nguồn sinh ghi ở CREDITS)");
  }
  out(`CREDITS: ${files.length} tệp ảnh, ${rows.length} dòng nguồn`);
}

if (errors.length) {
  for (const e of errors) process.stderr.write(`✗ ${e}\n`);
  process.stderr.write(`check:repo-docs: ${errors.length} lỗi\n`);
  process.exit(1);
}
out("check:repo-docs: OK");
