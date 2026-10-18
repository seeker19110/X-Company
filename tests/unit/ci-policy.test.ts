import assert from "node:assert/strict";
import { describe, test } from "node:test";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import { checkPr, section, stripComments } from "../../scripts/pr-policy.mjs";
// @ts-expect-error -- script .mjs thuần JS
import { bannedOps, nameProblems } from "../../scripts/check-migrations.mjs";
// @ts-expect-error -- script .mjs thuần JS
import { belowFloor, lowered } from "../../scripts/check-coverage-baseline.mjs";
// @ts-expect-error -- script .mjs thuần JS
import { quickstartCommands } from "../../scripts/readme-smoke.mjs";

type PrResult = { errors: string[]; warnings: string[] };
const pr = checkPr as (x: { title: string; body: string; files: string[] }) => PrResult;

const BODY = `## Mô tả
Sửa lỗi X.
## Bằng chứng
- [x] gate
## Rủi ro
Phụ thuộc mới: không có
Lý do sửa cấu hình cổng/migration: không có
Backup trước migrate: không có migration
## Rollback
Revert PR.
## Tài liệu
không cần — không đổi API
`;

describe("pr-policy (WF-REVIEW-002, STD-PROC-004, QA-STRATEGY)", () => {
  test("PR hợp lệ đạt; tiêu đề sai chuẩn hoặc > 72 ký tự bị chặn", () => {
    assert.deepEqual(
      pr({ title: "feat(work): thêm bộ lọc", body: BODY, files: ["lib/work/tasks.ts"] }).errors,
      [],
    );
    assert.match(pr({ title: "Cập nhật", body: BODY, files: [] }).errors[0]!, /Conventional Commits/);
    const long = "feat: " + "a".repeat(70);
    assert.ok(pr({ title: long, body: BODY, files: [] }).errors.some((e) => e.includes("> 72")));
  });

  test("stripComments: comment nhiều dòng, ghép lồng và chưa đóng không để sót `<!--`", () => {
    assert.equal(stripComments("a<!-- x\ny -->b"), "ab");
    assert.equal(stripComments("a<!<!-- x -->-- y -->b"), "ab");
    assert.equal(stripComments("a <!-- chưa đóng\nb"), "a ");
    assert.equal((stripComments("<!<!--- -->-- z") as string).includes("<!--"), false);
  });

  test("mục bắt buộc rỗng (chỉ comment) bị báo", () => {
    const body = BODY.replace("Revert PR.", "<!-- điền -->");
    assert.deepEqual(section(body, "Rollback"), "");
    assert.ok(pr({ title: "docs: x", body, files: [] }).errors.some((e) => e.includes('"## Rollback"')));
  });

  test("fix: phải đổi tests/ hoặc e2e/; refactor/perf cần bảng trước/sau", () => {
    assert.ok(
      pr({ title: "fix: x", body: BODY, files: ["lib/a.ts"] }).errors.some((e) =>
        e.includes("test tái hiện"),
      ),
    );
    assert.deepEqual(
      pr({ title: "fix: x", body: BODY, files: ["lib/a.ts", "tests/unit/a.test.ts"] }).errors,
      [],
    );
    assert.ok(pr({ title: "perf: x", body: BODY, files: [] }).errors.some((e) => e.includes("Trước")));
    assert.deepEqual(
      pr({ title: "perf: x", body: BODY + "\n| Chỉ số | Trước | Sau |\n", files: [] }).errors,
      [],
    );
  });

  test("lockfile, cấu hình cổng, migration cần dòng khai báo có nội dung", () => {
    const empty = BODY.replace("Phụ thuộc mới: không có", "Phụ thuộc mới: <!-- -->")
      .replace("Lý do sửa cấu hình cổng/migration: không có", "Lý do sửa cấu hình cổng/migration:")
      .replace("Backup trước migrate: không có migration", "Backup trước migrate:");
    const errs = pr({
      title: "chore: x",
      body: empty,
      files: ["package-lock.json", "migrations/0099_x.sql"],
    }).errors;
    assert.equal(errs.length, 3, errs.join(" | "));
  });

  test("đổi API mà không chạm tài liệu → cảnh báo (không chặn)", () => {
    const r = pr({ title: "feat: x", body: BODY, files: ["app/api/app/me/route.ts"] });
    assert.deepEqual(r.errors, []);
    assert.equal(r.warnings.length, 1);
  });
});

describe("check-migrations (DB-MIG-008)", () => {
  test("tên phải liên tục, đúng mẫu", () => {
    assert.deepEqual(nameProblems(["0001_a.sql", "0002_b.sql"]), []);
    assert.equal((nameProblems(["0001_a.sql", "0003_c.sql"]) as string[]).length, 1);
    assert.equal((nameProblems(["0001_A.sql"]) as string[]).length, 1);
  });

  test("DROP/RENAME/đổi kiểu/TRUNCATE bị chặn trừ khi có -- contract:; REVOKE TRUNCATE không tính", () => {
    const bad =
      "ALTER TABLE t DROP COLUMN c;\nALTER TABLE t RENAME COLUMN a TO b;\nALTER TABLE t ALTER COLUMN x TYPE text;\nTRUNCATE t;";
    assert.equal((bannedOps("x.sql", bad) as string[]).length, 4);
    assert.deepEqual(
      bannedOps("x.sql", "ALTER TABLE t DROP COLUMN c; -- contract: bản N−1 đã ngừng đọc c"),
      [],
    );
    assert.deepEqual(
      bannedOps("x.sql", "REVOKE UPDATE, DELETE, TRUNCATE ON t FROM r;\n-- DROP TABLE trong comment"),
      [],
    );
  });
});

describe("coverage baseline (QA-COV-002)", () => {
  test("hạ ngưỡng so với gốc bị chặn; tăng/giữ được; dưới sàn M bị chặn", () => {
    assert.deepEqual(lowered({ lines: 96, branches: 89 }, { lines: 96, branches: 90 }), []);
    assert.deepEqual(lowered({ lines: 96, branches: 89 }, { lines: 95, branches: 89 }), ["lines"]);
    assert.deepEqual(belowFloor({ lines: 96, statements: 96, functions: 96, branches: 89 }), []);
    assert.deepEqual(belowFloor({ lines: 80, statements: 96, functions: 96 }), ["lines", "branches"]);
  });
});

describe("readme-smoke (BASE-DOC-005)", () => {
  test("trích lệnh dưới 'Bắt đầu nhanh', bỏ git clone; thiếu khối → lỗi", () => {
    const md = "# X\n\n## Bắt đầu nhanh (3 lệnh)\n\n```bash\ngit clone u && cd X\nnpm ci\nnpm test\n```\n";
    assert.deepEqual(quickstartCommands(md), ["npm ci", "npm test"]);
    assert.throws(() => quickstartCommands("# X"), /Bắt đầu nhanh/);
  });
});
