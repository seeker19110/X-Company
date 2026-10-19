import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import { checkLicenses, classify, parsePolicy } from "../../scripts/check-licenses.mjs";
// @ts-expect-error -- script .mjs thuần JS
import { checkExceptions } from "../../scripts/check-osv-exceptions.mjs";
// @ts-expect-error -- script .mjs thuần JS
import { evaluate, run } from "../../scripts/eol-check.mjs";
// @ts-expect-error -- script .mjs thuần JS
import { render } from "../../scripts/gen-third-party-notices.mjs";
// @ts-expect-error -- script .mjs thuần JS
import { licenseCoverage, problems } from "../../scripts/check-sbom.mjs";
// @ts-expect-error -- script .mjs thuần JS
import { checkReleaseManifest, checkWiring } from "../../scripts/check-supply-wiring.mjs";
import { findInterpolations } from "../../scripts/check-sql-interpolation.ts";

const POLICY_TEXT = `allow:
  - MIT
  - Apache-2.0
deny:
  - AGPL-3.0-only
review:
  - LGPL-3.0-or-later
exceptions:
  - package: "@img/sharp-*"
    license: LGPL-3.0-or-later
    reason: "động"
    approved_by: "x"
    expires: 2027-10-18
`;
type Lock = {
  packages: Record<string, { version: string; license?: string; dev?: boolean; link?: boolean }>;
};
const policy = parsePolicy(POLICY_TEXT) as Record<string, unknown>;
const lic = (l: Lock, now = new Date("2026-10-18T00:00:00Z")) => checkLicenses(l, policy, now) as string[];

describe("license-policy (CMP-LIC-002, BASE-DEP-005)", () => {
  test("parsePolicy đọc danh sách và khối ngoại lệ", () => {
    assert.deepEqual(policy.allow, ["MIT", "Apache-2.0"]);
    assert.equal((policy.exceptions as { package: string }[])[0]?.package, "@img/sharp-*");
  });
  test("biểu thức SPDX: OR chọn vế tốt, AND lấy vế xấu, ngoặc, license lạ", () => {
    assert.equal(classify("MIT OR AGPL-3.0-only", policy), "allow");
    assert.equal(classify("MIT AND LGPL-3.0-or-later", policy), "review");
    assert.equal(classify("(MIT AND AGPL-3.0-only)", policy), "deny");
    assert.equal(classify("Weird-1.0", policy), "unknown");
    assert.equal(classify("", policy), "unknown");
  });
  test("đạt khi allow; đỏ khi thiếu license, deny, không rõ", () => {
    assert.deepEqual(
      lic({ packages: { "": { version: "1" }, "node_modules/a": { version: "1", license: "MIT" } } }),
      [],
    );
    assert.match(lic({ packages: { "node_modules/a": { version: "1" } } })[0]!, /thiếu trường license/);
    assert.match(
      lic({ packages: { "node_modules/a": { version: "1", license: "AGPL-3.0-only" } } })[0]!,
      /bị cấm/,
    );
    assert.match(
      lic({ packages: { "node_modules/a": { version: "1", license: "Weird-1.0" } } })[0]!,
      /không có trong chính sách/,
    );
  });
  test("review cần ngoại lệ còn hạn; hết hạn hoặc thiếu → đỏ; gói link bị bỏ qua", () => {
    const l: Lock = {
      packages: { "node_modules/@img/sharp-x": { version: "1", license: "LGPL-3.0-or-later" } },
    };
    assert.deepEqual(lic(l), []);
    assert.ok(lic(l, new Date("2027-10-19T00:00:00Z")).some((e) => e.includes("hết hạn")));
    assert.match(
      lic({ packages: { "node_modules/other": { version: "1", license: "LGPL-3.0-or-later" } } })[0]!,
      /chưa có ngoại lệ/,
    );
    assert.deepEqual(lic({ packages: { "node_modules/l": { version: "1", link: true } } }), []);
  });
});

