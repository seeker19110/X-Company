// pr-policy (WF-REVIEW-002, WF-DOC-001, STD-PROC-004, BASE-REPO-005, BASE-DEP-006, QA-STRAT-005, FE-TEST-006,
// XC-GREEN-005, DB-MIG-011, LOOP-STOP-003): kiểm PR trước merge. Repo squash-merge → tiêu đề PR là subject commit
// vào main, nên commitlint áp lên tiêu đề. Đọc sự kiện từ GITHUB_EVENT_PATH (không nội suy body vào shell).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const TYPES = "feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert";
const TITLE = new RegExp(`^(${TYPES})(\\([a-z0-9-]+\\))?!?: \\S.*$`);
const MAX_SUBJECT = 72;
export const REQUIRED_SECTIONS = ["Mô tả", "Bằng chứng", "Rủi ro", "Rollback", "Tài liệu"];

/** Nội dung một mục `## Tên` (bỏ comment HTML); null nếu không có mục. */
export function section(body, name) {
  const re = new RegExp(`^##\\s+${name}\\s*$([\\s\\S]*?)(?=^##\\s|$(?![\\s\\S]))`, "m");
  const m = re.exec(body);
  return m === null ? null : m[1].replace(/<!--[\s\S]*?-->/g, "").trim();
}

/** Dòng `- [x] <nhãn>: <nội dung>` — nội dung sau nhãn (rỗng nếu chưa điền). */
function field(body, label) {
  const m = new RegExp(`${label}[ \\t]*:?[ \\t]*(.*)$`, "m").exec(body);
  return m === null ? null : m[1].replace(/<!--.*?-->/g, "").trim();
}

export function checkPr({ title, body, files }) {
  const errors = [];
  const warnings = [];
  const b = body ?? "";
  if (!TITLE.test(title)) errors.push(`tiêu đề phải theo Conventional Commits (${TYPES}): "${title}"`);
  if ([...title].length > MAX_SUBJECT) errors.push(`tiêu đề ${[...title].length} ký tự > ${MAX_SUBJECT}`);
  for (const s of REQUIRED_SECTIONS) {
    const c = section(b, s);
    if (c === null || c === "") errors.push(`thiếu hoặc để trống mục "## ${s}"`);
  }
  const type = (/^(\w+)/.exec(title) ?? [])[1];
  const touchesTests = files.some((f) => /^(tests|e2e)\//.test(f));
  if (type === "fix" && !touchesTests)
    errors.push("PR fix: phải kèm test tái hiện lỗi (đổi tệp trong tests/ hoặc e2e/)");
  if ((type === "refactor" || type === "perf") && !/\|\s*Trước\s*\|\s*Sau\s*\|/.test(b))
    errors.push(`PR ${type}: cần bảng "| Trước | Sau |" (số đo/hành vi), không trộn tính năng`);
  if (files.includes("package-lock.json")) {
    const v = field(b, "Phụ thuộc mới");
    if (v === null || v === "")
      errors.push('lockfile đổi: điền dòng "Phụ thuộc mới: <tên · phiên bản · license · lý do | không có>"');
  }
  const gateCfg = files.filter((f) =>
    /^(\.github\/|\.claude\/|xt\.yaml$|eslint\.config|tsconfig|\.c8rc|scripts\/coverage\.sh$|migrations\/)/.test(
      f,
    ),
  );
  if (gateCfg.length > 0) {
    const v = field(b, "Lý do sửa cấu hình cổng/migration");
    if (v === null || v === "")
      errors.push(`đổi cấu hình cổng/migration (${gateCfg[0]}…): điền "Lý do sửa cấu hình cổng/migration:"`);
  }
  if (files.some((f) => f.startsWith("migrations/"))) {
    const v = field(b, "Backup trước migrate");
    if (v === null || v === "")
      errors.push('migration mới: điền "Backup trước migrate: <link/lệnh | chưa có production>"');
  }
  const apiOrConfig = files.some((f) =>
    /^(app\/api\/|lib\/.*routes\.ts$|xt\.yaml$|lib\/nen\/env\.ts$)/.test(f),
  );
  if (apiOrConfig && !files.some((f) => f.startsWith("docs/") || f.endsWith(".md")))
    warnings.push("đổi API/cấu hình mà không chạm docs/ — cập nhật tài liệu hoặc ghi lý do ở mục Tài liệu");
  return { errors, warnings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ev = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8"));
  const pr = ev.pull_request;
  const base = `origin/${pr.base.ref}`;
  // Hai chấm (so cây): đúng cả khi nhánh nối lịch sử sau squash-merge.
  const files = execFileSync("git", ["diff", "--name-only", base, "HEAD"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  const { errors, warnings } = checkPr({ title: pr.title, body: pr.body ?? "", files });
  for (const w of warnings) console.log(`::warning::${w}`);
  for (const e of errors) console.log(`::error::${e}`);
  if (errors.length > 0) process.exit(1);
  console.log(`pr-policy: OK (${files.length} tệp đổi)`);
}
