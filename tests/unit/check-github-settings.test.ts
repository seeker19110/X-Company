// WF-REL-003: ruleset tag phát hành (.github/rulesets/tags.json) giữ tag `v*` bất biến — cấm xoá/cập nhật/force, không
// ai bỏ qua, không chặn tạo (release-please tạo tag) — và release.yml đính tarball + SHA256SUMS vào GitHub Release.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import * as mod from "../../scripts/check-github-settings.mjs";

const { validateTagRuleset, diffRuleset } = mod as {
  validateTagRuleset: (f: unknown) => string[];
  diffRuleset: (live: unknown, file: unknown) => string[];
};
const tags = JSON.parse(readFileSync(".github/rulesets/tags.json", "utf8")) as Record<string, unknown>;
const clone = () => structuredClone(tags) as { rules: { type: string }[]; [k: string]: unknown };

describe("ruleset tag phát hành (WF-REL-003)", () => {
  test("tags.json của repo hợp lệ và khớp chính nó khi đã import", () => {
    assert.deepEqual(validateTagRuleset(tags), []);
    assert.deepEqual(diffRuleset(tags, tags), []);
  });

  test("thiếu từng rule deletion/update/non_fast_forward → lỗi nêu tên rule", () => {
    for (const t of ["deletion", "update", "non_fast_forward"]) {
      const f = clone();
      f.rules = f.rules.filter((r) => r.type !== t);
      assert.deepEqual(validateTagRuleset(f), [`thiếu rule ${t}`], t);
    }
  });

  test("chặn creation, có bypass, sai target/enforcement/include → mỗi ca một lỗi", () => {
    const f = clone();
    f.rules.push({ type: "creation" });
    f.bypass_actors = [{ actor_type: "RepositoryRole", actor_id: 5 }];
    f.target = "branch";
    f.enforcement = "evaluate";
    f.conditions = { ref_name: { include: ["refs/tags/*"], exclude: [] } };
    const e = validateTagRuleset(f).join("\n");
    for (const re of [/creation/, /bypass_actors/, /target/, /enforcement/, /refs\/tags\/v\*/])
      assert.match(e, re);
  });

  test("chưa import lên GitHub → diffRuleset báo thiếu", () => {
    assert.match(diffRuleset(null, tags).join(), /chưa có ruleset/);
  });

  test("release.yml: job đính asset chỉ chạy khi có bản phát hành, quyền ghi ở job, tarball + SHA256SUMS", () => {
    const y = readFileSync(".github/workflows/release.yml", "utf8");
    assert.match(y, /if: \$\{\{ needs\.release-please\.outputs\.release_created == 'true' \}\}/);
    assert.match(y, /git archive --format=tar\.gz/);
    assert.match(y, /sha256sum .* > SHA256SUMS/);
    assert.match(y, /gh release upload "\$TAG" .*SHA256SUMS/);
    assert.match(y, /^permissions:\n {2}contents: read$/m);
  });
});
