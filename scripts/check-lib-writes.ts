// AUD-SEC-005 (D-067): `lib/org`, `lib/cms` không tự kiểm `can()` — quyền kiểm ở lớp gọi. Script này giữ lời hứa đó bằng
// máy: mọi tệp trong lib/ (ngoài miền đó), app/, proxy.ts, instrumentation.ts import hàm GHI của các miền trên phải gọi
// `authorize(` / `can(` / `requireOn(` trong cùng tệp, hoặc nằm trong EXEMPT kèm lý do. Hàm ghi = mọi export giá trị
// KHÔNG có trong READ_EXPORTS → export mới mặc định là ghi (fail-closed). scripts/ (seed, CLI) không qua HTTP nên không quét.
// (`lib/authz/grants` tự kiểm `access.manage` từ T-067 nên không cần ở đây.)
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { libTarget } from "./check-domains.ts";

const root = path.resolve(import.meta.dirname, "..");

/** Miền có hàm ghi không tự kiểm quyền → tệp công khai → export chỉ đọc (gọi không cần kiểm quyền). */
export const GUARDED: Record<string, { file: string; read: readonly string[] }> = {
  org: { file: "index", read: ["mapPgError", "departmentSubtree", "employmentAt"] },
  cms: {
    file: "index",
    read: ["PAGE_TYPES", "pathFor", "getPublished", "listPublished", "findRedirect"],
  },
};

/** Tệp được gọi hàm ghi mà không kiểm quyền — luôn kèm lý do. Mục không còn import hàm ghi → lỗi (danh sách tự co). */
export const EXEMPT: Record<string, string> = {
  "lib/identity/bootstrap.ts":
    "khởi tạo công ty + sysadmin đầu tiên từ CLI (npm run bootstrap), chưa có actor",
};

const AUTHZ_CALL_RE = /\b(?:authorize|can|requireOn)\(/;

/** Tên export giá trị (function/const/let/class) của một tệp nguồn; bỏ type/interface. */
export function valueExports(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(
    /^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm,
  ))
    out.add(m[1]!);
  return [...out];
}

/** Tên được import từ một câu import; `*` khi import namespace/động/`export *` (coi như lấy mọi export). */
export function importedNames(clause: string): string[] {
  const braces = /\{([^}]*)\}/.exec(clause);
  if (!braces) return /^\s*type\s/.test(clause) ? [] : ["*"];
  const names: string[] = [];
  if (/^\s*type\s/.test(clause)) return names;
  for (const part of braces[1]!.split(",")) {
    const p = part.trim();
    if (p === "" || p.startsWith("type ")) continue;
    names.push(p.split(/\s+as\s+/)[0]!.trim());
  }
  return names;
}

const IMPORT_STMT_RE =
  /(?:import|export)\s+([^;'"]*?)\s*from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

/** Hàm ghi mà `file` (đường dẫn tuyệt đối) import từ các miền GUARDED. */
export function writesImported(rootDir: string, file: string, src: string, writes: Map<string, Set<string>>) {
  const used: string[] = [];
  for (const m of src.matchAll(IMPORT_STMT_RE)) {
    const spec = m[2] ?? m[3] ?? "";
    const target = libTarget(file, spec, rootDir);
    if (!target) continue;
    const g = GUARDED[target.domain];
    const w = writes.get(target.domain);
    if (!g || !w || target.file !== g.file) continue;
    const names = m[3] !== undefined ? ["*"] : importedNames(m[1] ?? "");
    for (const n of names) {
      if (n === "*") used.push(...[...w].map((x) => `${target.domain}.${x}`));
      else if (w.has(n)) used.push(`${target.domain}.${n}`);
    }
  }
  return used;
}

export function check(rootDir: string, exempt: Record<string, string> = EXEMPT): string[] {
  const errors: string[] = [];
  const writes = new Map<string, Set<string>>();
  for (const [domain, g] of Object.entries(GUARDED)) {
    const f = path.join(rootDir, "lib", domain, `${g.file}.ts`);
    if (!existsSync(f)) {
      errors.push(`không thấy lib/${domain}/${g.file}.ts`);
      continue;
    }
    const exported = valueExports(readFileSync(f, "utf8"));
    for (const r of g.read)
      if (!exported.includes(r)) errors.push(`READ_EXPORTS của ${domain} khai "${r}" không còn export`);
    writes.set(domain, new Set(exported.filter((n) => !g.read.includes(n))));
  }
  const files = [
    ...walk(path.join(rootDir, "lib")),
    ...walk(path.join(rootDir, "app")),
    ...["proxy.ts", "instrumentation.ts"].map((n) => path.join(rootDir, n)).filter((f) => existsSync(f)),
  ];
  const seenExempt = new Set<string>();
  for (const file of files) {
    const rel = path.relative(rootDir, file).split(path.sep).join("/");
    if (Object.keys(GUARDED).some((d) => rel.startsWith(`lib/${d}/`))) continue;
    const src = readFileSync(file, "utf8");
    const used = writesImported(rootDir, file, src, writes);
    if (used.length === 0) continue;
    if (rel in exempt) {
      seenExempt.add(rel);
      continue;
    }
    if (!AUTHZ_CALL_RE.test(src))
      errors.push(
        `${rel}: gọi hàm ghi ${[...new Set(used)].join(", ")} mà không authorize()/can()/requireOn() trong tệp (AUD-SEC-005)`,
      );
  }
  for (const [rel, why] of Object.entries(exempt)) {
    if (why.trim() === "") errors.push(`EXEMPT ${rel}: thiếu lý do`);
    if (!seenExempt.has(rel)) errors.push(`EXEMPT ${rel}: không còn import hàm ghi — xoá khỏi danh sách`);
  }
  return errors;
}

if (process.argv[1] === import.meta.filename) {
  const errors = check(root);
  if (errors.length > 0) {
    console.error(errors.map((e) => `check-lib-writes: ${e}`).join("\n"));
    process.exit(1);
  }
  console.log(`check-lib-writes: OK (${Object.keys(GUARDED).join(", ")}: hàm ghi chỉ gọi sau kiểm quyền)`);
}
