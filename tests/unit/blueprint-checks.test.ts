// Hàng rào check:docs: ghi chú `— Kiểm:` sai dạng (backtick trong chú thích sau lệnh) làm `loop verify` trả exit 2.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import * as BC from "../../scripts/lib/blueprint-checks.mjs";

const XT_DIR = join(process.cwd(), ".xtemplates/scripts");
const item = (id: string, note: string) =>
  `- [x] \`${id}\` **MUST** Yêu cầu mẫu. → Kiểm: mô tả. · Nguồn: mẫu — ${note}\n`;

function withBlueprint(body: string, fn: (path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "bp-checks-"));
  try {
    const path = join(dir, "BLUEPRINT.md");
    writeFileSync(path, `# BLUEPRINT\n\n## Mẫu\n\n${body}`);
    fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("malformedCheckIds", () => {
  test("lệnh đúng dạng (chú thích không backtick) → rỗng", () => {
    withBlueprint(
      item("QA-PERF-007", "Kiểm: `npm run -s check:perf-target` (chú thích thường — T-099)"),
      (p) => {
        assert.deepEqual(BC.malformedCheckIds(XT_DIR, p), []);
      },
    );
  });

  test("backtick trong chú thích sau lệnh → báo ID (ca lát 17)", () => {
    withBlueprint(
      item("QA-PERF-007", "Kiểm: `npm run -s check:perf-target` (nhận `PERF_BASE_URL` chỉ khi loopback)") +
        item("LOOP-FB-003", "Kiểm: `true`"),
      (p) => {
        assert.deepEqual(BC.malformedCheckIds(XT_DIR, p), ["QA-PERF-007"]);
      },
    );
  });

  test("ghi chú Kiểm không có lệnh trong backtick → báo ID", () => {
    withBlueprint(item("QA-PERF-007", "Kiểm: chạy tay"), (p) => {
      assert.deepEqual(BC.malformedCheckIds(XT_DIR, p), ["QA-PERF-007"]);
    });
  });

  test("không đọc được kết quả (thư mục xt sai) → ném, không âm tính giả", () => {
    withBlueprint(item("QA-PERF-007", "Kiểm: `true`"), (p) => {
      assert.throws(() => BC.malformedCheckIds(join(XT_DIR, "khong-co"), p), /không đọc được/);
    });
  });
});

describe("lineRefs (AUD-HAR-003)", () => {
  test("bắt tệp:N, tệp:N-M, tệp:N,M; bỏ qua chuỗi trích, URL cổng và ID yêu cầu", () => {
    const text = [
      "— Bằng chứng: lib/http/index.ts:162 và PLAN.md:20-24",
      'không có — proxy.ts "script-src"; e2e/flows.spec.ts:84,108',
      "http://127.0.0.1:3000/app · `LOOP-CTX-002` · 10:30 UTC",
    ].join("\n");
    assert.deepEqual(BC.lineRefs(text), [
      { line: 1, ref: "lib/http/index.ts:162" },
      { line: 1, ref: "PLAN.md:20-24" },
      { line: 2, ref: "e2e/flows.spec.ts:84,108" },
    ]);
  });
});
