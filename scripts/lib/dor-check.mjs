// WF-TEAM-003: Definition of Ready cho task CÒN MỞ trong docs/autopilot/PLAN*.md — trước khi bắt đầu, task phải có
// Gate máy kiểm (`— Gate: `<lệnh>``), phạm vi tệp (`files:`), và không còn câu hỏi mở. Task đã tick `[x]` không xét
// (lịch sử). Gọi từ check:docs.

const OPEN_TASK = /^- \[ \] `(T-\d+)` (.*)$/;
const GATE = /— Gate: `[^`]+`/;
const FILES = /\bfiles:\s*[^;)\s]/;
// Câu hỏi mở: `[?]`, `TBD`, `TODO`, `(chưa rõ…)`, `???` — task chưa đủ rõ để làm.
const OPEN_QUESTION = /\[\?\]|\bTBD\b|\bTODO\b|\(chưa rõ|\?\?\?/;

/**
 * @param {string} text nội dung một tệp PLAN
 * @param {string} file đường dẫn để báo lỗi
 * @returns {string[]} lỗi DoR
 */
export function checkDor(text, file) {
  const errors = [];
  for (const [i, line] of text.split("\n").entries()) {
    const m = OPEN_TASK.exec(line);
    if (!m) continue;
    const [, id, rest] = m;
    const where = `${file}:${i + 1} ${id}`;
    if (!GATE.test(rest)) errors.push(`${where}: thiếu "— Gate: \`<lệnh>\`" (DoR, WF-TEAM-003)`);
    if (!FILES.test(rest)) errors.push(`${where}: thiếu phạm vi "files: …" (DoR, WF-TEAM-003)`);
    if (OPEN_QUESTION.test(rest))
      errors.push(`${where}: còn câu hỏi mở ([?]/TBD/TODO/chưa rõ) — chốt trước khi làm`);
  }
  return errors;
}
