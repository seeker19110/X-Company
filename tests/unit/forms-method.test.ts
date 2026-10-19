// Hàng rào (ZAP 10024 qua https — staging:drill, T-055): <form> thiếu method="post" bị trình duyệt gửi bằng GET khi JS chưa chạy
// (chưa hydrate, JS lỗi/tắt) → mật khẩu, email, nội dung liên hệ nằm trên URL (lịch sử, log proxy, Referer). Mọi form phải POST.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? tsxFiles(p) : e.name.endsWith(".tsx") ? [p] : [];
  });
}

/** Thẻ <form …> (đến `>` đầu tiên không nằm trong `{…}`) thiếu method="post". */
export function formsWithoutPost(src: string): string[] {
  const bad: string[] = [];
  for (const m of src.matchAll(/<form\b/g)) {
    let depth = 0;
    let i = m.index! + 5;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    const tag = src.slice(m.index!, i + 1);
    if (!/\bmethod="post"/i.test(tag)) bad.push(tag.replace(/\s+/g, " ").slice(0, 80));
  }
  return bad;
}

describe("form luôn POST (không lộ dữ liệu lên URL khi chưa có JS)", () => {
  test("bộ kiểm: bắt form thiếu method, bỏ qua `>` trong biểu thức JSX", () => {
    assert.equal(formsWithoutPost('<form onSubmit={(e) => a > b} className="x">').length, 1);
    assert.deepEqual(formsWithoutPost('<form method="post" onSubmit={(e) => a > b}>'), []);
    assert.equal(formsWithoutPost('<form method="get">').length, 1);
    assert.deepEqual(formsWithoutPost("const x = 1;"), []);
  });

  test('mọi <form> trong app/ có method="post"', () => {
    const bad = tsxFiles("app").flatMap((f) =>
      formsWithoutPost(readFileSync(f, "utf8")).map((t) => `${f}: ${t}`),
    );
    assert.deepEqual(bad, []);
  });
});
