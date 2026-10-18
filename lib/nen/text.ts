// Chuẩn hoá văn bản ở biên (BASE-DATA-002, UX-CONTENT-002, XC-I18N-005): mọi chuỗi người nhập → Unicode NFC trước khi
// validate/lưu, để "Việt" gõ kiểu tổ hợp (NFD, macOS/iOS) và dựng sẵn (NFC) là MỘT giá trị — so sánh, UNIQUE, tìm kiếm khớp.
// Thuần — dùng được ở client và module thuần.

/** Chuẩn hoá NFC đệ quy cho chuỗi trong giá trị JSON (cả khoá object); giá trị khác giữ nguyên. */
export function normalizeNfc(v: unknown): unknown {
  if (typeof v === "string") return v.normalize("NFC");
  if (Array.isArray(v)) return v.map(normalizeNfc);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k.normalize("NFC")] = normalizeNfc(x);
    return out;
  }
  return v;
}
