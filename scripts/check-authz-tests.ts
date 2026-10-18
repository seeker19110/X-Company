// QA-INT-006, STD-SEC-004: đối chiếu mọi route app/api/app/**/route.ts (mọi method export) với danh sách phân loại
// tests/http/authz-coverage.ts, rồi với tên test gắn tag `api1-bola` (BOLA) / `api5-bfla` (BFLA) trong tests/.
//   - route/method chưa khai → lỗi; khai mà không còn route → lỗi;
//   - bola: true  → phải có test tag api1-bola có tên chứa "METHOD /api/app/<mẫu>";
//   - bfla: true  → phải có test tag api5-bfla tương tự.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { AUTHZ_COVERAGE, type AuthzClass } from "../tests/http/authz-coverage.ts";
import { listRouteFiles, urlOf } from "./check-routes.ts";

const root = path.resolve(import.meta.dirname, "..");
export const HTTP_METHODS = ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"] as const;
export const TAG_BOLA = "api1-bola";
export const TAG_BFLA = "api5-bfla";

export interface AppRoute {
  file: string;
  url: string;
  method: string;
}

/** Mọi cặp (route, method) dưới app/api/app: method lấy từ `export const|function|async function GET…`. */
export function discoverAppRoutes(rootDir: string): AppRoute[] {
  const out: AppRoute[] = [];
  for (const file of listRouteFiles(rootDir)) {
    if (!file.startsWith("app/api/app/") || !/\/route\.tsx?$/.test(file)) continue;
    const src = readFileSync(path.join(rootDir, file), "utf8");
    for (const m of HTTP_METHODS) {
      if (new RegExp(`export\\s+(?:const|let|async\\s+function|function)\\s+${m}\\b`).test(src))
        out.push({ file, url: urlOf(file), method: m });
    }
  }
  return out.sort((a, b) => (a.url + a.method).localeCompare(b.url + b.method));
}

function walkTests(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walkTests(p, out);
    else if (/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const TITLE_RE = /\b(?:test|it)\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
const PAIR_RE = /\b(GET|HEAD|OPTIONS|POST|PUT|PATCH|DELETE) (\/api\/app\/[^\s,;:)]*)/g;

/** Cặp "METHOD /url" được phủ bởi test có tag trong tên (tên tĩnh, không nội suy). */
export function taggedPairs(rootDir: string): { bola: Set<string>; bfla: Set<string> } {
  const bola = new Set<string>();
  const bfla = new Set<string>();
  for (const f of walkTests(path.join(rootDir, "tests"))) {
    const src = readFileSync(f, "utf8");
    for (const t of src.matchAll(TITLE_RE)) {
      const title = t[2] ?? "";
      if (title.includes("${")) continue;
      const set = title.includes(TAG_BOLA) ? bola : title.includes(TAG_BFLA) ? bfla : null;
      const set2 = title.includes(TAG_BOLA) && title.includes(TAG_BFLA) ? bfla : null;
      for (const p of title.matchAll(PAIR_RE)) {
        const key = `${p[1]} ${p[2]}`;
        set?.add(key);
        set2?.add(key);
      }
    }
  }
  return { bola, bfla };
}

export function check(
  rootDir: string,
  coverage: Readonly<Record<string, AuthzClass>> = AUTHZ_COVERAGE,
): string[] {
  const errors: string[] = [];
  const routes = discoverAppRoutes(rootDir);
  const keys = new Set(routes.map((r) => `${r.method} ${r.url}`));
  const tags = taggedPairs(rootDir);
  for (const k of keys)
    if (!(k in coverage)) errors.push(`route chưa phân loại trong tests/http/authz-coverage.ts: ${k}`);
  for (const [k, c] of Object.entries(coverage)) {
    if (!keys.has(k)) {
      errors.push(`authz-coverage.ts khai route không tồn tại: ${k}`);
      continue;
    }
    if (c.public !== undefined) {
      if (c.public.trim() === "") errors.push(`${k}: public thiếu lý do`);
      continue;
    }
    if (c.bola !== true && c.bfla !== true)
      errors.push(`${k}: phải là bola, bfla hoặc public (route có phiên mà không thuộc loại nào?)`);
    if (c.bola === true && !tags.bola.has(k))
      errors.push(`${k}: thiếu test tag ${TAG_BOLA} (tên test chứa "${k}")`);
    if (c.bfla === true && !tags.bfla.has(k))
      errors.push(`${k}: thiếu test tag ${TAG_BFLA} (tên test chứa "${k}")`);
  }
  return errors;
}

if (process.argv[1] === import.meta.filename) {
  const errors = check(root);
  if (errors.length > 0) {
    console.error(errors.map((e) => `check-authz-tests: ${e}`).join("\n"));
    process.exit(1);
  }
  console.log(`check-authz-tests: OK (${discoverAppRoutes(root).length} cặp route/method có test authz)`);
}
