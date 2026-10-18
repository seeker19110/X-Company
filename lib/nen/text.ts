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

/** Khoá so sánh duy nhất (email, mã…): NFC + bỏ khoảng trắng hai đầu + chữ thường (BASE-DATA-002, XC-UNITS-012). */
export function comparisonKey(s: string): string {
  return s.normalize("NFC").trim().toLowerCase();
}

/**
 * Khoá TÌM KIẾM không phân biệt dấu/hoa thường (XC-I18N-005): "Việt" ↔ "viet". Chủ ý: chỉ dùng để so khớp tìm kiếm, không
 * dùng làm khoá duy nhất ("Việt" và "Viet" là hai giá trị khác nhau). Hiện sản phẩm chưa có tính năng tìm theo tên;
 * khi thêm, tính cột chuẩn hoá bằng hàm này (hoặc unaccent + lower ở DB) cả hai phía.
 */
export function searchKey(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").trim();
}
