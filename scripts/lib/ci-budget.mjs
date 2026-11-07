// XC-GREEN-002: ngân sách CI mỗi PR — số job và tổng phút tối đa (tổng timeout-minutes) của mọi job thuộc workflow chạy
// trên pull_request/pull_request_target. Ngân sách ở perf-budget.json (`ci`); check:ci-policy đỏ khi vượt, khi một job
// thiếu timeout-minutes (job không trần = ngân sách vô hạn: mặc định GitHub 360 phút), hoặc khi ngân sách thiếu/sai kiểu.
// Đếm bảo thủ: job có `if:` vẫn tính (trần là trường hợp xấu nhất), job matrix tính 1 × số tổ hợp nếu đọc được.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** Workflow có chạy trên PR không (`on:` dạng khối, một dòng, hay mảng). */
export function runsOnPr(text) {
  // Khoá `on` có thể có nháy (`"on":` — YAML 1.1 coi `on` trần là boolean nên có người viết vậy).
  // Chú thích ở cột 0 trong khối `on:` không kết thúc khối (review #100).
  const on = /^["']?on["']?:([^\n]*)\n((?:[ \t]+.*\n|\n|#.*\n)*)/m.exec(text) ?? [];
  // Bỏ chú thích (đầu dòng hoặc sau khoảng trắng) trước khi tìm: chú thích cột 0 ngay sau khối `on:` bị gom vào khối,
  // chữ "pull_request" trong đó không được tính (review #100 vòng 2).
  const body = `${on[1] ?? ""}\n${on[2] ?? ""}`.replace(/(^|[ \t])#.*$/gm, "$1");
  return /\bpull_request(_target)?\b/.test(body);
}

/** Job của một workflow: [{job, timeout (phút) | null, copies}] — copies = số tổ hợp matrix (1 nếu không có). */
export function workflowJobs(text) {
  const jobsText = /^jobs:\n([\s\S]*)/m.exec(text)?.[1] ?? "";
  const out = [];
  // Tên job có thể kèm chú thích cuối dòng; chú thích ở cột 0/2 giữa thân job không cắt job (review #100).
  for (const m of jobsText.matchAll(
    /^ {2}([A-Za-z0-9_-]+):[ \t]*(?:#[^\n]*)?\n((?: {4}.*\n|\n| {0,2}#.*\n)*)/gm,
  )) {
    const body = m[2];
    const t = /^ {4}timeout-minutes:\s*(\d+)\b/m.exec(body);
    // matrix một chiều dạng `name: [a, b, c]` — nhân các chiều đọc được; dạng khác coi như 1 (ghi chú trong lỗi nếu có).
    let copies = 1;
    const matrix = /^ {6}matrix:\n((?: {8}.*\n)*)/m.exec(body)?.[1] ?? "";
    for (const d of matrix.matchAll(/^ {8}[A-Za-z0-9_-]+:\s*\[([^\]]*)\]/gm))
      copies *= d[1].split(",").filter((s) => s.trim()).length || 1;
    out.push({ job: m[1], timeout: t ? Number(t[1]) : null, copies });
  }
  return out;
}

/** Đo ngân sách cho thư mục workflow. budget = {max_jobs_per_pr, max_minutes_per_pr} (số nguyên dương). */
export function checkCiBudget(dir, budget) {
  const errors = [];
  const ok = (v) => Number.isInteger(v) && v > 0;
  if (!budget || !ok(budget.max_jobs_per_pr) || !ok(budget.max_minutes_per_pr))
    return {
      jobs: 0,
      minutes: 0,
      rows: [],
      errors: [
        "XC-GREEN-002: perf-budget.json thiếu ci.max_jobs_per_pr / ci.max_minutes_per_pr (số nguyên > 0)",
      ],
    };
  const rows = [];
  for (const f of readdirSync(dir)
    .filter((x) => /\.ya?ml$/.test(x))
    .sort()) {
    const text = readFileSync(path.join(dir, f), "utf8");
    if (!runsOnPr(text)) continue;
    for (const j of workflowJobs(text)) {
      rows.push({ workflow: f, ...j });
      if (j.timeout === null)
        errors.push(`XC-GREEN-002: ${f} job ${j.job} thiếu timeout-minutes (chạy trên PR)`);
    }
  }
  const jobs = rows.reduce((s, r) => s + r.copies, 0);
  const minutes = rows.reduce((s, r) => s + r.copies * (r.timeout ?? 360), 0);
  if (jobs > budget.max_jobs_per_pr)
    errors.push(
      `XC-GREEN-002: ${jobs} job mỗi PR > ngân sách ${budget.max_jobs_per_pr} (perf-budget.json ci)`,
    );
  if (minutes > budget.max_minutes_per_pr)
    errors.push(
      `XC-GREEN-002: tổng trần ${minutes} phút mỗi PR > ngân sách ${budget.max_minutes_per_pr} (perf-budget.json ci)`,
    );
  return { jobs, minutes, rows, errors };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const budget = JSON.parse(readFileSync("perf-budget.json", "utf8")).ci;
  const r = checkCiBudget(".github/workflows", budget ?? null);
  for (const x of r.rows)
    console.log(`${x.workflow}\t${x.job}\t${x.timeout ?? "∞"}${x.copies > 1 ? ` ×${x.copies}` : ""}`);
  console.log(`tổng: ${r.jobs} job, ${r.minutes} phút trần`);
  r.errors.forEach((e) => console.error(e));
  process.exit(r.errors.length ? 1 : 0);
}