describe("osv-scanner.toml ngoại lệ (BASE-DEP-004)", () => {
  const now = new Date("2026-10-18T00:00:00Z");
  const t = (until: string, reason = "lý do đủ dài để hợp lệ, nêu người duyệt") =>
    `[[IgnoredVulns]]\nid = "GHSA-x"\nignoreUntil = ${until}\nreason = "${reason}"\n`;
  test("còn hạn đạt; quá hạn, thiếu hạn, thiếu reason, hạn quá xa → đỏ; rỗng đạt", () => {
    assert.deepEqual(checkExceptions(t("2027-01-18"), now), []);
    assert.ok((checkExceptions(t("2026-10-17"), now) as string[])[0]!.includes("quá hạn"));
    assert.ok((checkExceptions(t("2030-01-01"), now) as string[])[0]!.includes("quá"));
    assert.ok((checkExceptions(t("bad"), now) as string[])[0]!.includes("ignoreUntil"));
    assert.ok((checkExceptions(t("2027-01-18", "ngắn"), now) as string[])[0]!.includes("reason"));
    assert.deepEqual(checkExceptions("# không có ngoại lệ\n", now), []);
  });
});

describe("eol-check (OPS-MAINT-003)", () => {
  const now = new Date("2026-10-18T00:00:00Z");
  const data = [
    { cycle: "24", eol: "2028-04-30" },
    { cycle: "20", eol: "2026-04-30" },
    { cycle: "99", eol: "2027-01-01" },
    { cycle: "LTS", eol: false },
  ];
  test("ok / warn < 90 ngày / expired / unknown / eol=false", () => {
    assert.equal(evaluate("24", data, now).level, "ok");
    assert.equal(evaluate("99", data, now).level, "warn");
    assert.equal(evaluate("20", data, now).level, "expired");
    assert.equal(evaluate("5", data, now).level, "unknown");
    assert.equal(evaluate("LTS", data, now).level, "ok");
    assert.equal(evaluate("24", null, now).level, "unknown");
  });
  const read = (f: string) =>
    f === ".nvmrc" ? "v99\n" : f.endsWith("ci.yml") ? "image: postgres:17@sha256:abc" : "";
  const loader = async (slug: string) => (slug === "nodejs" ? data : [{ cycle: "17", eol: "2029-11-08" }]);
  test("PR: warn không đỏ; --strict: đỏ; EOL: đỏ cả hai; lỗi mạng: cảnh báo, exit 0", async () => {
    const pr = await run({ strict: false, read, now, loader });
    assert.equal(pr.exit, 0);
    assert.ok((pr.lines as string[]).some((l) => l.startsWith("::warning::")));
    assert.equal((await run({ strict: true, read, now, loader })).exit, 1);
    const eol = await run({ read: (f: string) => (f === ".nvmrc" ? "20" : ""), now, loader });
    assert.equal(eol.exit, 1);
    const down = await run({
      strict: true,
      read,
      now,
      loader: async () => Promise.reject(new Error("offline")),
    });
    assert.equal(down.exit, 0);
    assert.ok(((down.lines as string[])[0] ?? "").includes("không lấy được dữ liệu"));
  });
});

