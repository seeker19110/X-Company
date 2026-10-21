// Kiểm các script cổng kiến trúc (scripts/check-*.ts) bằng cây thư mục giả.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { violations, isAccepted } from "../../scripts/check-adr-immutable.ts";
import { check as checkDomains, importsOf, parseDomains } from "../../scripts/check-domains.ts";
import { check as checkRoutes, parseRoutes, urlOf } from "../../scripts/check-routes.ts";
import { checkSource } from "../../scripts/check-tests.ts";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import { columnViolations } from "../../scripts/check-units.mjs";

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "xc-arch-"));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

const MD = [
  "| `a` | `index.ts` | x |",
  "| `b` | `index.ts`, `pub.ts` | x |",
  "| `c` |  | rỗng → index |",
].join("\n");

test("parseDomains: mặc định index khi cột công khai rỗng", () => {
  const d = parseDomains(MD);
  assert.deepEqual([...d.keys()], ["a", "b", "c"]);
  assert.deepEqual([...(d.get("b") ?? [])], ["index", "pub"]);
  assert.deepEqual([...(d.get("c") ?? [])], ["index"]);
});

test("importsOf: import tĩnh, export from, side-effect, động; bỏ qua chuỗi thường", () => {
  const src = `import x from "./a.ts";\nexport * from "../b/index.ts";\nimport "./c";\nconst m = await import("./d");\nconst s = "from './e'";`;
  assert.deepEqual(importsOf(src), ["./a.ts", "../b/index.ts", "./c", "./d"]);
});

