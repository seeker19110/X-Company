// Lint migration (DB-MIG-008, OPS-DEPLOY-003) — tương đương squawk cho SQL thuần của dự án:
// 1) tên NNNN_ten.sql liên tục, không trùng số; 2) migration đã có ở nhánh gốc không được sửa (append-only);
// 3) migration MỚI không DROP TABLE/COLUMN, RENAME, đổi kiểu cột, TRUNCATE — trừ khi dòng đó có `-- contract: <lý do>`
//    (bước "contract" của expand/contract, chỉ sau khi bản N−1 không còn dùng).
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

const DIR = "migrations";
const NAME = /^(\d{4})_[a-z0-9_]+\.sql$/;
const BANNED = [
  [/\bDROP\s+TABLE\b/i, "DROP TABLE"],
  [/\bDROP\s+COLUMN\b/i, "DROP COLUMN"],
  [/\bRENAME\s+(COLUMN\b|TO\b)/i, "RENAME"],
  [/\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b/i, "đổi kiểu cột"],
  [/^\s*TRUNCATE\b/i, "TRUNCATE"],
];

export function nameProblems(files) {
  const errs = [];
  const nums = [];
  for (const f of files) {
    const m = NAME.exec(f);
    if (m === null) errs.push(`${f}: tên phải dạng NNNN_ten.sql (chữ thường, số, _)`);
    else nums.push(Number(m[1]));
  }
  const sorted = [...nums].sort((a, b) => a - b);
  sorted.forEach((n, i) => {
    if (n !== i + 1)
      errs.push(`số migration phải liên tục từ 0001: gặp ${String(n).padStart(4, "0")} ở vị trí ${i + 1}`);
  });
  return [...new Set(errs)];
}

export function bannedOps(file, sql) {
  const errs = [];
  sql.split("\n").forEach((line, i) => {
    const code = line.replace(/--.*$/, "");
    for (const [re, label] of BANNED)
      if (re.test(code) && !/--\s*contract:\s*\S/.test(line))
        errs.push(`${file}:${i + 1}: ${label} cần \`-- contract: <lý do>\``);
  });
  return errs;
}

function baseRef() {
  for (const ref of [
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : null,
    "origin/main",
    "main",
  ]) {
    if (ref === null) continue;
    try {
      execFileSync("git", ["rev-parse", "--verify", "--quiet", ref], { stdio: "pipe" });
      return ref;
    } catch {
      /* thử ref kế */
    }
  }
  return null;
}

function baseFiles(ref) {
  const out = execFileSync("git", ["ls-tree", "--name-only", `${ref}:${DIR}`], { encoding: "utf8" });
  return out.split("\n").filter((f) => f.endsWith(".sql"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const errs = nameProblems(files);
  const ref = baseRef();
  const old = ref === null ? [] : baseFiles(ref);
  if (ref === null) console.log("check-migrations: không có nhánh gốc — coi mọi migration là mới");
  for (const f of old) {
    if (!files.includes(f)) {
      errs.push(`${f}: migration đã có ở ${ref} bị xoá`);
      continue;
    }
    const before = execFileSync("git", ["show", `${ref}:${DIR}/${f}`], { encoding: "utf8" });
    if (before !== readFileSync(`${DIR}/${f}`, "utf8"))
      errs.push(`${f}: migration đã có ở ${ref} bị sửa — tạo migration mới`);
  }
  for (const f of files.filter((x) => !old.includes(x)))
    errs.push(...bannedOps(f, readFileSync(`${DIR}/${f}`, "utf8")));
  if (errs.length > 0) {
    console.error(`check-migrations — ${errs.length} vi phạm:\n  ${errs.join("\n  ")}`);
    process.exit(1);
  }
  console.log(
    `check-migrations: OK (${files.length} tệp, ${files.length - old.length} mới so với ${ref ?? "—"})`,
  );
}
