// Bước sau `next build` (npm run build, T-122, PRF-WEB-008): lưu source map RIÊNG TƯ theo release, ngoài public/ và ngoài thư mục
// phục vụ (.next/static), rồi kiểm lại không còn map/`sourceMappingURL` công khai — còn thì exit 1 (build đỏ, không phát hành).
//   node scripts/sourcemaps-stash.mjs [--release <mã>] [--dir <thư mục>]
// Mặc định: release = APP_VERSION (cùng giá trị server gắn vào lỗi; không đặt → "dev"), dir = .data/sourcemaps (đã .gitignore).
// Đặt APP_VERSION GIỐNG NHAU lúc build và lúc chạy để lỗi trỏ đúng bộ map. Giải stack: scripts/sourcemap-resolve.mjs.
import path from "node:path";
import { DEFAULT_DIR, publicMapProblems, safeRelease, stashSourceMaps } from "./lib/sourcemaps.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const release = safeRelease(arg("--release") ?? process.env.APP_VERSION);
const dir = path.resolve(ROOT, arg("--dir") ?? DEFAULT_DIR);
const nextDir = path.join(ROOT, ".next");
const publicDir = path.join(ROOT, "public");
if (dir === publicDir || dir.startsWith(publicDir + path.sep)) {
  console.error("sourcemaps-stash: thư mục riêng tư không được nằm trong public/");
  process.exit(1);
}
const r = stashSourceMaps({ nextDir, dir, release });
const problems = publicMapProblems({ nextDir, publicDir });
if (problems.length > 0) {
  console.error(`sourcemaps-stash: source map còn công khai (${problems.length}):`);
  for (const p of problems.slice(0, 20)) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  `sourcemaps-stash: release ${release} → ${path.relative(ROOT, r.dir)} (${r.moved} map client đã chuyển, ${r.stripped} tệp bỏ sourceMappingURL, ${r.copied} map server đã sao)`,
);
