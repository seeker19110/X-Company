// check:docs — CMP-VN-004: dữ liệu cá nhân gắn bên xử lý lưu trữ (storage) và quốc gia; MỌI bên xử lý ngoài VN phải
// có hồ sơ chuyển dữ liệu / miễn trừ có căn cứ / khai không có dữ liệu cá nhân (review #99). CMP-INTL-002: cột nhạy cảm
// có cơ sở xử lý loại đặc biệt riêng (special_basis).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, test } from "node:test";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import * as transfer from "../../scripts/lib/transfer-check.mjs";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import * as special from "../../scripts/lib/special-basis-check.mjs";

type Row = Record<string, string>;
type Res = { errors: string[]; warnings: string[]; abroad?: string[] };
const { checkTransfers } = transfer as {
  checkTransfers: (
    map: { pii?: Row[]; storage_default?: string },
    vendors: Row[],
    exists: (p: string) => boolean,
  ) => Res;
};
const { checkSpecialBasis } = special as { checkSpecialBasis: (map: { pii?: Row[] }) => Res };

const pii = (extra: Row = {}) => ({ table: "employee", column: "phone", ...extra });
const VN = { id: "hosting", country: "VN" };
const none = () => false;

describe("check:docs — chuyển dữ liệu ra ngoài VN (CMP-VN-004)", () => {
  test("chỉ lưu trong VN → không lỗi, không cảnh báo, không chuyển ra ngoài", () => {
    assert.deepEqual(checkTransfers({ storage_default: "hosting", pii: [pii()] }, [VN], none), {
      errors: [],
      warnings: [],
      abroad: [],
    });
  });

  test("bên lưu cột PII ở ngoài VN: hồ sơ tồn tại → liệt kê, không lỗi; hồ sơ không tồn tại / chỉ miễn trừ → lỗi", () => {
    const s3 = { id: "s3", country: "SG", transfer_assessment: "docs/privacy/transfer-sg.md" };
    const map = { storage_default: "hosting", pii: [pii({ storage: "hosting, s3" })] };
    const ok = checkTransfers(map, [VN, s3], (p) => p === s3.transfer_assessment);
    assert.deepEqual(ok.errors, []);
    assert.deepEqual(ok.abroad, ["s3 (SG, 1 cột PII)"]);
    assert.match(checkTransfers(map, [VN, s3], none).errors.join(), /transfer-sg\.md` không tồn tại/);
    const exempt = { id: "s3", country: "SG", mien_tru: "lý do" };
    assert.match(
      checkTransfers(map, [VN, exempt], none).errors.join(),
      /cần transfer_assessment, không miễn trừ/,
    );
  });

  test("bên ngoài VN KHÔNG có trong data map vẫn bị xét (review #99): thiếu cả hồ sơ/miễn trừ → lỗi", () => {
    const gh = { id: "github", country: "US" };
    const r = checkTransfers({ storage_default: "hosting", pii: [pii()] }, [VN, gh], none);
    assert.match(
      r.errors.join(),
      /github: xử lý dữ liệu cá nhân ở US .* thiếu transfer_assessment\/mien_tru/,
    );
    assert.deepEqual(r.abroad, ["github (US)"]);
  });

  test("miễn trừ có căn cứ → không lỗi ('chờ pháp chế' = cảnh báo); du_lieu_ca_nhan: khong → bỏ qua", () => {
    const vendors: Row[] = [
      VN,
      { id: "gh", country: "US", mien_tru: "email người đóng góp — chờ pháp chế" },
      { id: "npm", country: "US", du_lieu_ca_nhan: "khong" },
    ];
    const r = checkTransfers({ storage_default: "hosting", pii: [pii()] }, vendors, none);
    assert.deepEqual(r.errors, []);
    assert.match(r.warnings.join(), /gh: miễn trừ .* chờ pháp chế/);
    assert.deepEqual(r.abroad, ["gh (US)"]);
  });

  test("du_lieu_ca_nhan: khong mà data map lưu PII ở đó → lỗi", () => {
    const r = checkTransfers(
      { storage_default: "npm", pii: [pii()] },
      [{ id: "npm", country: "US", du_lieu_ca_nhan: "khong" }],
      none,
    );
    assert.match(r.errors.join(), /khai du_lieu_ca_nhan: khong mà data map lưu 1 cột PII/);
  });

  test("country chưa chọn → cảnh báo khi có PII; thiếu storage / id lạ / country sai dạng ở MỌI dòng → lỗi", () => {
    const later = { id: "backup", country: "chua_chon" };
    const r = checkTransfers(
      { storage_default: "backup", pii: [pii(), pii({ column: "full_name" })] },
      [later],
      none,
    );
    assert.deepEqual(r.errors, []);
    assert.match(r.warnings.join(), /backup lưu 2 cột PII nhưng chưa chọn/);
    assert.match(checkTransfers({ pii: [pii()] }, [VN], none).errors.join(), /không có storage/);
    assert.match(
      checkTransfers({ storage_default: "hosting", pii: [pii({ storage: "" })] }, [VN], none).errors.join(),
      /không có storage/,
    );
    assert.match(
      checkTransfers({ storage_default: "nope", pii: [pii()] }, [VN], none).errors.join(),
      /`nope` không có trong/,
    );
    assert.match(
      checkTransfers(
        { storage_default: "hosting", pii: [pii()] },
        [VN, { id: "x", country: "USA" }],
        none,
      ).errors.join(),
      /x: country phải là mã ISO 3166-1/,
    );
  });
});

describe("check:docs — cơ sở xử lý dữ liệu nhạy cảm (CMP-INTL-002)", () => {
  test("nhay_cam có special_basis → không lỗi; còn 'chờ pháp chế' → cảnh báo", () => {
    assert.deepEqual(
      checkSpecialBasis({ pii: [pii({ class: "nhay_cam", special_basis: "đồng ý riêng" })] }),
      { errors: [], warnings: [] },
    );
    const w = checkSpecialBasis({
      pii: [pii({ class: "nhay_cam", special_basis: "đồng ý riêng — chờ pháp chế xác nhận" })],
    });
    assert.deepEqual(w.errors, []);
    assert.match(w.warnings.join(), /employee\.phone: special_basis chờ pháp chế/);
  });

  test("nhay_cam thiếu/rỗng special_basis → lỗi; class khác mà có special_basis → lỗi; class thường không cần", () => {
    assert.match(
      checkSpecialBasis({ pii: [pii({ class: "nhay_cam" })] }).errors.join(),
      /thiếu special_basis/,
    );
    assert.match(
      checkSpecialBasis({ pii: [pii({ class: "nhay_cam", special_basis: "  " })] }).errors.join(),
      /thiếu special_basis/,
    );
    assert.match(
      checkSpecialBasis({ pii: [pii({ class: "thuong", special_basis: "x" })] }).errors.join(),
      /chỉ dùng cho class nhay_cam/,
    );
    assert.deepEqual(checkSpecialBasis({ pii: [pii({ class: "thuong" })] }).errors, []);
  });
});

test("repo thật: check:docs xanh, in danh sách chuyển ra ngoài VN", () => {
  const outp = execFileSync("node", ["scripts/check-docs.mjs"], { encoding: "utf8" });
  assert.match(outp, /Chuyển dữ liệu ra ngoài VN: /);
  assert.match(outp, /check:docs: OK/);
});
