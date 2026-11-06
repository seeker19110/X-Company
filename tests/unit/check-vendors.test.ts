// CMP-AUDIT-007: sổ nhà cung cấp (docs/compliance/vendors.yaml) — mọi gói dependencies phải được phân loại (bên xử lý
// hoặc khong_goi_ngoai), SDK dev/adapter mới phải có dòng, trường đủ, rà ≤ 12 tháng theo ngày UTC, bộ đọc YAML chặt,
// processors.md sinh tất định từ sổ.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import * as mod from "../../scripts/check-vendors.mjs";

type Vendor = Record<string, string | string[]>;
type Opts = {
  deps: string[];
  devDeps?: string[];
  adapters: string[];
  today: Date;
  noExternal?: string[] | null;
  exists?: (p: string) => boolean;
};
const { readRegistry, parseVendors, checkVendors, renderProcessors } = mod as {
  readRegistry: (t: string) => { vendors: Vendor[]; noExternal: string[] | null; errors: string[] };
  parseVendors: (t: string) => Vendor[];
  checkVendors: (v: Vendor[], o: Opts) => string[];
  renderProcessors: (v: Vendor[]) => string;
};

const YAML = `version: 1
khong_goi_ngoai: [zod, "@node-rs/argon2"]
vendors:
  - id: kms
    name: "Kho khoá"
    service: "bọc DEK"
    data: "DEK"
    location: "chờ chủ dự án"
    country: chua_chon
    dpa: "không cần"
    certs: "—"
    risk: trung_binh
    status: du_kien
    reviewed: 2026-11-06
    packages: [pg]
    adapters: [adapters/kms.ts]
`;
const today = new Date("2026-11-06T12:00:00Z");
const deps = ["pg", "zod", "@node-rs/argon2"];
const ok: Opts = {
  deps,
  adapters: ["adapters/kms.ts"],
  today,
  noExternal: ["zod", "@node-rs/argon2"],
  exists: () => true,
};
const run = (yaml: string, o: Partial<Opts> = {}) => {
  const r = readRegistry(yaml);
  return [...r.errors, ...checkVendors(r.vendors, { ...ok, noExternal: r.noExternal, ...o })];
};

