// check:github — ruleset trên GitHub khớp `.github/rulesets/main.json` (BASE-REPO-008, BASE-GATE-007/019, WF-GIT-002).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import * as GS from "../../scripts/check-github-settings.mjs";

const file = JSON.parse(readFileSync(".github/rulesets/main.json", "utf8"));
const has = (out: string[], pred: (e: string) => boolean): boolean => out.some(pred);
const clone = () => JSON.parse(JSON.stringify(file));

describe("diffRuleset", () => {
  test("khớp kể cả khi GitHub trả khoá theo thứ tự khác", () => {
    const live = clone();
    live.conditions = {
      ref_name: { exclude: file.conditions.ref_name.exclude, include: file.conditions.ref_name.include },
    };
    live.rules = [...live.rules].reverse();
    assert.deepEqual(GS.diffRuleset(live, file), []);
  });

  test("chưa import → lỗi nêu cách sửa", () => {
    assert.match(GS.diffRuleset(null, file)[0], /chưa có ruleset/);
  });

  test("bypass, rule thiếu, tham số lệch, enforcement đều bị bắt", () => {
    const live = clone();
    live.enforcement = "evaluate";
    live.bypass_actors = [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" }];
    live.rules = live.rules.filter((r: { type: string }) => r.type !== "non_fast_forward");
    const pr = live.rules.find((r: { type: string }) => r.type === "pull_request");
    pr.parameters.required_review_thread_resolution = false;
    const out: string[] = GS.diffRuleset(live, file);
    assert.equal(out.length, 4, out.join("\n"));
    assert.ok(has(out, (e) => e.startsWith("rule non_fast_forward: file có, GitHub thiếu")));
    assert.ok(has(out, (e) => e === "rule pull_request: tham số lệch"));
  });
});

describe("strictOrPushMain (BASE-GATE-007 cách b)", () => {
  const nonStrict = {
    rules: [{ type: "required_status_checks", parameters: { strict_required_status_checks_policy: false } }],
  };
  test("strict=false cần CI chạy trên push vào main", () => {
    assert.deepEqual(
      GS.strictOrPushMain(nonStrict, "on:\n  push:\n    branches: [main]\n  pull_request:\n"),
      [],
    );
    assert.equal(GS.strictOrPushMain(nonStrict, "on:\n  pull_request:\n    branches: [main]\n").length, 1);
  });
  test("strict=true đủ; thiếu required_status_checks → lỗi; ci.yml thật đạt", () => {
    const strict = {
      rules: [{ type: "required_status_checks", parameters: { strict_required_status_checks_policy: true } }],
    };
    assert.deepEqual(GS.strictOrPushMain(strict, ""), []);
    assert.equal(GS.strictOrPushMain({ rules: [] }, "").length, 1);
    assert.deepEqual(GS.strictOrPushMain(file, readFileSync(".github/workflows/ci.yml", "utf8")), []);
  });
});
