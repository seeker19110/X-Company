// SEC-TM-006: mối đe doạ mức Cao trong docs/THREAT-MODEL.md phải có bằng chứng tồn tại (tệp hoặc ID checklist), không
// "accept", mức khớp KN×TĐ; rủi ro chấp nhận chưa xác nhận = cảnh báo.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import * as mod from "../../scripts/check-threat-model.mjs";

type Result = { errors: string[]; warnings: string[]; high: number };
const { checkThreats, level } = mod as {
  checkThreats: (text: string, exists: (p: string) => boolean) => Result;
  level: (kn: number, td: number) => string;
};

const HEAD =
  "| ID | STRIDE | Mối đe doạ | KN | TĐ | Mức | Quyết định | Biện pháp | Bằng chứng | Trạng thái |\n|---|---|---|---|---|---|---|---|---|---|\n";
const row = (id: string, kn: number, td: number, lvl: string, dec: string, ev: string) =>
  `| ${id} | Spoofing | x | ${kn} | ${td} | ${lvl} | ${dec} | y | ${ev} | mở |\n`;
const yes = (p: string) => p === "tests/a.test.ts" || p === "docs/security/x.md";

describe("check-threat-model (SEC-TM-006)", () => {
  test("mức theo KN×TĐ: biên 2→Thấp, 3→TB, 4→TB, 6→Cao, 9→Cao", () => {
    assert.deepEqual(
      [level(1, 2), level(1, 3), level(2, 2), level(2, 3), level(3, 3)],
      ["Thấp", "TB", "TB", "Cao", "Cao"],
    );
  });

  test("Cao có tệp tồn tại / link tương đối docs/ / ID checklist → không lỗi; TB không cần bằng chứng", () => {
    const t =
      HEAD +
      row("T1", 2, 3, "Cao", "mitigate", "`tests/a.test.ts` S-1 (có)") +
      row("T2", 3, 3, "Cao", "mitigate", "[enc](security/x.md)") +
      row("T3", 3, 2, "Cao", "mitigate", "SEC-AUTH-012 (có)") +
      row("T4", 1, 3, "TB", "accept", "xem mục 6");
    assert.deepEqual(checkThreats(t, yes), { errors: [], warnings: [], high: 3 });
  });

  test("Cao: accept / bằng chứng 'chưa có' / tệp không tồn tại / không có bằng chứng → mỗi ca một lỗi", () => {
    const t =
      HEAD +
      row("T1", 2, 3, "Cao", "accept", "`tests/a.test.ts`") +
      row("T2", 2, 3, "Cao", "mitigate", "(chưa có: T-999)") +
      row("T3", 2, 3, "Cao", "mitigate", "`tests/missing.test.ts` (có)") +
      row("T4", 2, 3, "Cao", "mitigate", "kiểm tay");
    const e = checkThreats(t, yes).errors.join("\n");
    assert.match(e, /T1: mức Cao không được "accept"/);
    assert.match(e, /T2: mức Cao còn bằng chứng "chưa có"/);
    assert.match(e, /T3: bằng chứng `tests\/missing\.test\.ts` không tồn tại/);
    assert.match(e, /T4: mức Cao thiếu bằng chứng/);
  });

  test("Mức lệch KN×TĐ hoặc KN/TĐ ngoài 1–3 → lỗi; ghi TB mà tích = 6 vẫn bị xét là Cao", () => {
    const t = HEAD + row("T1", 2, 3, "TB", "mitigate", "kiểm tay") + row("T2", 4, 1, "TB", "mitigate", "");
    const e = checkThreats(t, yes).errors.join("\n");
    assert.match(e, /T1: Mức "TB" lệch KN×TĐ = 6 → Cao/);
    assert.match(e, /T1: mức Cao thiếu bằng chứng/);
    assert.match(e, /T2: KN\/TĐ phải là 1–3/);
  });

  test("không có bảng → lỗi; rủi ro chấp nhận chưa điền người xác nhận → cảnh báo", () => {
    assert.match(checkThreats("# rỗng", yes).errors.join(), /không đọc được hàng/);
    const w = checkThreats(
      HEAD + row("T1", 1, 1, "Thấp", "accept", "") + "- T1 — x; người xác nhận: `<chủ dự án điền>`\n",
      yes,
    );
    assert.deepEqual(w.warnings, ["T1: rủi ro chấp nhận chưa có người xác nhận (mục 6) — việc chủ dự án"]);
  });

  test("THREAT-MODEL thật của repo: không lỗi, ≥ 1 mối đe doạ Cao", () => {
    const r = checkThreats(readFileSync("docs/THREAT-MODEL.md", "utf8"), existsSync);
    assert.deepEqual(r.errors, []);
    assert.ok(r.high >= 1);
  });
});
