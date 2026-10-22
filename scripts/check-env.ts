// npm run check:env — hàng rào cấu hình (BASE-CFG-002, BASE-CFG-008, PRF-WEB-003, FE-BUILD-005):
//  1) KHÔNG đọc `process.env` ngoài lib/nen/env.ts trong lib/, app/, proxy.ts, instrumentation.ts, next.config.ts
//     (scripts/ và tests/ được phép). Ngoại lệ duy nhất: `process.env.NEXT_RUNTIME` ở instrumentation.ts (hằng của Next).
//  2) Tên biến NEXT_PUBLIC_* không chứa SECRET|KEY|TOKEN|PASSWORD ở bất kỳ đâu trong mã/CI.
//  3) Mọi khoá khai trong lib/nen/env.ts có trong `.env.example` (chỉ so TÊN khoá; không in giá trị) — AUD-CFG-001.
// Exit 1 + liệt kê vi phạm. Logic thuần ở các hàm xuất để test.
import { readFileSync, readdirSync } from "node:fs";
import { CLIENT_SPEC, SERVER_SPEC } from "../lib/nen/env.ts";
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

/** Biến do Next/Node tự đặt — người vận hành không khai trong `.env`. */
export const RUNTIME_KEYS = new Set(["NODE_ENV", "NEXT_PHASE", "NEXT_RUNTIME"]);
/**
 * Khoá đã có trong mã nhưng `.env.example` chưa có, đang CHỜ NGƯỜI thêm (hook chặn agent đọc/ghi `.env.*` — AUD-CFG-001).
 * Khoá trong đây mà `.env.example` đã có → lỗi, để danh sách tự co về rỗng.
 */
export const PENDING_EXAMPLE_KEYS = new Set([
  "RUM_ENABLED",
  "RETENTION_RUM_DAYS",
  // phát hiện khi bật kiểm này (2026-10-21): KMS (T-052), pool DB, TRUST_PROXY (AUD-SEC-001) chưa có dòng mẫu
  "DB_POOL_MAX",
  "KMS_PROVIDER",
  "KMS_TRANSIT_ADDR",
  "KMS_TRANSIT_TOKEN",
  "KMS_TRANSIT_MOUNT",
  "KMS_TRANSIT_KEY",
  "KMS_TIMEOUT_MS",
  "KMS_RETRIES",
  "KMS_DEK_TTL_S",
  "KMS_DEK_MAX_USES",
  "KMS_MAX_CALLS_PER_MIN",
  "TRUST_PROXY",
  // T-068 (AUD-DATA-003): retention toạ độ GPS — chờ người thêm dòng mẫu (D-050)
  "RETENTION_GEO_DAYS",
]);

/** Tên khoá trong tệp dạng `.env` (`KEY=…`, kể cả dòng `# KEY=…` chú thích mẫu). Không trả giá trị. */
export function exampleKeys(text: string): Set<string> {
  return new Set([...text.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/gm)].map((m) => m[1]!));
}

/** 3) Khoá khai trong module env ⊆ `.env.example` (AUD-CFG-001). Chỉ nêu TÊN khoá, không bao giờ giá trị. */
export function findExampleDrift(
  specKeys: readonly string[],
  example: Set<string>,
  pending: Set<string> = PENDING_EXAMPLE_KEYS,
): string[] {
  const out: string[] = [];
  for (const k of specKeys) {
    if (RUNTIME_KEYS.has(k)) continue;
    if (!example.has(k) && !pending.has(k)) out.push(`.env.example thiếu ${k} (khai ở ${ENV_MODULE})`);
    if (example.has(k) && pending.has(k)) out.push(`.env.example đã có ${k} — xoá khỏi PENDING_EXAMPLE_KEYS`);
  }
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
  const violations = [
    ...findEnvViolations(files),
    ...findExampleDrift(
      [...Object.keys(SERVER_SPEC), ...Object.keys(CLIENT_SPEC)],
      exampleKeys(readFileSync(path.join(root, ".env.example"), "utf8")),
    ),
  ];
  if (violations.length > 0) {
    console.error(`check:env — ${violations.length} vi phạm:\n${violations.map((v) => `  ${v}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`check:env — đạt (${files.length} tệp quét)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