describe("check-vendors", () => {
  test("sổ hợp lệ → không lỗi; danh sách [a, b] bỏ nháy; parseVendors trả cùng danh sách", () => {
    const r = readRegistry(YAML);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.noExternal, ["zod", "@node-rs/argon2"]);
    assert.deepEqual(r.vendors[0]?.packages, ["pg"]);
    assert.deepEqual(parseVendors(YAML), r.vendors);
    assert.deepEqual(run(YAML), []);
  });

  test("gói dependencies chưa phân loại → lỗi, kể cả SDK không có trong mẫu (geocoding, AI, bản đồ)", () => {
    const errs = run(YAML, { deps: [...deps, "@googlemaps/google-maps-services-js", "ai", "leaflet"] }).join(
      "\n",
    );
    for (const p of ["@googlemaps/google-maps-services-js", "ai", "leaflet"])
      assert.match(errs, new RegExp(`\`${p}\` chưa phân loại`));
  });

  test("khong_goi_ngoai: thiếu khoá / gói không còn trong deps / trùng với bên xử lý → lỗi", () => {
    assert.match(run(YAML.replace(/^khong_goi_ngoai.*\n/m, "")).join(), /thiếu khong_goi_ngoai/);
    assert.match(run(YAML, { deps: ["pg", "zod"] }).join(), /`@node-rs\/argon2` không có trong dependencies/);
    assert.match(run(YAML.replace("[zod,", "[pg, zod,")).join(), /`pg` vừa ở khong_goi_ngoai vừa thuộc/);
  });

  test("devDependencies khớp mẫu SDK mà không có dòng → lỗi; gói dev thường không bị bắt", () => {
    const errs = run(YAML, { devDeps: ["@sentry/nextjs", "prettier"] });
    assert.equal(errs.length, 1);
    assert.match(errs[0] ?? "", /@sentry\/nextjs.*devDependencies/);
  });

  test("adapter mới chưa thuộc bên xử lý → lỗi; adapter khai mà không tồn tại → lỗi", () => {
    const errs = run(YAML, {
      adapters: ["adapters/kms.ts", "adapters/smtp/index.ts"],
      exists: () => false,
    }).join("\n");
    assert.match(errs, /adapter `adapters\/smtp\/index\.ts` chưa thuộc/);
    assert.match(errs, /adapter `adapters\/kms\.ts` không tồn tại/);
  });

  test("ngày rà theo ngày UTC: 365 ngày còn hợp lệ cả lúc 23:59Z, 366 ngày → lỗi; ngày không có thật / tương lai → lỗi", () => {
    const at = (reviewed: string, now: string) =>
      run(YAML.replace("2026-11-06", reviewed), { today: new Date(now) });
    assert.deepEqual(at("2025-11-06", "2026-11-06T23:59:59Z"), []);
    assert.match(at("2025-11-05", "2026-11-06T00:00:00Z").join(), /quá 365 ngày/);
    assert.match(at("2026-02-31", "2026-11-06T00:00:00Z").join(), /ngày có thật/);
    assert.match(at("06/11/2026", "2026-11-06T00:00:00Z").join(), /ngày có thật/);
    assert.match(at("2026-11-07", "2026-11-06T23:00:00Z").join(), /tương lai/);
  });

  test("bộ đọc chặt: thiếu '- ', null/~, chú thích sau giá trị, nháy hỏng, khoá trùng, dòng ngoài vendors → lỗi kèm số dòng", () => {
    const cases: [string, RegExp][] = [
      [YAML.replace("  - id: kms", "  id: kms"), /:4: dòng không đúng dạng/],
      [YAML.replace('dpa: "không cần"', "dpa: ~"), /`dpa` rỗng\/null/],
      [YAML.replace('dpa: "không cần"', "dpa: null"), /`dpa` rỗng\/null/],
      [YAML.replace("risk: trung_binh", "risk: trung_binh # ghi chú"), /chú thích sau giá trị `risk`/],
      [YAML.replace('name: "Kho khoá"', 'name: "Kho" # x'), /chuỗi nháy kép hỏng ở `name`/],
      [YAML.replace("    certs:", "    data: lặp\n    certs:"), /khoá `data` trùng/],
      [`${YAML}retired:\n  - id: cu\n`, /dòng thụt lề ngoài khối vendors/],
    ];
    for (const [y, re] of cases) assert.match(readRegistry(y).errors.join("\n"), re, String(re));
  });

  test("thiếu trường, risk lạ, id trùng, gói khai mà không có trong deps → lỗi", () => {
    const bad = YAML.replace('    dpa: "không cần"\n', "").replace("risk: trung_binh", "risk: vua");
    const all = run(bad + bad.split("vendors:\n")[1], { deps: ["zod", "@node-rs/argon2"] }).join("\n");
    for (const re of [/thiếu trường `dpa`/, /risk phải là/, /id trùng/, /gói `pg` không có trong/])
      assert.match(all, re);
  });

  test("processors.md sinh tất định, thoát `|`; bản trong repo khớp sổ thật, sổ thật không lỗi đọc", () => {
    const v = parseVendors(YAML.replace('"bọc DEK"', '"bọc | mở DEK"'));
    const md = renderProcessors(v);
    assert.equal(md, renderProcessors(v));
    assert.match(md, /bọc \\\| mở DEK/);
    const real = readRegistry(readFileSync("docs/compliance/vendors.yaml", "utf8"));
    assert.deepEqual(real.errors, []);
    assert.equal(readFileSync("docs/privacy/processors.md", "utf8"), renderProcessors(real.vendors));
  });
});
