// CMP-VN-004 (Luật 91/2025/QH15 Đ.20, NĐ 356/2025): dữ liệu cá nhân trong data map được lưu ở bên xử lý nào
// (`storage_default`/`storage` → id trong docs/compliance/vendors.yaml), bên đó ở quốc gia nào (`country`); bên xử lý
// ngoài Việt Nam phải trỏ `transfer_assessment` tới hồ sơ đánh giá tác động chuyển dữ liệu có thật trong repo.
// `country: chua_chon` (chưa chọn nhà cung cấp) = cảnh báo, không đỏ — việc người (chọn hạ tầng).

export const COUNTRY_RE = /^([A-Z]{2}|chua_chon)$/;

const ids = (s) =>
  String(s ?? "")
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * @param {{pii?: Array<Record<string,string>>, storage_default?: string}} map data map đã đọc (parseMap của check-docs)
 * @param {Array<Record<string, unknown>>} vendors sổ nhà cung cấp đã đọc (parseVendors của check-vendors)
 * @param {(p: string) => boolean} exists tệp có trong repo không
 * @returns {{errors: string[], warnings: string[], abroad: string[]}}
 */
export function checkTransfers(map, vendors, exists) {
  const errors = [];
  const warnings = [];
  const byId = new Map(vendors.map((v) => [v.id, v]));
  const used = new Map(); // vendor id → số cột PII
  const fallback = ids(map.storage_default);
  for (const e of map.pii ?? []) {
    const k = `${e.table}.${e.column}`;
    const st = e.storage !== undefined ? ids(e.storage) : fallback;
    if (st.length === 0) errors.push(`data-map ${k}: không có storage (thiếu storage_default) — CMP-VN-004`);
    for (const id of st) {
      if (!byId.has(id))
        errors.push(`data-map ${k}: storage \`${id}\` không có trong docs/compliance/vendors.yaml`);
      else used.set(id, (used.get(id) ?? 0) + 1);
    }
  }
  const abroad = [];
  for (const [id, n] of used) {
    const v = byId.get(id);
    const c = String(v.country ?? "");
    if (!COUNTRY_RE.test(c)) {
      errors.push(`vendors ${id}: country phải là mã ISO 3166-1 alpha-2 (VN, US…) hoặc chua_chon`);
      continue;
    }
    if (c === "chua_chon") {
      warnings.push(
        `${id} lưu ${n} cột PII nhưng chưa chọn quốc gia/nhà cung cấp — chọn trước khi xử lý dữ liệu thật`,
      );
      continue;
    }
    if (c === "VN") continue;
    abroad.push(`${id} (${c}, ${n} cột PII)`);
    const ta = String(v.transfer_assessment ?? "");
    if (!ta)
      errors.push(
        `vendors ${id}: lưu dữ liệu cá nhân ở ${c} (ngoài VN) mà thiếu transfer_assessment — CMP-VN-004`,
      );
    else if (!exists(ta)) errors.push(`vendors ${id}: transfer_assessment \`${ta}\` không tồn tại`);
  }
  return { errors, warnings, abroad };
}
