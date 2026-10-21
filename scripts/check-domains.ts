// ARC-MOD-005/008: lib/* ⊆ miền đã khai và miền đã khai ⇒ có thư mục lib/<miền>; import chéo miền chỉ vào tệp công khai
// (docs/architecture/domains.md). Quét lib/, app/, scripts/, adapters/, instrumentation.ts, proxy.ts.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

/** Đọc bảng: `| \`miền\` | \`a.ts\`, \`b.ts\` | … |` → Map(miền → Set(tệp công khai không đuôi)). */
export function parseDomains(md: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const line of md.split("\n")) {
    const m = /^\|\s*`([a-z][a-z0-9-]*)`\s*\|([^|]*)\|/.exec(line);
    if (!m) continue;
    const files = [...(m[2] ?? "").matchAll(/`([^`]+)`/g)].map((x) =>
      (x[1] ?? "").replace(/\.(ts|tsx)$/, ""),
    );
    map.set(m[1] ?? "", new Set(files.length > 0 ? files : ["index"]));
  }
  return map;
}

const IMPORT_RE =
  /(?:import|export)\s[^;'"]*?\sfrom\s*["']([^"']+)["']|import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

export function importsOf(src: string): string[] {
  return [...src.matchAll(IMPORT_RE)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
}

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

/** `lib/<miền>/<phần còn lại không đuôi>` mà import trỏ tới, hoặc null nếu không vào lib/. */
export function libTarget(
  fromFile: string,
  spec: string,
  rootDir: string = root,
): { domain: string; file: string } | null {
  let abs: string;
  if (spec.startsWith("@/")) abs = path.join(rootDir, spec.slice(2));
  else if (spec.startsWith(".")) abs = path.resolve(path.dirname(fromFile), spec);
  else return null;
  const rel = path.relative(path.join(rootDir, "lib"), abs).split(path.sep);
  const [domain, ...rest] = rel;
  if (domain === undefined || domain === ".." || domain === "") return null;
  const stem = rest.join("/").replace(/\.(ts|tsx)$/, "");
  const file = stem === "" ? "index" : stem;
  return { domain, file };
}

export function check(rootDir: string, md: string): string[] {
  const domains = parseDomains(md);
  const errors: string[] = [];
  const libDir = path.join(rootDir, "lib");
  for (const name of existsSync(libDir) ? readdirSync(libDir) : []) {
    if (statSync(path.join(libDir, name)).isDirectory() && !domains.has(name)) {
      errors.push(`lib/${name} chưa khai trong docs/architecture/domains.md`);
    }
  }
  // Chiều ngược: miền khai mà không có thư mục = bảng khai sai/lỗi thời (chỉ kiểm khi có lib/).
  if (existsSync(libDir)) {
    for (const name of domains.keys()) {
      const d = path.join(libDir, name);
      if (!existsSync(d) || !statSync(d).isDirectory()) {
        errors.push(
          `miền "${name}" khai trong docs/architecture/domains.md nhưng không có thư mục lib/${name}`,
        );
      }
    }
  }
  const rootFiles = ["instrumentation.ts", "proxy.ts"]
    .map((n) => path.join(rootDir, n))
    .filter((f) => existsSync(f));
  const sources = [
    ...["lib", "app", "scripts", "adapters"].flatMap((d) => walk(path.join(rootDir, d))),
    ...rootFiles,
  ];
  {
    for (const f of sources) {
      const rel = path.relative(rootDir, f).split(path.sep).join("/");
      const own = rel.startsWith("lib/") ? (rel.split("/")[1] ?? null) : null;
      for (const spec of importsOf(readFileSync(f, "utf8"))) {
        const t = libTarget(f, spec, rootDir);
        if (t === null || t.domain === own) continue;
        const pub = domains.get(t.domain);
        if (pub === undefined) errors.push(`${rel}: import "${spec}" vào miền chưa khai "${t.domain}"`);
        else if (!pub.has(t.file)) {
          errors.push(
            `${rel}: import "${spec}" là tệp nội bộ của miền ${t.domain} (công khai: ${[...pub].join(", ")})`,
          );
        }
      }
    }
  }
  return errors;
}

if (process.argv[1] === import.meta.filename) {
  const md = readFileSync(path.join(root, "docs/architecture/domains.md"), "utf8");
  const errors = check(root, md);
  if (errors.length > 0) {
    console.error(errors.map((e) => `check-domains: ${e}`).join("\n"));
    process.exit(1);
  }
  console.log(`check-domains: OK (${parseDomains(md).size} miền đã khai)`);
}
