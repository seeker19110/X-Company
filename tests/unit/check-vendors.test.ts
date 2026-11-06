// CMP-AUDIT-007: sổ nhà cung cấp (docs/compliance/vendors.yaml) — SDK/adapter mới phải có dòng, trường đủ, rà ≤ 12 tháng,
// processors.md sinh tất định từ sổ.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import * as mod from "../../scripts/check-vendors.mjs";

type Vendor = Record<string, string | string[]>;
const { parseVendors, checkVendors, renderProcessors } = mod as {
  parseVendors: (t: string) => Vendor[];
  checkVendors: (
    v: Vendor[],
    o: { deps: string[]; adapters: string[]; today: Date; exists?: (p: string) => boolean },
  ) => string[];
  renderProcessors: (v: Vendor[]) => string;
};

const YAML = `version: 1
vendors:
  - id: kms
    name: "Kho khoá"
    service: "bọc DEK"
    data: "DEK đã bọc"
    location: "chờ chủ dự án"
    dpa: "không cần"
    certs: "—"
    risk: trung_binh
    status: du_kien
    reviewed: 2026-11-06
    packages: [pg]
    adapters: [adapters/kms.ts]
`;
const today = new Date("2026-11-06T12:00:00Z");
const ok = { deps: ["pg", "zod"], adapters: ["adapters/kms.ts"], today, exists: () => true };

describe("check-vendors", () => {
  test("sổ hợp lệ, gói/adapter đều có dòng → không lỗi; đọc danh sách dạng [a, b]", () => {
    const v = parseVendors(YAML);
    assert.equal(v.length, 1);
    assert.deepEqual(v[0]?.packages, ["pg"]);
    assert.deepEqual(v[0]?.adapters, ["adapters/kms.ts"]);
    assert.deepEqual(checkVendors(v, ok), []);
  });

  test("SDK dịch vụ ngoài mới chưa có dòng → lỗi nêu tên gói; gói thường không bị bắt", () => {
    const errs = checkVendors(parseVendors(YAML), { ...ok, deps: ["pg", "zod", "@sentry/nextjs", "stripe"] });
    assert.equal(errs.length, 2);
    assert.match(errs.join("\n"), /@sentry\/nextjs/);
    assert.match(errs.join("\n"), /stripe/);
  });

  test("adapter mới chưa thuộc bên xử lý nào → lỗi; adapter khai mà không tồn tại → lỗi", () => {
    const errs = checkVendors(parseVendors(YAML), {
      ...ok,
      adapters: ["adapters/kms.ts", "adapters/smtp.ts"],
      exists: (p) => !p.endsWith("kms.ts"),
    });
    assert.match(errs.join("\n"), /adapter `adapters\/smtp\.ts` chưa thuộc/);
    assert.match(errs.join("\n"), /adapter `adapters\/kms\.ts` không tồn tại/);
  });

  test("ngày rà: đúng 365 ngày còn hợp lệ, 366 ngày → lỗi; sai định dạng/tương lai → lỗi", () => {
    const at = (reviewed: string, now: string) =>
      checkVendors(parseVendors(YAML.replace("2026-11-06", reviewed)), { ...ok, today: new Date(now) });
    assert.deepEqual(at("2025-11-06", "2026-11-06T00:00:00Z"), []);
    assert.match(at("2025-11-05", "2026-11-06T00:00:00Z").join(), /quá 365 ngày/);
    assert.match(at("06/11/2026", "2026-11-06T00:00:00Z").join(), /YYYY-MM-DD/);
    assert.match(at("2026-12-01", "2026-11-06T00:00:00Z").join(), /tương lai/);
  });

  test("thiếu trường bắt buộc, risk/status lạ, id trùng, gói khai mà không có trong dependencies → lỗi", () => {
    const bad = YAML.replace('    dpa: "không cần"\n', "").replace("risk: trung_binh", "risk: vua");
    const errs = checkVendors(parseVendors(bad + bad.split("vendors:\n")[1]), { ...ok, deps: ["zod"] });
    const all = errs.join("\n");
    assert.match(all, /thiếu trường `dpa`/);
    assert.match(all, /risk phải là/);
    assert.match(all, /id trùng/);
    assert.match(all, /gói `pg` không có trong dependencies/);
  });

  test("processors.md sinh tất định, thoát ký tự `|`; bản trong repo khớp sổ thật", () => {
    const v = parseVendors(YAML.replace('"bọc DEK"', '"bọc | mở DEK"'));
    const md = renderProcessors(v);
    assert.equal(md, renderProcessors(v));
    assert.match(md, /bọc \\\| mở DEK/);
    assert.match(md, /\| trung bình \| dự kiến \| 2026-11-06 \|/);
    const real = parseVendors(readFileSync("docs/compliance/vendors.yaml", "utf8"));
    assert.equal(readFileSync("docs/privacy/processors.md", "utf8"), renderProcessors(real));
  });
});
