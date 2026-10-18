// FE-RENDER-001: bảng docs/ROUTES.md khớp từng route thật trong app/ (page.tsx, route.ts) — đủ, không thừa, đúng chế độ.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
export const MODES = ["tĩnh", "cache dùng chung", "động", "CSR"] as const;
const ROUTE_FILE = /^(page|route)\.(ts|tsx)$/;

/** Mọi tệp route trong cây app/ (đường dẫn tương đối gốc repo, dấu `/`). */
export function listRouteFiles(rootDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (ROUTE_FILE.test(name)) out.push(path.relative(rootDir, p).split(path.sep).join("/"));
    }
  };
  const appDir = path.join(rootDir, "app");
  if (existsSync(appDir)) walk(appDir);
  return out.sort();
}

/** `app/(public)/lien-he/page.tsx` → `/lien-he` (bỏ nhóm `(x)`, giữ `[id]`). */
export function urlOf(file: string): string {
  const segs = file
    .split("/")
    .slice(1, -1)
    .filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith("@"));
  return "/" + segs.join("/");
}

export interface RouteRow {
  url: string;
  file: string;
  mode: string;
  reason: string;
}

/** Hàng bảng: `| \`/url\` | \`app/.../page.tsx\` | chế độ | lý do |`. */
export function parseRoutes(md: string): RouteRow[] {
  const rows: RouteRow[] = [];
  for (const line of md.split("\n")) {
    const m = /^\|\s*`([^`]+)`\s*\|\s*`(app\/[^`]+)`\s*\|([^|]*)\|(.*)\|\s*$/.exec(line);
    if (m !== null) {
      rows.push({
        url: m[1] ?? "",
        file: m[2] ?? "",
        mode: (m[3] ?? "").trim(),
        reason: (m[4] ?? "").trim(),
      });
    }
  }
  return rows;
}

export function check(rootDir: string, md: string): string[] {
  const errors: string[] = [];
  const rows = parseRoutes(md);
  const real = listRouteFiles(rootDir);
  const listed = new Set(rows.map((r) => r.file));
  for (const f of real) if (!listed.has(f)) errors.push(`route chưa có trong docs/ROUTES.md: ${f}`);
  for (const r of rows) {
    if (!real.includes(r.file)) errors.push(`docs/ROUTES.md có hàng cho tệp không tồn tại: ${r.file}`);
    else if (urlOf(r.file) !== r.url)
      errors.push(`${r.file}: URL phải là ${urlOf(r.file)}, bảng ghi ${r.url}`);
    if (!(MODES as readonly string[]).includes(r.mode)) {
      errors.push(`${r.file}: chế độ "${r.mode}" không hợp lệ (${MODES.join(" | ")})`);
    }
    if (r.reason === "") errors.push(`${r.file}: thiếu lý do`);
  }
  if (new Set(rows.map((r) => r.file)).size !== rows.length) errors.push("docs/ROUTES.md có hàng trùng tệp");
  return errors;
}

if (process.argv[1] === import.meta.filename) {
  const md = readFileSync(path.join(root, "docs/ROUTES.md"), "utf8");
  const errors = check(root, md);
  if (errors.length > 0) {
    console.error(errors.map((e) => `check-routes: ${e}`).join("\n"));
    process.exit(1);
  }
  console.log(`check-routes: OK (${parseRoutes(md).length} route khớp cây app/)`);
}
