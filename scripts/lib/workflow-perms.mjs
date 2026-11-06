// BASE-SEC-006 / BASE-GATE-010: quyền GITHUB_TOKEN thực tế của từng job trong .github/workflows/*.yml (job không khai
// `permissions` thì kế thừa mức workflow). Bảng sinh ra nằm giữa hai mốc trong docs/ops/PERMISSIONS.md; check:ci-policy so
// bảng với workflow thật — nới quyền mà không cập nhật tài liệu (người duyệt thấy trong PR) = đỏ.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const START = "<!-- workflow-perms:start (sinh bởi node scripts/lib/workflow-perms.mjs --write) -->";
export const END = "<!-- workflow-perms:end -->";

/** Khối `permissions:` bắt đầu ở dòng i với thụt lề `indent` → "k: v, …" (đã xếp) hoặc giá trị vô hướng (read-all…). */
function block(lines, i, indent) {
  const head = lines[i].slice(indent).replace(/\s+#.*$/, "");
  const inline = head.replace(/^permissions:\s*/, "").trim();
  if (inline) return inline === "{}" ? "(không quyền)" : inline;
  const out = [];
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j];
    if (!l.trim() || l.trim().startsWith("#")) continue;
    const ind = l.length - l.trimStart().length;
    if (ind <= indent) break;
    const m = /^\s*([a-z-]+):\s*(read|write|none)\b/.exec(l);
    if (m) out.push(`${m[1]}: ${m[2]}`);
  }
  return out.length ? out.sort().join(", ") : "(không quyền)";
}

/** Quyền theo job của một workflow: [{job, perms, own}] — `own` = job tự khai. */
export function workflowPerms(text) {
  const lines = text.split("\n");
  let top = "(mặc định của repo — thiếu permissions)";
  const jobs = [];
  let inJobs = false;
  let cur = null;
  for (const [i, l] of lines.entries()) {
    if (/^permissions:/.test(l)) top = block(lines, i, 0);
    if (/^jobs:\s*$/.test(l)) {
      inJobs = true;
      continue;
    }
    if (inJobs && /^\S/.test(l)) inJobs = false;
    if (!inJobs) continue;
    const jm = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(l);
    if (jm) {
      cur = { job: jm[1], perms: null };
      jobs.push(cur);
    } else if (cur && /^ {4}permissions:/.test(l)) cur.perms = block(lines, i, 4);
  }
  return jobs.map((j) => ({ job: j.job, perms: j.perms ?? top, own: j.perms !== null }));
}

/** Bảng Markdown cho mọi workflow trong thư mục (thứ tự tệp + thứ tự job tất định). */
export function renderTable(dir) {
  const rows = ["| Workflow | Job | Quyền GITHUB_TOKEN | Nguồn |", "| --- | --- | --- | --- |"];
  for (const f of readdirSync(dir)
    .filter((x) => /\.ya?ml$/.test(x))
    .sort())
    for (const j of workflowPerms(readFileSync(path.join(dir, f), "utf8")))
      rows.push(`| ${f} | ${j.job} | ${j.perms} | ${j.own ? "job" : "workflow"} |`);
  return [START, ...rows, END].join("\n");
}

/**
 * XC-GREEN-007: bước `uses: actions/upload-artifact@…` nào không có `retention-days` trong cùng bước → lỗi `tệp:dòng`.
 * Bước kết thúc ở dòng `- ` kế tiếp cùng mức thụt lề hoặc khi thụt lề nhỏ hơn.
 */
export function uploadsWithoutRetentionText(text, file) {
  const lines = text.split("\n");
  const out = [];
  for (const [i, l] of lines.entries()) {
    if (!/uses:\s*actions\/upload-artifact@/.test(l)) continue;
    const dash = /^(\s*)- /.exec(l);
    const stepIndent = dash ? dash[1].length : l.length - l.trimStart().length - 2;
    let ok = false;
    for (let j = i + 1; j < lines.length; j++) {
      const m = lines[j];
      if (!m.trim()) continue;
      const ind = m.length - m.trimStart().length;
      if (ind <= stepIndent) break;
      if (/^\s*retention-days:\s*\d+/.test(m)) ok = true;
    }
    if (!ok) out.push(`XC-GREEN-007: ${file}:${i + 1} upload-artifact thiếu retention-days`);
  }
  return out;
}

export function uploadsWithoutRetention(dir) {
  return readdirSync(dir)
    .filter((x) => /\.ya?ml$/.test(x))
    .sort()
    .flatMap((f) => uploadsWithoutRetentionText(readFileSync(path.join(dir, f), "utf8"), `${dir}/${f}`));
}

/** Bảng trong tài liệu khớp workflow thật không — trả lỗi (rỗng = khớp). */
export function checkDoc(doc, dir) {
  const a = doc.indexOf(START);
  const b = doc.indexOf(END);
  if (a < 0 || b < a) return [`docs/ops/PERMISSIONS.md thiếu bảng giữa hai mốc workflow-perms`];
  return doc.slice(a, b + END.length) === renderTable(dir)
    ? []
    : [
        "BASE-SEC-006: quyền GITHUB_TOKEN trong .github/workflows lệch bảng docs/ops/PERMISSIONS.md — chạy `node scripts/lib/workflow-perms.mjs --write`, rà thay đổi quyền rồi commit",
      ];
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}` && process.argv.includes("--write")) {
  const { writeFileSync } = await import("node:fs");
  const docPath = "docs/ops/PERMISSIONS.md";
  const doc = readFileSync(docPath, "utf8");
  const a = doc.indexOf(START);
  const b = doc.indexOf(END);
  if (a < 0 || b < a) throw new Error(`${docPath}: thiếu mốc ${START} … ${END}`);
  writeFileSync(docPath, doc.slice(0, a) + renderTable(".github/workflows") + doc.slice(b + END.length));
  console.log(`đã ghi bảng quyền vào ${docPath}`);
}
