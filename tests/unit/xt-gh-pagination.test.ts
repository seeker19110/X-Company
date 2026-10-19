import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, test } from "node:test";

// merge-check (xt.py) phân trang REST tự làm bằng `page=N` — `gh --paginate` đi theo Link tới `repositories/{id}/…` mà
// proxy của phiên Claude Code trả 403 (FB-001). Test chạy hàm thật với `gh` giả: không cần mạng.
const PY = `
import json, re, subprocess, sys, types
sys.path.insert(0, ".xtemplates/scripts")
import xt

calls = []
def fake_run(cmd, **kw):
    calls.append(cmd[:])
    assert "--paginate" not in cmd, "không được dùng gh --paginate"
    path = cmd[-1]
    m = re.search(r"[?&]page=(\\d+)", path)
    page = int(m.group(1)) if m else 1
    per = 5
    total = int(sys.argv[1])
    lo, hi = (page - 1) * per, min(page * per, total)
    items = list(range(lo, hi))
    body = {"check_runs": [{"id": i} for i in items]} if "check-runs" in path else items
    return types.SimpleNamespace(returncode=0, stdout=json.dumps(body), stderr="")
xt.subprocess.run = fake_run
path = sys.argv[2]
pages = xt._gh_api(path, True)
print(json.dumps({"pages": len(pages), "calls": len(calls),
  "n": sum(xt._gh_page_len(p) for p in pages)}))
`;

function run(total: number, path: string) {
  const r = spawnSync("python3", ["-I", "-c", PY, String(total), path], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout) as { pages: number; calls: number; n: number };
}

describe("xt.py _gh_api phân trang tự làm (FB-001)", () => {
  test("12 phần tử, per_page=5 → 3 trang, không dùng --paginate", () => {
    assert.deepEqual(run(12, "repos/o/r/pulls/1/files?per_page=5"), { pages: 3, calls: 3, n: 12 });
  });
  test("ca biên: đúng bội số per_page → thêm một trang rỗng rồi dừng", () => {
    assert.deepEqual(run(10, "repos/o/r/pulls/1/files?per_page=5"), { pages: 3, calls: 3, n: 10 });
  });
  test("rỗng và ít hơn một trang → dừng ngay", () => {
    assert.deepEqual(run(0, "repos/o/r/pulls/1/reviews?per_page=5"), { pages: 1, calls: 1, n: 0 });
    assert.deepEqual(run(3, "repos/o/r/pulls/1/reviews?per_page=5"), { pages: 1, calls: 1, n: 3 });
  });
  test("check-runs (object chứa mảng) cũng phân trang", () => {
    assert.deepEqual(run(7, "repos/o/r/commits/abc/check-runs?per_page=5"), { pages: 2, calls: 2, n: 7 });
  });
});
