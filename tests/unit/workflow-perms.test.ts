// BASE-SEC-006: quyền GITHUB_TOKEN theo job (kế thừa mức workflow khi job không khai) và bảng trong docs/ops/PERMISSIONS.md
// khớp workflow thật — nới quyền mà không cập nhật tài liệu thì check:ci-policy đỏ.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import * as mod from "../../scripts/lib/workflow-perms.mjs";

type Job = { job: string; perms: string; own: boolean };
const { workflowPerms, renderTable, checkDoc, uploadsWithoutRetention, uploadsWithoutRetentionText } =
  mod as {
    uploadsWithoutRetention: (dir: string) => string[];
    uploadsWithoutRetentionText: (text: string, file: string) => string[];
    workflowPerms: (t: string) => Job[];
    renderTable: (dir: string) => string;
    checkDoc: (doc: string, dir: string) => string[];
  };

const WF = `name: X
on: push
permissions:
  contents: read
jobs:
  a:
    runs-on: ubuntu-latest
    steps: []
  b:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write # lý do
      contents: read
    steps: []
  c:
    permissions: {}
    runs-on: ubuntu-latest
`;
const dirs: string[] = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("workflow-perms (BASE-SEC-006)", () => {
  test("job không khai kế thừa workflow; job khai riêng xếp khoá, bỏ chú thích; {} = không quyền", () => {
    assert.deepEqual(workflowPerms(WF), [
      { job: "a", perms: "contents: read", own: false },
      { job: "b", perms: "contents: read, pull-requests: write", own: true },
      { job: "c", perms: "(không quyền)", own: true },
    ]);
  });

  test("workflow thiếu permissions cấp đỉnh → hiện rõ là mặc định của repo; dạng vô hướng read-all giữ nguyên", () => {
    assert.match(
      workflowPerms("on: push\njobs:\n  a:\n    runs-on: x\n")[0]?.perms ?? "",
      /mặc định của repo/,
    );
    assert.equal(workflowPerms("permissions: read-all\njobs:\n  a:\n    runs-on: x\n")[0]?.perms, "read-all");
  });

  test("nới quyền một job mà không ghi lại bảng → checkDoc báo lệch; ghi lại → khớp", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xc-wf-"));
    dirs.push(dir);
    writeFileSync(path.join(dir, "x.yml"), WF);
    const doc = `# T\n\n${renderTable(dir)}\n`;
    assert.deepEqual(checkDoc(doc, dir), []);
    writeFileSync(
      path.join(dir, "x.yml"),
      WF.replace("pull-requests: write", "pull-requests: write\n      contents: write"),
    );
    assert.match(checkDoc(doc, dir).join(), /lệch bảng/);
    assert.match(checkDoc("# không mốc", dir).join(), /thiếu bảng/);
  });

  test("XC-GREEN-007: upload-artifact thiếu retention-days → lỗi tệp:dòng; có (kể cả sau if/with) → không lỗi", () => {
    const step = (extra: string) =>
      `jobs:\n  a:\n    steps:\n      - uses: actions/upload-artifact@abc # v7\n        if: always()\n        with:\n          name: x\n${extra}      - run: echo\n`;
    assert.deepEqual(uploadsWithoutRetentionText(step("          retention-days: 14\n"), "w.yml"), []);
    assert.deepEqual(uploadsWithoutRetentionText(step(""), "w.yml"), [
      "XC-GREEN-007: w.yml:4 upload-artifact thiếu retention-days",
    ]);
    // retention-days ở bước KẾ TIẾP không được tính cho bước upload.
    assert.equal(
      uploadsWithoutRetentionText(step("      - with:\n          retention-days: 3\n"), "w.yml").length,
      1,
    );
  });

  test("tài liệu thật của repo khớp .github/workflows; mọi upload-artifact của repo có retention-days", () => {
    assert.deepEqual(uploadsWithoutRetention(".github/workflows"), []);
    assert.deepEqual(checkDoc(readFileSync("docs/ops/PERMISSIONS.md", "utf8"), ".github/workflows"), []);
  });
});
