// WF-TEAM-003 (check:docs): Definition of Ready — task còn mở trong PLAN phải có Gate máy, files:, không còn câu hỏi mở;
// task đã tick không xét.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import * as mod from "../../scripts/lib/dor-check.mjs";

const { checkDor } = mod as { checkDor: (text: string, file: string) => string[] };
const READY =
  "- [ ] `T-200` Làm X (files: lib/x.ts, tests/unit/x.test.ts) — Gate: `npm run -s test:file -- x.test.ts`";

describe("check:docs — Definition of Ready (WF-TEAM-003)", () => {
  test("task mở đủ Gate + files → không lỗi; task đã tick thiếu mọi thứ → không xét", () => {
    assert.deepEqual(checkDor(`# PLAN\n\n${READY}\n- [x] \`T-100\` cũ không Gate\n`, "P.md"), []);
  });

  test("thiếu Gate → lỗi nêu tệp:dòng và ID; Gate rỗng/không backtick cũng là thiếu", () => {
    const e1 = checkDor("x\n- [ ] `T-201` Làm Y (files: a.ts)", "P.md");
    assert.deepEqual(e1, ['P.md:2 T-201: thiếu "— Gate: `<lệnh>`" (DoR, WF-TEAM-003)']);
    assert.equal(checkDor("- [ ] `T-202` Y (files: a.ts) — Gate: npm test", "P.md").length, 1);
  });

  test("thiếu files: hoặc files: rỗng → lỗi", () => {
    assert.match(checkDor("- [ ] `T-203` Y — Gate: `true`", "P.md").join(), /thiếu phạm vi "files: …"/);
    assert.match(checkDor("- [ ] `T-204` Y (files: ) — Gate: `true`", "P.md").join(), /files:/);
  });

  test("câu hỏi mở: [?], TBD, TODO, (chưa rõ…), ??? → lỗi; dấu hỏi thường trong câu không bị bắt", () => {
    for (const q of ["[?]", "TBD", "TODO", "(chưa rõ ngưỡng)", "???"])
      assert.match(checkDor(READY.replace("Làm X", `Làm X ${q}`), "P.md").join(), /câu hỏi mở/, q);
    assert.deepEqual(checkDor(READY.replace("Làm X", "Làm X — có cần cache?"), "P.md"), []);
  });
});
