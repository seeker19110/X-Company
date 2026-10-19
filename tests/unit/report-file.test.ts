// Gate/lệnh kiểm không được ghi vào repo (xt.py loop verify đỏ khi cây đổi sau Gate): báo cáo của drill/probe mặc định ra thư mục tạm,
// chỉ vào repo khi XC_REPORT_DIR chỉ rõ (CI, reports:refresh). Hàng rào cho lỗi gặp ở kiểm cuối: dast:probes, perf:load, ops:stack:drill.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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

function scriptFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return n === "git-hooks" ? [] : scriptFiles(p);
    return /\.(mjs|ts)$/.test(n) ? [p] : [];
  });
}

/** Script ghi tệp đã commit trong docs/ có chủ đích (công cụ sinh tài liệu chạy bằng tay, KHÔNG phải Gate/Kiểm) — mỗi mục nêu lý do. */
const WRITES_DOCS_ON_PURPOSE: Record<string, string> = {
  "scripts/gen-openapi.ts": "gen:openapi sinh docs/api/openapi.json; Gate chỉ chạy check:openapi (so sánh)",
  "scripts/gen-third-party-notices.mjs": "notices sinh THIRD_PARTY_NOTICES.md; Gate chỉ chạy bản --check",
  "scripts/kms-rotation-drill.ts":
    "kms:drill nối nhật ký docs/security/rotation-log.md; không là Gate/Kiểm trong PLAN hay BLUEPRINT",
  "scripts/check-perf-budget.mjs": "chỉ ghi baseline khi có --write-baseline",
};

describe("reportFile", () => {
  test("mặc định ra thư mục tạm ngẫu nhiên, không bao giờ vào cây repo; cùng tiến trình dùng chung một thư mục", () => {
    delete process.env.XC_REPORT_DIR;
    const f = reportFile("docs/ops/x.md") as string;
    const g = reportFile("docs/ops/y.json") as string;
    assert.ok(f.startsWith(path.join(tmpdir(), "xc-reports-")), f);
    assert.ok(!f.startsWith(ROOT + path.sep), "không được nằm trong repo");
    assert.ok(existsSync(path.dirname(f)), "thư mục cha được tạo");
    assert.equal(path.dirname(f), path.dirname(g), ".md và .json chung một thư mục gốc");
    assert.equal((statSync(path.join(f, "..", "..", "..")).mode & 0o777).toString(8), "700", "mkdtemp: 0700");
  });
  test("XC_REPORT_DIR rỗng coi như chưa đặt (không ghi nhầm vào gốc repo)", () => {
    process.env.XC_REPORT_DIR = "";
    assert.ok(!(reportFile("docs/ops/x.md") as string).startsWith(ROOT + path.sep));
  });
  test("XC_REPORT_DIR=. ghi vào repo đúng đường dẫn docs/…; thư mục khác được tôn trọng", () => {
    process.env.XC_REPORT_DIR = ".";
    assert.equal(reportFile("docs/ops/ops-stack-drill.md"), path.join(ROOT, "docs/ops/ops-stack-drill.md"));
    process.env.XC_REPORT_DIR = path.join(tmpdir(), "xc-khac");
    assert.equal(reportFile("a/b.json"), path.join(tmpdir(), "xc-khac", "a/b.json"));
  });
});

describe("không script nào ghi thẳng vào docs/ ngoài danh sách có lý do", () => {
  test("quét scripts/**: writeFileSync/appendFileSync với đích nhắc tới `docs/` phải đi qua reportFile hoặc có trong danh sách", () => {
    const bad: string[] = [];
    for (const abs of scriptFiles(path.join(ROOT, "scripts"))) {
      const rel = path.relative(ROOT, abs).split(path.sep).join("/");
      if (rel === "scripts/lib/prod-harness.mjs") continue; // định nghĩa reportFile
      const src = readFileSync(abs, "utf8");
      const writesDocs = /(writeFileSync|appendFileSync)\s*\([^;]*?docs\//s.test(src);
      if (writesDocs && !/reportFile\(/.test(src) && !(rel in WRITES_DOCS_ON_PURPOSE)) bad.push(rel);
    }
    assert.deepEqual(bad, [], "script ghi vào docs/ mà không dùng reportFile (Gate sẽ làm đổi cây)");
  });
  test("danh sách ngoại lệ không chứa tệp đã biến mất (khỏi mục thừa)", () => {
    for (const rel of Object.keys(WRITES_DOCS_ON_PURPOSE)) assert.ok(existsSync(path.join(ROOT, rel)), rel);
  });
});
