// Source map riêng tư theo release (T-122, PRF-WEB-008). Không phụ thuộc ngoài: giải bằng `SourceMap` có sẵn của Node (node:module,
// hỗ trợ cả index map có `sections` mà Turbopack sinh cho server).
//   stashSourceMaps  — sau `next build`: CHUYỂN mọi *.map của .next/static (thư mục được phục vụ công khai) sang
//                      <dir>/<release>/static/, bỏ chú thích `sourceMappingURL` ở cuối tệp JS/CSS; SAO các *.map của .next/server
//                      (không phục vụ) sang <dir>/<release>/server/. Thư mục 0700, tệp 0600; ghi manifest.json.
//   publicMapProblems — kiểm lại: không còn *.map / `sourceMappingURL` trong .next/static, không *.map trong public/.
//   resolveStack     — giải từng dòng khung đã chuẩn hoá (`fn (/_next/static/chunks/a.js:1:234)`) về nguồn gốc bằng map riêng tư.
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { SourceMap } from "node:module";
import path from "node:path";

export const DEFAULT_DIR = ".data/sourcemaps";
/** Khớp RELEASE_RE của lib/errors/normalize.pure.ts (tests/unit/sourcemaps.test.ts so hai bản). */
export const RELEASE_RE = /^[A-Za-z0-9._+-]{1,64}$/;

/** Khớp safeRelease của lib/errors/normalize.pure.ts: ký tự lạ → "-", rỗng → "dev". */
export function safeRelease(raw) {
  const s = String(raw ?? "")
    .replace(/[^A-Za-z0-9._+-]/g, "-")
    .slice(0, 64);
  return s === "" ? "dev" : s;
}

function walk(dir, pred, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, pred, out);
    else if (pred(name)) out.push(p);
  }
  return out;
}

// Chú thích source map ở CUỐI tệp (JS: `//# …`, CSS: `/*# … */`); `@` là cú pháp cũ.
const TRAILING_JS = /\n?\/\/[#@][ \t]*sourceMappingURL=[^\n]*\s*$/;
const TRAILING_CSS = /\n?\/\*[#@][ \t]*sourceMappingURL=[^*]*\*\/\s*$/;
const ANY_REF = /\/\/[#@]\s*sourceMappingURL=|\/\*[#@]\s*sourceMappingURL=/;

function moveFile(from, to) {
  mkdirSync(path.dirname(to), { recursive: true, mode: 0o700 });
  try {
    renameSync(from, to);
  } catch {
    copyFileSync(from, to); // khác ổ đĩa: sao rồi xoá
    unlinkSync(from);
  }
  chmodSync(to, 0o600);
}

function copyPrivate(from, to) {
  mkdirSync(path.dirname(to), { recursive: true, mode: 0o700 });
  copyFileSync(from, to);
  chmodSync(to, 0o600);
}

/** Thư mục riêng tư của một release; release sai định dạng → ném (không ghép đường dẫn từ chuỗi lạ). */
export function releaseDir(dir, release) {
  if (!RELEASE_RE.test(release)) throw new Error(`release không hợp lệ: ${JSON.stringify(release)}`);
  return path.resolve(dir, release);
}

/**
 * Chuyển map công khai ra thư mục riêng tư. `nextDir` = .next, `dir` = gốc kho map (ngoài public/ và .next/). Thư mục của release
 * được làm mới (bản build trùng release không trộn map cũ).
 */
export function stashSourceMaps({ nextDir, dir, release }) {
  const target = releaseDir(dir, release);
  const staticDir = path.join(nextDir, "static");
  const serverDir = path.join(nextDir, "server");
  const absNext = path.resolve(nextDir);
  if (target === absNext || target.startsWith(absNext + path.sep))
    throw new Error("thư mục source map riêng tư không được nằm trong .next/ (thư mục phục vụ)");
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true, mode: 0o700 });
  chmodSync(path.resolve(dir), 0o700);
  let moved = 0;
  for (const f of walk(staticDir, (n) => n.endsWith(".map"))) {
    moveFile(f, path.join(target, "static", path.relative(staticDir, f)));
    moved += 1;
  }
  let stripped = 0;
  for (const f of walk(staticDir, (n) => n.endsWith(".js") || n.endsWith(".css"))) {
    const src = readFileSync(f, "utf8");
    const out = src.replace(f.endsWith(".css") ? TRAILING_CSS : TRAILING_JS, "\n");
    if (out !== src) {
      writeFileSync(f, out);
      stripped += 1;
    }
  }
  let copied = 0;
  for (const f of walk(serverDir, (n) => n.endsWith(".map"))) {
    copyPrivate(f, path.join(target, "server", path.relative(serverDir, f)));
    copied += 1;
  }
  const buildIdFile = path.join(nextDir, "BUILD_ID");
  const manifest = {
    release,
    build_id: existsSync(buildIdFile) ? readFileSync(buildIdFile, "utf8").trim() : null,
    created_at: new Date().toISOString(),
    static_maps: moved,
    server_maps: copied,
  };
  writeFileSync(path.join(target, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", {
    mode: 0o600,
  });
  return { dir: target, moved, stripped, copied };
}

/** Vấn đề còn lại khiến source map lộ công khai (rỗng = đạt). */
export function publicMapProblems({ nextDir, publicDir }) {
  const errs = [];
  const staticDir = path.join(nextDir, "static");
  for (const f of walk(staticDir, (n) => n.endsWith(".map"))) errs.push(`còn ${path.relative(nextDir, f)}`);
  for (const f of walk(staticDir, (n) => n.endsWith(".js") || n.endsWith(".css")))
    if (ANY_REF.test(readFileSync(f, "utf8"))) errs.push(`${path.relative(nextDir, f)} còn sourceMappingURL`);
  for (const f of walk(publicDir, (n) => n.endsWith(".map"))) errs.push(`public/ có ${path.basename(f)}`);
  return errs;
}

// Vị trí ở cuối dòng khung: `(…/x.js:1:2)` (V8) hoặc `@…/x.js:1:2` (Gecko).
const LOCATION = /(\/(?:_next\/static|\.next\/server)\/[^\s()@]+\.js):(\d+):(\d+)\)?\s*$/;

