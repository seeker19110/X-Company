// Gate/lệnh kiểm không được ghi vào repo (xt.py loop verify đỏ khi cây đổi sau Gate): báo cáo của drill/probe mặc định ra thư mục tạm,
// chỉ vào repo khi XC_REPORT_DIR chỉ rõ (CI, reports:refresh). Hàng rào cho lỗi gặp ở kiểm cuối: dast:probes, perf:load, ops:stack:drill.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import { reportFile } from "../../scripts/lib/prod-harness.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const saved = process.env.XC_REPORT_DIR;
afterEach(() => {
  if (saved === undefined) delete process.env.XC_REPORT_DIR;
  else process.env.XC_REPORT_DIR = saved;
});

describe("reportFile", () => {
  test("mặc định ra thư mục tạm, không bao giờ vào cây repo", () => {
    delete process.env.XC_REPORT_DIR;
    const f = reportFile("docs/ops/x.md") as string;
    assert.ok(f.startsWith(path.join(tmpdir(), "xc-reports")), f);
    assert.ok(!f.startsWith(ROOT + path.sep), "không được nằm trong repo");
    assert.ok(existsSync(path.dirname(f)), "thư mục cha được tạo");
  });
  test("XC_REPORT_DIR=. ghi vào repo đúng đường dẫn docs/…; thư mục khác được tôn trọng", () => {
    process.env.XC_REPORT_DIR = ".";
    assert.equal(reportFile("docs/ops/ops-stack-drill.md"), path.join(ROOT, "docs/ops/ops-stack-drill.md"));
    process.env.XC_REPORT_DIR = path.join(tmpdir(), "xc-khac");
    assert.equal(reportFile("a/b.json"), path.join(tmpdir(), "xc-khac", "a/b.json"));
  });
  test("mọi script sinh báo cáo trong docs/ đi qua reportFile, không ghi thẳng vào ROOT/docs", () => {
    for (const f of ["scripts/dast-baseline.mjs", "scripts/perf-load.mjs", "scripts/ops-stack-drill.mjs"]) {
      const src = readFileSync(path.join(ROOT, f), "utf8");
      assert.match(src, /reportFile\(/, f);
      assert.doesNotMatch(src, /writeFileSync\(\s*path\.join\(ROOT,\s*[`"]docs\//, f);
    }
  });
});
