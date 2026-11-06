// XC-GREEN-002: ngân sách CI mỗi PR (số job + tổng trần phút) — vượt, job thiếu timeout-minutes, ngân sách thiếu → đỏ.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import * as mod from "../../scripts/lib/ci-budget.mjs";

type Result = { jobs: number; minutes: number; errors: string[] };
const { checkCiBudget, runsOnPr, workflowJobs } = mod as {
  checkCiBudget: (dir: string, budget: unknown) => Result;
  runsOnPr: (t: string) => boolean;
  workflowJobs: (t: string) => Array<{ job: string; timeout: number | null; copies: number }>;
};

const wf = (on: string, jobs: string) => `name: X\n${on}\njobs:\n${jobs}`;
const job = (name: string, timeout?: number, extra = "") =>
  `  ${name}:\n    runs-on: ubuntu-latest\n${timeout === undefined ? "" : `    timeout-minutes: ${timeout}\n`}${extra}    steps: []\n`;
const dirs: string[] = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const tree = (files: Record<string, string>) => {
  const d = mkdtempSync(path.join(tmpdir(), "xc-cib-"));
  dirs.push(d);
  for (const [f, t] of Object.entries(files)) writeFileSync(path.join(d, f), t);
  return d;
};

describe("ci-budget (XC-GREEN-002)", () => {
  test("runsOnPr: khối / một dòng / mảng / pull_request_target; push+schedule thì không", () => {
    assert.ok(runsOnPr("on:\n  pull_request:\n  push:\n"));
    assert.ok(runsOnPr("on: pull_request\n"));
    assert.ok(runsOnPr("on: [push, pull_request]\n"));
    assert.ok(runsOnPr("on:\n  pull_request_target:\n"));
    assert.equal(runsOnPr("on:\n  push:\n  schedule:\n    - cron: '0 0 * * 1'\n"), false);
  });

  test("workflowJobs: đọc timeout, thiếu → null; matrix nhân số tổ hợp", () => {
    const m = "    strategy:\n      matrix:\n        os: [a, b]\n        node: [22, 24, 26]\n";
    assert.deepEqual(workflowJobs(wf("on: pull_request", job("a", 5) + job("b") + job("c", 10, m))), [
      { job: "a", timeout: 5, copies: 1 },
      { job: "b", timeout: null, copies: 1 },
      { job: "c", timeout: 10, copies: 6 },
    ]);
  });

  test("đúng ngân sách → xanh; vượt số job / vượt phút (biên +1) → đỏ; workflow không chạy trên PR không tính", () => {
    const d = tree({
      "a.yml": wf("on: pull_request", job("x", 10) + job("y", 20)),
      "b.yml": wf("on:\n  schedule:\n    - cron: '0 0 * * 1'", job("z", 300)),
    });
    const exact = checkCiBudget(d, { max_jobs_per_pr: 2, max_minutes_per_pr: 30 });
    assert.deepEqual([exact.jobs, exact.minutes, exact.errors], [2, 30, []]);
    assert.match(
      checkCiBudget(d, { max_jobs_per_pr: 1, max_minutes_per_pr: 30 }).errors.join(),
      /2 job mỗi PR > ngân sách 1/,
    );
    assert.match(
      checkCiBudget(d, { max_jobs_per_pr: 2, max_minutes_per_pr: 29 }).errors.join(),
      /tổng trần 30 phút mỗi PR > ngân sách 29/,
    );
  });

  test("job chạy trên PR thiếu timeout-minutes → đỏ (tính 360 phút mặc định GitHub); ngân sách thiếu/sai kiểu → đỏ", () => {
    const d = tree({ "a.yml": wf("on: pull_request", job("x")) });
    const r = checkCiBudget(d, { max_jobs_per_pr: 5, max_minutes_per_pr: 1000 });
    assert.equal(r.minutes, 360);
    assert.match(r.errors.join(), /a\.yml job x thiếu timeout-minutes/);
    for (const b of [
      undefined,
      {},
      { max_jobs_per_pr: 0, max_minutes_per_pr: 10 },
      { max_jobs_per_pr: "5", max_minutes_per_pr: 10 },
    ])
      assert.match(checkCiBudget(d, b).errors.join(), /thiếu ci\.max_jobs_per_pr/);
  });

  test("repo thật: workflow trong ngân sách perf-budget.json", () => {
    const budget = (JSON.parse(readFileSync("perf-budget.json", "utf8")) as { ci: unknown }).ci;
    const r = checkCiBudget(".github/workflows", budget);
    assert.deepEqual(r.errors, []);
    assert.ok(r.jobs >= 8, String(r.jobs));
  });
});