/** `{ file: "/_next/static/chunks/a.js", line, column }` (1-based như stack) hoặc null. */
export function frameLocation(frame) {
  const m = LOCATION.exec(frame);
  if (!m) return null;
  return { file: m[1], line: Number(m[2]), column: Number(m[3]) };
}

/** Đường dẫn map riêng tư cho tệp sinh ra; ngoài thư mục release (`..`) → null. */
export function mapPathFor(base, file) {
  const rel = file.startsWith("/_next/static/")
    ? path.join("static", file.slice("/_next/static/".length))
    : file.startsWith("/.next/server/")
      ? path.join("server", file.slice("/.next/server/".length))
      : null;
  if (rel === null) return null;
  const p = path.resolve(base, `${rel}.map`);
  return p.startsWith(base + path.sep) ? p : null;
}

/**
 * Giải stack (mỗi dòng một khung đã chuẩn hoá, như cột error_group.stack) bằng map của `release` trong `dir`. Dòng không giải được
 * giữ nguyên kèm lý do. Không đọc gì ngoài thư mục của release.
 */
export function resolveStack({ stack, release, dir }) {
  const base = releaseDir(dir, release);
  if (!existsSync(base)) throw new Error(`không có source map cho release ${release} (${base})`);
  const cache = new Map();
  const load = (p) => {
    if (!cache.has(p))
      cache.set(p, existsSync(p) ? new SourceMap(JSON.parse(readFileSync(p, "utf8"))) : null);
    return cache.get(p);
  };
  return String(stack)
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((frame) => {
      const loc = frameLocation(frame);
      if (loc === null) return `${frame}    [không phải khung của bản build]`;
      const mp = mapPathFor(base, loc.file);
      const sm = mp === null ? null : load(mp);
      if (!sm) return `${frame}    [không có map]`;
      const e = sm.findEntry(loc.line - 1, loc.column - 1);
      if (!e || e.originalSource === undefined) return `${frame}    [không tìm thấy vị trí]`;
      const src = String(e.originalSource).replace(/^turbopack:\/\/\/\[project\]\//, "");
      const fn = e.name ?? (frame.split(/ \(|@/)[0] || "?");
      return `${fn} (${src}:${e.originalLine + 1}:${e.originalColumn + 1})`;
    });
}
