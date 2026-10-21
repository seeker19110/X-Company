// T-056: danh sách phân hệ của nhãn trang RUM phải ĐÚNG BẰNG các thư mục con của app/app/(secure)/ — thêm/bớt phân hệ mà quên
// cập nhật lib/rum/page.pure.ts thì đỏ (nhãn sẽ rơi vào '/app/*' và mất độ phân giải theo trang).
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { KNOWN_APP_SECTIONS, pageLabel } from "../../lib/rum/page.pure.ts";

const SECURE = path.resolve(import.meta.dirname, "../../app/app/(secure)");

describe("KNOWN_APP_SECTIONS", () => {
  test("bằng các thư mục con của app/app/(secure)/ (so với hệ thống tệp)", () => {
    const dirs = readdirSync(SECURE, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !/^[(_@[]/.test(e.name))
      .map((e) => e.name)
      .sort();
    assert.deepEqual([...KNOWN_APP_SECTIONS].sort(), dirs);
  });
  test("không trùng, không rỗng, mỗi phân hệ tự ánh xạ chính nó", () => {
    assert.equal(new Set(KNOWN_APP_SECTIONS).size, KNOWN_APP_SECTIONS.length);
    assert.ok(KNOWN_APP_SECTIONS.length > 0);
    for (const s of KNOWN_APP_SECTIONS) assert.equal(pageLabel(`/app/${s}`), `/app/${s}`);
  });
});