test("check-domains: cho phép tệp công khai, bắt tệp nội bộ và miền chưa khai", () => {
  const dir = fixture({
    "lib/a/index.ts": `import { p } from "../b/pub.ts";\nimport { q } from "@/lib/b";\nexport const x = [p, q];`,
    "lib/b/index.ts": "export const q = 1;",
    "lib/b/pub.ts": "export const p = 1;",
    "lib/b/internal.ts": "export const i = 1;",
    "lib/c/index.ts": `import { i } from "../b/internal.ts";\nimport { z } from "../zzz/index.ts";\nexport const c = [i, z];`,
    "lib/zzz/index.ts": "export const z = 1;",
    "app/page.tsx": `import { i } from "../lib/b/internal.ts";\nexport default i;`,
  });
  try {
    const errors = checkDomains(dir, MD);
    assert.equal(errors.length, 4, errors.join("\n"));
    assert.ok(errors.some((e) => e.includes("lib/zzz chưa khai")));
    assert.ok(errors.some((e) => e.startsWith("lib/c/index.ts") && e.includes("nội bộ")));
    assert.ok(errors.some((e) => e.startsWith("app/page.tsx") && e.includes("nội bộ")));
    assert.ok(!errors.some((e) => e.startsWith("lib/a/")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-domains: thư mục lib rỗng/không tồn tại không lỗi", () => {
  const dir = fixture({ "README.md": "x" });
  try {
    assert.deepEqual(checkDomains(dir, MD), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-domains: miền khai mà không có thư mục lib/<miền> bị bắt (AUD-DOC-004)", () => {
  const dir = fixture({ "lib/a/index.ts": "export {};", "lib/b/index.ts": "export {};" });
  try {
    const errors = checkDomains(dir, MD);
    assert.deepEqual(errors.length, 1, errors.join("\n"));
    assert.ok(errors[0]?.includes('miền "c"') && errors[0].includes("lib/c"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-domains: quét adapters/, instrumentation.ts, proxy.ts (AUD-ARCH-002)", () => {
  const dir = fixture({
    "lib/a/index.ts": "export {};",
    "lib/b/index.ts": "export {};",
    "lib/b/internal.ts": "export {};",
    "lib/c/index.ts": "export {};",
    "adapters/x.ts": `import { i } from "../lib/b/internal.ts";\nexport default i;`,
    "instrumentation.ts": `import { i } from "./lib/b/internal.ts";\nexport default i;`,
    "proxy.ts": `import { i } from "./lib/b/internal.ts";\nimport { ok } from "./lib/a/index.ts";\nexport default [i, ok];`,
  });
  try {
    const errors = checkDomains(dir, MD);
    assert.equal(errors.length, 3, errors.join("\n"));
    for (const f of ["adapters/x.ts", "instrumentation.ts", "proxy.ts"])
      assert.ok(
        errors.some((e) => e.startsWith(f) && e.includes("nội bộ")),
        f,
      );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("urlOf: bỏ nhóm route, giữ tham số động", () => {
  assert.equal(urlOf("app/(public)/page.tsx"), "/");
  assert.equal(urlOf("app/app/cong-viec/[id]/page.tsx"), "/app/cong-viec/[id]");
  assert.equal(urlOf("app/api/health/route.ts"), "/api/health");
});

test("check-routes: khớp thì sạch; thiếu, thừa, sai URL, sai chế độ, thiếu lý do đều bị bắt", () => {
  const dir = fixture({
    "app/(public)/page.tsx": "export default null;",
    "app/api/health/route.ts": "export const GET = null;",
    "app/layout.tsx": "export default null;",
  });
  try {
    const ok = [
      "| `/` | `app/(public)/page.tsx` | tĩnh | giữ chỗ |",
      "| `/api/health` | `app/api/health/route.ts` | động | sức khoẻ |",
    ].join("\n");
    assert.equal(parseRoutes(ok).length, 2);
    assert.deepEqual(checkRoutes(dir, ok), []);
    assert.equal(checkRoutes(dir, "").length, 2);
    const bad = [
      "| `/x` | `app/(public)/page.tsx` | lạ | |",
      "| `/api/health` | `app/api/health/route.ts` | động | ok |",
      "| `/ma` | `app/ma/page.tsx` | tĩnh | ma |",
    ].join("\n");
    const errors = checkRoutes(dir, bad);
    assert.equal(errors.length, 4, errors.join("\n"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-tests: bắt test không assertion và .only/.skip/.todo; chấp nhận assert/rejects/expect", () => {
  const good = `import assert from "node:assert/strict";\ntest("a", () => { assert.equal(1, 1); });\ntest("b", async () => { await assert.rejects(f()); });\nit("c", () => { expect(1).toBe(1); });\ntest("d", async (t) => { await t.test("sub", () => { verifyX(); }); assertOk(); });`;
  assert.deepEqual(checkSource("g.test.ts", good), []);
  const noAssert = `test("x", () => { const a = 1; void a; });`;
  assert.equal(checkSource("n.test.ts", noAssert).length, 1);
  const forbidden = `test.only("a", () => { assert.ok(true); });\ndescribe.skip("b", () => {});\ntest("c", { todo: true }, () => { assert.ok(true); });`;
  assert.equal(checkSource("f.test.ts", forbidden).length, 3);
  assert.deepEqual(checkSource("e.test.ts", ""), []);
});

test("check-adr: chỉ dòng Trạng thái/liên kết được đổi", () => {
  const okDiff =
    "--- a/x\n+++ b/x\n@@ -3 +3 @@\n-- Trạng thái: Chấp nhận · Ngày: 1\n+- Trạng thái: Thay thế · Ngày: 1\n+Thay thế bởi: ADR-0009";
  assert.deepEqual(violations(okDiff), []);
  const badDiff = "@@ -9 +9 @@\n-Chọn A.\n+Chọn B.";
  assert.deepEqual(violations(badDiff), ["-Chọn A.", "+Chọn B."]);
  assert.deepEqual(violations(""), []);
  assert.equal(isAccepted("# ADR\n\n- Trạng thái: Chấp nhận · Ngày: 1"), true);
  assert.equal(isAccepted("# ADR\n\n- Trạng thái: Đề xuất"), false);
});

test("check:units cột số (XC-UNITS-009): thiếu hậu tố đơn vị → đỏ; đơn vị/không đơn vị đã rà → qua", () => {
  const ok = [
    "CREATE TABLE t (",
    "  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,",
    "  qr_ttl_sec integer NOT NULL,",
    "  minutes integer NOT NULL,",
    "  size_bytes integer,",
    "  geo_lat double precision, -- độ",
    "  version integer NOT NULL,",
    "  row_count integer NOT NULL,",
    "  CHECK (minutes > 0),",
    "  PRIMARY KEY (id)",
    ");",
  ].join("\n");
  assert.deepEqual(columnViolations("m.sql", ok), []);
  const bad = columnViolations(
    "m.sql",
    "CREATE TABLE t (\n  timeout integer NOT NULL,\n  weight numeric(6,2)\n);\nALTER TABLE t ADD COLUMN IF NOT EXISTS grace integer;",
  );
  assert.equal(bad.length, 3);
  assert.match(bad[0] ?? "", /m\.sql:2: cột số "timeout"/);
  assert.match(bad[2] ?? "", /m\.sql:5: .*"grace"/);
  assert.deepEqual(columnViolations("m.sql", ""), []);
});
