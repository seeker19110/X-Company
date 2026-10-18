// check:encoding (BASE-DATA-001): mọi tệp văn bản được git theo dõi là UTF-8 hợp lệ, không BOM, không byte NUL
// (UTF-16 không BOM lộ ra bằng NUL). Bỏ tệp nhị phân theo đuôi. `.editorconfig` đặt `charset = utf-8` cho trình soạn thảo.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const BINARY_EXT = new Set(
  "png jpg jpeg gif webp avif bmp ico icns tif tiff woff woff2 ttf otf eot pdf zip gz tgz bz2 xz br 7z wasm docx xlsx pptx odt ods mp3 mp4 m4a webm mov ogg wav sqlite db so dylib node bin jar".split(
    " ",
  ),
);
const decoder = new TextDecoder("utf-8", { fatal: true });

export const isBinaryName = (name) => BINARY_EXT.has(path.extname(name).slice(1).toLowerCase());

/** Lỗi của một tệp (chuỗi mô tả) hoặc null nếu hợp lệ. `buf` là Buffer/Uint8Array. */
export function checkBuffer(name, buf) {
  if (isBinaryName(name)) return null;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf)
    return `${name}: có BOM UTF-8`;
  if (buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff)))
    return `${name}: UTF-16 (có BOM) — phải là UTF-8`;
  if (buf.includes(0)) return `${name}: chứa byte NUL (UTF-16 không BOM hoặc nhị phân chưa khai đuôi)`;
  try {
    decoder.decode(buf);
  } catch {
    return `${name}: không phải UTF-8 hợp lệ (vd Latin-1/Windows-1258)`;
  }
  return null;
}

/** Kiểm danh sách tệp (đường dẫn tương đối `rootDir`); `read(name)` trả Buffer (mặc định đọc đĩa). Trả mảng lỗi. */
export function check(files, rootDir = root, read = (f) => readFileSync(path.join(rootDir, f))) {
  const errors = [];
  for (const f of files) {
    let buf;
    try {
      if (!statSync(path.join(rootDir, f)).isFile()) continue;
      buf = read(f);
    } catch (e) {
      if (e?.code === "ENOENT") continue; // đã xoá khỏi cây làm việc nhưng còn trong chỉ mục: không có gì để kiểm
      throw e;
    }
    const msg = checkBuffer(f, buf);
    if (msg) errors.push(msg);
  }
  return errors;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 1 << 26 })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const errors = check(files);
  if (errors.length > 0) {
    console.error(`check:encoding — ${errors.length} tệp không phải UTF-8 sạch:\n  ${errors.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`check:encoding: OK (${files.length} tệp theo dõi)`);
}
