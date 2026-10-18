// ARC-ADR-004: ADR đã "Chấp nhận" ở nhánh gốc không bị sửa nội dung — chỉ được đổi dòng Trạng thái và liên kết thay thế.
// Base: origin/$GITHUB_BASE_REF, rồi origin/main, rồi main; không có ref nào (clone cục bộ không remote) → bỏ qua, exit 0.
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const ACCEPTED = /^- (Trạng thái|Status):\s*(Chấp nhận|Accepted)\b/im;
/** Dòng được phép đổi: dòng Trạng thái, dòng liên kết thay thế/được thay thế. */
export const ALLOWED_LINE =
  /^\s*(?:-\s*)?(Trạng thái|Status|Thay thế bởi|Superseded by|Thay thế|Supersedes|Liên kết|Links)\b/i;

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function refExists(ref: string): boolean {
  try {
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

export function resolveBase(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [
    env.GITHUB_BASE_REF !== undefined && env.GITHUB_BASE_REF !== "" ? `origin/${env.GITHUB_BASE_REF}` : null,
    "origin/main",
    "main",
  ].filter((x): x is string => x !== null);
  for (const c of candidates) {
    if (!refExists(c)) continue;
    try {
      return git(["merge-base", c, "HEAD"]).trim();
    } catch {
      return c;
    }
  }
  return null;
}

/** Các dòng đổi (+/-) của diff -U0 vi phạm: không thuộc dòng Trạng thái/liên kết. */
export function violations(diff: string): string[] {
  const bad: string[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (!line.startsWith("+") && !line.startsWith("-")) continue;
    const body = line.slice(1);
    if (body.trim() === "") continue;
    if (!ALLOWED_LINE.test(body)) bad.push(line);
  }
  return bad;
}

export function isAccepted(content: string): boolean {
  return ACCEPTED.test(content);
}

function main(): number {
  const base = resolveBase();
  if (base === null) {
    console.log(
      "check-adr-immutable: BỎ QUA — không có origin/main hay main để so (chạy cục bộ không remote).",
    );
    return 0;
  }
  const names = git(["ls-tree", "--name-only", base, "docs/adr/"])
    .split("\n")
    .filter((n) => /^docs\/adr\/\d{4}-.*\.md$/.test(n));
  let failed = 0;
  for (const name of names) {
    if (!isAccepted(git(["show", `${base}:${name}`]))) continue;
    // So cây làm việc với base (gồm cả thay đổi chưa commit); xoá file cũng là đổi nội dung.
    const diff = git(["diff", "-U0", "--no-color", base, "--", name]);
    const bad = violations(diff);
    if (bad.length > 0) {
      failed++;
      console.error(`check-adr-immutable: ${name} đã Chấp nhận nhưng bị sửa nội dung:\n${bad.join("\n")}`);
    }
  }
  if (failed > 0) return 1;
  console.log(`check-adr-immutable: OK (so với ${base.slice(0, 12)}, ${names.length} ADR ở nhánh gốc)`);
  return 0;
}

if (process.argv[1] === import.meta.filename) process.exit(main());
