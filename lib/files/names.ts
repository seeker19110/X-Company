// Tên tệp người dùng: allowlist đuôi, đuôi phải khớp loại dò theo nội dung, từ chối đuôi kép, lọc ký tự nguy hiểm
// (BE-FILE-001, BE-FILE-003, OWASP File Upload). Tên gốc chỉ là metadata hiển thị — khoá lưu do server sinh (storage.ts).
import { AppError } from "../nen/app-error.ts";
import type { Sniffed } from "./sniff.ts";
import { t } from "../i18n/index.ts";

/** Đuôi được nhận (chữ thường, không dấu chấm) → đuôi chuẩn của loại dò theo nội dung. */
export const ALLOWED_EXTENSIONS: Readonly<Record<string, string>> = {
  pdf: "pdf",
  png: "png",
  jpg: "jpg",
  jpeg: "jpg",
  webp: "webp",
  docx: "docx",
  xlsx: "xlsx",
};

// Đuôi thực thi/kịch bản/trang: không được xuất hiện ở bất kỳ đoạn nào của tên (`a.php.jpg`, `a.jpg.exe`).
const DANGEROUS = new Set(
  "php phtml php3 php4 php5 phar exe dll msi com scr bat cmd ps1 vbs js mjs cjs sh bash py pl rb cgi jar jsp jspx asp aspx html htm xhtml svg swf hta lnk".split(
    " ",
  ),
);

const MAX_NAME = 200;
// Ký tự điều khiển C0/DEL, dấu phân cách đường dẫn, dấu nháy kép, và ký tự đảo chiều văn bản (RLO: "fdp.exe" hiển thị ngược).
const UNSAFE_CHARS = /[\x00-\x1f\x7f/\\"\u{202a}-\u{202e}\u{2066}-\u{2069}]/gu;

/** Tên gốc đã lọc để lưu metadata/hiển thị (không dùng làm đường dẫn). */
export function sanitizeFileName(raw: string): string {
  return raw.replace(UNSAFE_CHARS, "_").trim();
}

/**
 * Kiểm tên + loại dò: trả tên lưu (đã lọc, ≤ 200 ký tự, giữ đuôi). Tên rỗng → `tep.<đuôi chuẩn>`.
 * Ném 415 khi đuôi ngoài allowlist, đuôi kép, hoặc đuôi không khớp nội dung.
 */
export function checkedFileName(raw: string, kind: Sniffed): string {
  const cleaned = sanitizeFileName(raw);
  if (cleaned === "") return `tep.${kind.ext}`;
  const parts = cleaned.toLowerCase().split(".");
  const ext = parts.length > 1 ? (parts[parts.length - 1] ?? "") : "";
  const canonical = ALLOWED_EXTENSIONS[ext];
  if (canonical === undefined)
    throw new AppError("UNSUPPORTED_TYPE", 415, t("err.files.duoiTepKhongDuocChapNhan"));
  const inner = parts.slice(1, -1);
  if (inner.some((p) => DANGEROUS.has(p) || p in ALLOWED_EXTENSIONS))
    throw new AppError("UNSUPPORTED_TYPE", 415, t("err.files.tenTepCoDuoiKepKhong"));
  if (canonical !== kind.ext)
    throw new AppError("UNSUPPORTED_TYPE", 415, t("err.files.duoiTepKhongKhopNoiDung"));
  if (cleaned.length <= MAX_NAME) return cleaned;
  const suffix = cleaned.slice(cleaned.length - ext.length - 1);
  return cleaned.slice(0, MAX_NAME - suffix.length) + suffix;
}
