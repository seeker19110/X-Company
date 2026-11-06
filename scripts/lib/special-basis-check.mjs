// CMP-INTL-002: dữ liệu cá nhân nhạy cảm (`class: nhay_cam` trong docs/privacy/data-map.yaml) cần cơ sở xử lý loại đặc
// biệt RIÊNG (`special_basis` — GDPR Art. 9(2); Luật 91/2025/QH15 và NĐ 356/2025 về dữ liệu nhạy cảm), không chỉ
// `legal_basis` chung. Thiếu = lỗi; còn ghi "chờ pháp chế" = cảnh báo (việc người). Gọi từ check:docs.

const PENDING = /chờ pháp chế/i;

/**
 * @param {{pii?: Array<Record<string,string>>}} map data map đã đọc
 * @returns {{errors: string[], warnings: string[]}}
 */
export function checkSpecialBasis(map) {
  const errors = [];
  const warnings = [];
  for (const e of map.pii ?? []) {
    const k = `${e.table}.${e.column}`;
    const sb = String(e.special_basis ?? "").trim();
    if (e.class === "nhay_cam") {
      if (!sb)
        errors.push(
          `data-map ${k}: class nhay_cam thiếu special_basis (cơ sở xử lý dữ liệu nhạy cảm) — CMP-INTL-002`,
        );
      else if (PENDING.test(sb)) warnings.push(`data-map ${k}: special_basis chờ pháp chế xác nhận`);
    } else if (sb)
      errors.push(`data-map ${k}: special_basis chỉ dùng cho class nhay_cam (class hiện là ${e.class})`);
  }
  return { errors, warnings };
}
