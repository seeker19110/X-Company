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
  // Xét MỌI bên xử lý (review #99): bên ngoài VN giữ dữ liệu cá nhân dù không nằm trong storage của data map (vd mã nguồn
  // có email người đóng góp, ACME_EMAIL) vẫn là chuyển ra ngoài — cần transfer_assessment, hoặc `mien_tru: "<căn cứ>"`,
  // hoặc khai `du_lieu_ca_nhan: khong`. Bên lưu cột PII của data map thì KHÔNG được khai `du_lieu_ca_nhan: khong`.
  const abroad = [];
  for (const v of vendors) {
    const id = v.id;
    const n = used.get(id) ?? 0;
    const c = String(v.country ?? "");
    if (!COUNTRY_RE.test(c)) {
      errors.push(`vendors ${id}: country phải là mã ISO 3166-1 alpha-2 (VN, US…) hoặc chua_chon`);
      continue;
    }
    const noPii = v.du_lieu_ca_nhan === "khong";
    if (noPii && n > 0)
      errors.push(`vendors ${id}: khai du_lieu_ca_nhan: khong mà data map lưu ${n} cột PII ở đây`);
    if (c === "chua_chon") {
      if (n > 0)
        warnings.push(
          `${id} lưu ${n} cột PII nhưng chưa chọn quốc gia/nhà cung cấp — chọn trước khi xử lý dữ liệu thật`,
        );
      continue;
    }
    if (c === "VN" || noPii) continue;
    abroad.push(`${id} (${c}${n > 0 ? `, ${n} cột PII` : ""})`);
    const ta = String(v.transfer_assessment ?? "");
    const mt = String(v.mien_tru ?? "").trim();
    if (ta) {
      if (!exists(ta)) errors.push(`vendors ${id}: transfer_assessment \`${ta}\` không tồn tại`);
    } else if (mt) {
      if (n > 0)
        errors.push(
          `vendors ${id}: lưu ${n} cột PII của data map ở ${c} — cần transfer_assessment, không miễn trừ`,
        );
      else if (/chờ pháp chế/i.test(mt))
        warnings.push(`vendors ${id}: miễn trừ chuyển dữ liệu (${c}) chờ pháp chế xác nhận`);
    } else
      errors.push(
        `vendors ${id}: xử lý dữ liệu cá nhân ở ${c} (ngoài VN) mà thiếu transfer_assessment/mien_tru (hoặc du_lieu_ca_nhan: khong) — CMP-VN-004`,
      );
  }
  return { errors, warnings, abroad };
}
