// Giải stack của kho lỗi tự host bằng source map RIÊNG TƯ (T-122, PRF-WEB-008). Chạy trên máy chủ giữ .data/sourcemaps (không
// cần mạng, không phụ thuộc ngoài).
//   node scripts/sourcemap-resolve.mjs --release <mã> [--dir <thư mục>] [--stack "<các dòng khung>"]
// Không có --stack thì đọc stdin: dán cột `stack` của GET /api/app/errors (hoặc SELECT stack FROM error_group WHERE id = …).
import { readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_DIR, RELEASE_RE, resolveStack } from "./lib/sourcemaps.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const release = arg("--release");
if (release === undefined || !RELEASE_RE.test(release)) {
  console.error(
    'dùng: node scripts/sourcemap-resolve.mjs --release <mã> [--dir <thư mục>] [--stack "…"] (hoặc stdin)',
  );
  process.exit(2);
}
const dir = path.resolve(ROOT, arg("--dir") ?? DEFAULT_DIR);
const stack = arg("--stack") ?? readFileSync(0, "utf8");
try {
  for (const line of resolveStack({ stack, release, dir })) console.log(line);
} catch (e) {
  console.error(`sourcemap-resolve: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
