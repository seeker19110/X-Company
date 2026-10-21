/* eslint-disable @typescript-eslint/strict-boolean-expressions -- giá trị `any` trả về từ script .mjs thuần JS không có khai báo kiểu */
// T-049: phần thống kê/ngân sách của đo tải cục bộ — hàm thuần; ca biên rỗng/null/0, lỗi, thiếu mẫu, báo cáo 5 trường.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import * as S from "../../scripts/lib/perf-stats.mjs";

const run = (o: Record<string, unknown> = {}) => ({
  latencies: [],
  statuses: [],
  networkErrors: 0,
  durationMs: 1000,
  expected: [200],
  ...o,
});

describe("percentile (nearest-rank)", () => {
  test("giá trị chuẩn và biên", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    assert.equal(S.percentile(xs, 50), 50);
    assert.equal(S.percentile(xs, 95), 95);
    assert.equal(S.percentile(xs, 99), 99);
    assert.equal(S.percentile(xs, 100), 100);
    assert.equal(S.percentile([7], 99), 7);
    assert.equal(S.percentile([], 95), null, "rỗng → null chứ không phải 0");
    assert.equal(S.percentile([3, 1, 2], 50), 2, "không đòi mảng đã sắp xếp");
  });
});

describe("summarize", () => {
  test("đếm lỗi: status ngoài tập mong đợi, 5xx, lỗi mạng; RPS không tính lỗi mạng", () => {
    const s = S.summarize(
      run({
        latencies: [10, 20, 30, 40],
        statuses: [200, 200, 404, 500],
        networkErrors: 1,
        durationMs: 2000,
      }),
    );
    assert.equal(s.samples, 5);
    assert.equal(s.errors, 3);
    assert.equal(s.ok, 2);
    assert.equal(s.errorRate, 3 / 5);
    assert.equal(s.rps, 2);
    assert.deepEqual(s.byStatus, { 200: 2, 404: 1, 500: 1 });
  });
  test("5xx luôn là lỗi dù có trong tập mong đợi", () => {
    assert.equal(S.summarize(run({ statuses: [503], latencies: [1], expected: [200, 503] })).errors, 1);
  });
  test("không có mẫu: các số liệu null (không bịa 0)", () => {
    const s = S.summarize(run());
    assert.equal(s.samples, 0);
    assert.equal(s.errorRate, null);
    assert.equal(s.p95, null);
    assert.equal(s.max, null);
  });
  test("thời lượng 0 → rps null", () => {
    assert.equal(S.summarize(run({ durationMs: 0, statuses: [200], latencies: [1] })).rps, null);
  });
});

describe("evaluateBudget", () => {
  const good = S.summarize(run({ latencies: Array(100).fill(100), statuses: Array(100).fill(200) }));
  test("đạt khi trong ngân sách", () => {
    assert.deepEqual(S.evaluateBudget(good, { p95Ms: 200, maxErrorRate: 0.01 }), []);
  });
  test("vượt p95, vượt tỉ lệ lỗi, vượt p99, thiếu RPS", () => {
    assert.equal(S.evaluateBudget(good, { p95Ms: 50, maxErrorRate: 0.01 }).length, 1);
    const bad = S.summarize(
      run({ latencies: Array(100).fill(100), statuses: [...Array(90).fill(200), ...Array(10).fill(500)] }),
    );
    assert.ok(
      S.evaluateBudget(bad, { p95Ms: 200, maxErrorRate: 0.01 }).some((v: string) => v.includes("tỉ lệ lỗi")),
    );
    assert.ok(
      S.evaluateBudget(good, { p95Ms: 200, p99Ms: 10, maxErrorRate: 0.01 }).some((v: string) =>
        v.includes("p99"),
      ),
    );
    assert.ok(
      S.evaluateBudget(good, { p95Ms: 200, maxErrorRate: 0.01, minRps: 1e6 }).some((v: string) =>
        v.includes("RPS"),
      ),
    );
  });
  test("thiếu mẫu hoặc không có số liệu = vi phạm (không xanh giả)", () => {
    const few = S.summarize(run({ latencies: [1, 2], statuses: [200, 200] }));
    assert.ok(
      S.evaluateBudget(few, { p95Ms: 200, maxErrorRate: 0.01 }).some((v: string) => v.includes("mẫu")),
    );
    assert.ok(S.evaluateBudget(S.summarize(run()), { p95Ms: 200, maxErrorRate: 0.01 }).length >= 2);
  });
  test("maxOf", () => {
    assert.equal(S.maxOf([]), null);
    assert.equal(S.maxOf([3, 9, 2]), 9);
    assert.equal(S.maxOf([0]), 0);
  });
});

describe("renderLoadReport", () => {
  test("có đủ 5 trường QA-PERF-006, nhãn faithful-fixture và mục Không chứng minh", () => {
    const sum = S.summarize(run({ latencies: Array(60).fill(5), statuses: Array(60).fill(200) }));
    const row = {
      name: "k1",
      description: "d",
      connections: 4,
      durationLabel: "10s",
      warmupLabel: "2s",
      summary: sum,
      dbConnMax: 5,
      budget: { p95Ms: 100, maxErrorRate: 0.01 },
      budgetWhy: "vì",
      violations: [],
      expected: [200],
    };
    const meta = {
      date: "2026-10-19",
      commit: "abc123",
      env: "E",
      device: "D",
      load: "L",
      slo: "S",
      budgetNotes: ["n"],
      notProven: ["CWV p75 thực địa"],
    };
    const md = S.renderLoadReport(meta, [row]);
    for (const f of ["| Commit |", "| Môi trường |", "| Thiết bị/mạng |", "| Tải |", "| Ngày |"])
      assert.ok(md.includes(f), f);
    assert.ok(
      md.includes("faithful-fixture") && md.includes("## Không chứng minh") && md.includes("**ĐẠT**"),
    );
    const bad = S.renderLoadReport(meta, [{ ...row, violations: ["p95 > 100"] }]);
    assert.ok(bad.includes("**VƯỢT**") && bad.includes("VƯỢT ngân sách"));
  });
});

// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import * as PU from "../../scripts/lib/perf-users.mjs";

describe("nhân viên của kịch bản ghi chấm công (AUD-XFEAT-004)", () => {
  test("usersNeeded: chia đều dưới trần mỗi người; ca biên 0 và trần không hợp lệ", () => {
    assert.equal(PU.usersNeeded(0, 60), 0);
    assert.equal(PU.usersNeeded(60, 60), 1);
    assert.equal(PU.usersNeeded(61, 60), 2);
    assert.equal(PU.usersNeeded(-5, 60), 0);
    assert.throws(() => PU.usersNeeded(10, 0), RangeError);
  });
  test("đủ người cho 400 rps × (12 s đo + 3 s khởi động) mà không ai vượt 60 lượt/phút", () => {
    assert.ok(PU.PERF_ATTENDANCE_USERS >= PU.usersNeeded(400 * 15, 60), String(PU.PERF_ATTENDANCE_USERS));
    assert.equal(PU.perfAttendanceEmail(7), "perf-att-7@e2e.test");
  });
});

describe("kịch bản chốt kỳ (AUD-PERF-001)", () => {
  const budget = { maxMs: 10_000, maxQueries: 50 };
  const ok = { code: "K1", lines: 6200, expectedLines: 6200, ms: 4000, queries: 25 };
  test("đạt khi mọi lần chốt trong ngân sách và đủ dòng", () => {
    assert.deepEqual(S.evaluateLockBudget([ok, { ...ok, code: "K2" }], budget), []);
  });
  test("vượt thời gian, vượt số câu SQL, thiếu dòng, lỗi — mỗi loại một vi phạm", () => {
    assert.deepEqual(S.evaluateLockBudget([{ ...ok, ms: 10_001 }], budget), ["K1: 10001 ms > 10000 ms"]);
    assert.deepEqual(S.evaluateLockBudget([{ ...ok, queries: 51 }], budget), ["K1: 51 câu SQL > 50"]);
    assert.deepEqual(S.evaluateLockBudget([{ ...ok, lines: 6199 }], budget), [
      "K1: 6199 dòng ≠ 6200 mong đợi",
    ]);
    assert.deepEqual(S.evaluateLockBudget([{ ...ok, ms: null, lines: 0, error: "khoá" }], budget), [
      "K1: lỗi khoá",
    ]);
  });
  test("biên: đúng ngưỡng là đạt; ms null hoặc không có lần chốt nào là vi phạm (không xanh giả)", () => {
    assert.deepEqual(S.evaluateLockBudget([{ ...ok, ms: 10_000, queries: 50 }], budget), []);
    assert.equal(S.evaluateLockBudget([{ ...ok, ms: null }], budget).length, 1);
    assert.equal(S.evaluateLockBudget([], budget).length, 1);
  });
  test("cỡ kịch bản: 200 nhân viên × kỳ 31 ngày, kỳ ở quá khứ (không chạm kỳ hiện tại của kịch bản ghi)", () => {
    assert.equal(PU.PERIOD_EMPLOYEES, 200);
    assert.ok(PU.PERIOD_MONTHS.length >= 3);
    for (const m of PU.PERIOD_MONTHS as { start: string; end: string; days: number }[]) {
      assert.equal(m.days, 31);
      assert.equal((Date.parse(m.end) - Date.parse(m.start)) / 86_400_000 + 1, m.days);
      assert.ok(m.end < "2026-01-01");
    }
  });
});

// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import * as PH from "../../scripts/lib/prod-harness.mjs";

describe("báo cáo vào repo chỉ từ cây sạch (AUD-PERF-003)", () => {
  const root = "/repo";
  test("cây bẩn + ghi vào repo (., docs, đường dẫn tuyệt đối trong repo) → từ chối", () => {
    for (const dir of [".", "docs", "/repo", "/repo/docs/perf"])
      assert.match(String(PH.repoReportRefusal("abc+dirty", dir, root)), /chưa commit/, dir);
  });
  test("cây sạch, thư mục tạm (rỗng/undefined) hoặc ngoài repo → cho ghi", () => {
    assert.equal(PH.repoReportRefusal("abc", ".", root), null);
    assert.equal(PH.repoReportRefusal("abc+dirty", undefined, root), null);
    assert.equal(PH.repoReportRefusal("abc+dirty", "", root), null);
    assert.equal(PH.repoReportRefusal("abc+dirty", "/tmp/x", root), null);
    assert.equal(PH.repoReportRefusal("abc+dirty", "../ngoai", root), null);
    assert.equal(
      PH.repoReportRefusal("abc+dirty", "/repo-khac", root),
      null,
      "tiền tố trùng không phải trong repo",
    );
  });
});