describe("THIRD_PARTY_NOTICES, SBOM, wiring", () => {
  test("render: bỏ dev/link/gốc, sắp xếp tất định, escape dấu |", () => {
    const lock = {
      packages: {
        "": { version: "0" },
        "node_modules/b": { version: "1.0.0", license: "MIT" },
        "node_modules/a": { version: "2.0.0", license: "MIT | X" },
        "node_modules/d": { version: "1", license: "MIT", dev: true },
        "node_modules/x/node_modules/c": { version: "3", license: "ISC" },
      },
    };
    const out = render(lock) as string;
    assert.ok(out.indexOf("| a |") < out.indexOf("| b |"));
    assert.ok(out.includes("MIT \\| X"));
    assert.ok(!out.includes("| d |"));
    assert.ok(out.includes("Tổng: 3 thành phần."));
    assert.equal(render(lock), out);
    // ô bảng markdown: `\` thoát trước `|` (CodeQL js/incomplete-sanitization)
    const odd = render({ packages: { "node_modules/x": { version: "1", license: "A\\|B" } } }) as string;
    assert.ok(odd.includes("A\\\\\\|B"), odd);
    assert.ok((render({ packages: {} }) as string).includes("Tổng: 0 thành phần."));
  });
  test("SBOM: tỉ lệ license ≥ 99%, rỗng đỏ, sai định dạng đỏ", () => {
    const ok = { bomFormat: "CycloneDX", components: [{ licenses: [{ license: { id: "MIT" } }] }] };
    assert.deepEqual(problems(ok), []);
    assert.equal(
      licenseCoverage({ components: [{}, { licenses: [{ expression: "MIT OR ISC" }] }] }).ratio,
      0.5,
    );
    assert.ok(
      (problems({ bomFormat: "CycloneDX", components: [] }) as string[])[0]!.includes("không có thành phần"),
    );
    assert.ok(
      (problems({ bomFormat: "CycloneDX", components: [{}] }) as string[]).some((e) => e.includes("license")),
    );
    assert.ok((problems({}) as string[]).some((e) => e.includes("CycloneDX")));
  });
  test("wiring: repo thật đạt; thiếu tệp → đỏ", () => {
    assert.deepEqual(checkWiring(), []);
    assert.ok((checkWiring(() => "") as string[]).length > 10);
  });
  test("wiring: manifest release-please nhận mọi SemVer khớp package.json, không ghim 0.1.0", () => {
    const real = (f: string) => readFileSync(f, "utf8");
    const with2 = (m: string, v: string) => (f: string) =>
      f.endsWith(".release-please-manifest.json")
        ? m
        : f === "package.json"
          ? JSON.stringify({ version: v })
          : real(f);
    assert.deepEqual(checkReleaseManifest(with2('{".":"1.0.0"}', "1.0.0")), []);
    assert.deepEqual(checkReleaseManifest(with2('{".":"2.1.0-rc.1"}', "2.1.0-rc.1")), []);
    assert.match((checkReleaseManifest(with2('{".":"1.0.0"}', "0.1.0")) as string[])[0]!, /khác manifest/);
    assert.match((checkReleaseManifest(with2('{".":"v1"}', "v1")) as string[])[0]!, /SemVer/);
    assert.match((checkReleaseManifest(with2("{}", "1.0.0")) as string[])[0]!, /SemVer/);
    assert.match((checkReleaseManifest(with2("", "1.0.0")) as string[])[0]!, /JSON/);
  });
  test("wiring: security-events: write ở cấp workflow bị bắt; chuỗi dài nhiều dòng trống không treo (ReDoS)", () => {
    const real = (f: string) => readFileSync(f, "utf8");
    const withCq = (cq: string) => (f: string) => (f.endsWith("codeql.yml") ? cq : real(f));
    const bad = "permissions:\n  contents: read\n  security-events: write\njobs:\n  a: {}\n";
    assert.ok((checkWiring(withCq(bad)) as string[]).some((e) => e.startsWith("SEC-WEB-001")));
    const evil = "permissions:\n" + " \n".repeat(50_000) + "x";
    const t0 = performance.now();
    checkWiring(withCq(evil));
    assert.ok(performance.now() - t0 < 1000);
  });
});

describe("check-sql-interpolation (SEC-WEB-001)", () => {
  test("nội suy SQL thiếu comment bị báo; có comment ≤ 3 dòng trước thì allowed; template không SQL bỏ qua", () => {
    const bad = "const q = `SELECT * FROM ${t} WHERE id = $1`;";
    assert.deepEqual(
      findInterpolations("a.ts", bad).map((f) => f.allowed),
      [false],
    );
    const ok = "// sql-interp-allow: t là hằng\nconst q = `SELECT * FROM ${t} WHERE id = $1`;";
    assert.deepEqual(
      findInterpolations("a.ts", ok).map((f) => f.allowed),
      [true],
    );
    assert.deepEqual(findInterpolations("a.ts", "const k = `csrf:${x}`;"), []);
    assert.deepEqual(findInterpolations("a.ts", "const q = `SELECT 1`;"), []);
    assert.deepEqual(findInterpolations("a.ts", ""), []);
  });
});
