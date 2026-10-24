// Ghi chú `— Kiểm:` sai dạng trong blueprint (vd thêm backtick sau lệnh): `xt.py loop verify` trả exit 2 mà không chạy
// lệnh. Dùng chính `xt.blueprint_checks` của khung để nhận dạng — không tự viết lại regex, khỏi lệch với máy verify.
import { spawnSync } from "node:child_process";

const PY =
  "import sys,json;sys.path.insert(0,sys.argv[1]);import xt;from pathlib import Path;" +
  "print(json.dumps([c['id'] for c in xt.blueprint_checks(Path(sys.argv[2]))['checks'] if not c['cmd']]))";

/** ID các mục `[x]` có ghi chú `— Kiểm:` mà lệnh rỗng; không đọc được kết quả → ném (đỏ, không âm tính giả). */
export function malformedCheckIds(xtDir, blueprintPath) {
  const r = spawnSync("python3", ["-c", PY, xtDir, blueprintPath], { encoding: "utf8" });
  let ids;
  try {
    ids = JSON.parse(r.stdout);
  } catch {
    ids = null;
  }
  if (!Array.isArray(ids))
    throw new Error(
      `không đọc được lệnh \`— Kiểm:\` từ xt.blueprint_checks (exit ${r.status}): ${r.stderr.trim()}`,
    );
  return ids;
}
