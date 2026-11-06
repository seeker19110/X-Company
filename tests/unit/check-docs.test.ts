// CMP-VN-004 (check:docs): dữ liệu cá nhân trong data map gắn bên xử lý lưu trữ (storage) và quốc gia của bên đó;
// bên ngoài Việt Nam phải trỏ hồ sơ đánh giá chuyển dữ liệu có thật; quốc gia chưa chọn = cảnh báo.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, test } from "node:test";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import * as mod from "../../scripts/lib/transfer-check.mjs";

type Row = Record<string, string>;
const { checkTransfers } = mod as {
  checkTransfers: (
    map: { pii?: Row[]; storage_default?: string },
    vendors: Row[],
    exists: (p: string) => boolean,
  ) => { errors: string[]; warnings: string[]; abroad: string[] };
};

const pii = (extra: Row = {}) => ({ table: "employee", column: "phone", ...extra });
const vendors: Row[] = [
  { id: "hosting", country: "VN" },
  { id: "backup", country: "chua_chon" },
  { id: "s3", country: "SG", transfer_assessment: "docs/privacy/transfer-sg.md" },
  { id: "cdn", country: "US" },
];
const none = () => false;

describe("check:docs — chuyển dữ liệu ra ngoài VN (CMP-VN-004)", () => {
  test("lưu trong VN qua storage_default → không lỗi, không cảnh báo, không chuyển ra ngoài", () => {
    const r = checkTransfers({ storage_default: "hosting", pii: [pii()] }, vendors, none);
    assert.deepEqual(r, { errors: [], warnings: [], abroad: [] });
  });

  test("bên xử lý ngoài VN có hồ sơ tồn tại → được liệt kê, không lỗi; hồ sơ không tồn tại → lỗi", () => {
    const map = { storage_default: "hosting", pii: [pii({ storage: "hosting, s3" })] };
    const ok = checkTransfers(map, vendors, (p) => p === "docs/privacy/transfer-sg.md");
    assert.deepEqual(ok.errors, []);
    assert.deepEqual(ok.abroad, ["s3 (SG, 1 cột PII)"]);
    assert.match(checkTransfers(map, vendors, none).errors.join(), /transfer-sg\.md` không tồn tại/);
  });

  test("bên xử lý ngoài VN thiếu transfer_assessment → lỗi nêu quốc gia", () => {
    const r = checkTransfers({ pii: [pii({ storage: "cdn" })] }, vendors, none);
    assert.match(r.errors.join(), /cdn: lưu dữ liệu cá nhân ở US \(ngoài VN\) mà thiếu transfer_assessment/);
  });

  test("country chưa chọn → chỉ cảnh báo (đếm số cột), không lỗi", () => {
    const r = checkTransfers(
      { storage_default: "backup", pii: [pii(), pii({ column: "full_name" })] },
      vendors,
      none,
    );
    assert.deepEqual(r.errors, []);
    assert.match(r.warnings.join(), /backup lưu 2 cột PII nhưng chưa chọn/);
  });

  test("thiếu storage (không có mặc định, ghi đè rỗng) / id lạ / country sai dạng → lỗi", () => {
    assert.match(checkTransfers({ pii: [pii()] }, vendors, none).errors.join(), /không có storage/);
    assert.match(
      checkTransfers(
        { storage_default: "hosting", pii: [pii({ storage: "" })] },
        vendors,
        none,
      ).errors.join(),
      /không có storage/,
    );
    assert.match(
      checkTransfers({ storage_default: "nope", pii: [pii()] }, vendors, none).errors.join(),
      /`nope` không có trong/,
    );
    assert.match(
      checkTransfers(
        { storage_default: "x", pii: [pii()] },
        [{ id: "x", country: "Viet Nam" }],
        none,
      ).errors.join(),
      /mã ISO 3166-1/,
    );
  });

  test("repo thật: check:docs xanh và in danh sách chuyển ra ngoài VN", () => {
    const outp = execFileSync("node", ["scripts/check-docs.mjs"], { encoding: "utf8" });
    assert.match(outp, /Chuyển dữ liệu ra ngoài VN: /);
    assert.match(outp, /check:docs: OK/);
  });
});
