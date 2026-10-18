// npm run check:env — hàng rào cấu hình (BASE-CFG-002, BASE-CFG-008, PRF-WEB-003, FE-BUILD-005):
//  1) KHÔNG đọc `process.env` ngoài lib/nen/env.ts trong lib/, app/, proxy.ts, instrumentation.ts, next.config.ts
//     (scripts/ và tests/ được phép). Ngoại lệ duy nhất: `process.env.NEXT_RUNTIME` ở instrumentation.ts (hằng của Next).
//  2) Tên biến NEXT_PUBLIC_* không chứa SECRET|KEY|TOKEN|PASSWORD ở bất kỳ đâu trong mã/CI.
// Exit 1 + liệt kê vi phạm. Logic thuần ở các hàm xuất để test.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface SourceFile {
  path: string;
  text: string;
}

/** Chỗ ĐƯỢC đọc process.env (đường dẫn tương đối, dấu /). */
export const ENV_MODULE = "lib/nen/env.ts";
const ENV_SCAN_DIRS = ["lib", "app"];
const ENV_SCAN_FILES = ["proxy.ts", "instrumentation.ts", "next.config.ts"];
const SOURCE_EXT = /\.(ts|tsx|mts|mjs|js|jsx)$/;
const PUBLIC_NAME = /NEXT_PUBLIC_[A-Z0-9_]*/g;
const SECRET_HINT = /SECRET|KEY|TOKEN|PASSWORD/;

const inEnvScope = (p: string) =>
  p !== ENV_MODULE &&
  SOURCE_EXT.test(p) &&
  (ENV_SCAN_FILES.includes(p) || ENV_SCAN_DIRS.some((d) => p.startsWith(`${d}/`)));

/** Bỏ comment để chuỗi/ghi chú nhắc `process.env` không bị tính; giữ nguyên số dòng. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

export function findEnvViolations(files: SourceFile[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (inEnvScope(f.path)) {
      stripComments(f.text)
        .split("\n")
        .forEach((line, i) => {
          if (!/\bprocess\s*\.\s*env\b|\bimport\.meta\.env\b|\bprocess\s*\[\s*["']env["']\s*\]/.test(line))
            return;
          const onlyRuntime =
            f.path === "instrumentation.ts" &&
            [...line.matchAll(/process\.env\b[^\s;)]*/g)].every((m) => m[0] === "process.env.NEXT_RUNTIME");
          if (!onlyRuntime)
            out.push(`${f.path}:${i + 1}: đọc process.env ngoài ${ENV_MODULE} — dùng env() từ module env`);
        });
    }
    for (const name of new Set(f.text.match(PUBLIC_NAME) ?? [])) {
      if (SECRET_HINT.test(name.slice("NEXT_PUBLIC_".length)))
        out.push(`${f.path}: tên ${name} công khai nhưng chứa SECRET|KEY|TOKEN|PASSWORD`);
    }
  }
  return out;
}

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".xtemplates", "coverage", ".claude", ".data"]);

export function collectFiles(root: string, dirs: string[]): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const p = rel !== "" ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(p);
      } else if (SOURCE_EXT.test(e.name) || /\.(ya?ml|json)$/.test(e.name)) {
        out.push({ path: p, text: readFileSync(path.join(root, p), "utf8") });
      }
    }
  };
  for (const d of dirs) walk(d);
  return out;
}

function main(): void {
  const root = process.cwd();
  const top = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isFile() && (SOURCE_EXT.test(e.name) || /\.(ya?ml|json)$/.test(e.name)))
    .map((e) => ({ path: e.name, text: readFileSync(path.join(root, e.name), "utf8") }));
  const dirs = ["lib", "app", "scripts", "e2e", ".github"].filter((d) => readdirSync(root).includes(d));
  // Tệp kiểm này nhắc tên mẫu trong chú thích/biểu thức — không tự quét chính nó.
  const files = [...top, ...collectFiles(root, dirs)].filter((f) => f.path !== "scripts/check-env.ts");
  const violations = findEnvViolations(files);
  if (violations.length > 0) {
    console.error(`check:env — ${violations.length} vi phạm:\n${violations.map((v) => `  ${v}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`check:env — đạt (${files.length} tệp quét)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
