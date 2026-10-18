import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { computeProgress, type LeafInput } from "../../lib/work/progress.ts";

const T = (status: string, reportedPct = 0, dueDate: string | null = null) => ({
  status,
  reportedPct,
  dueDate,
});

describe("computeProgress (SPEC-work, AT10)", () => {
  test("S-WK-03: lá 20/30/50 nghiệm thu 100%/50%/0% → 35%", () => {
    const leaves: LeafInput[] = [
      { workPackageId: "a", weight: 20, tasks: [T("done")] },
      { workPackageId: "b", weight: 30, tasks: [T("done"), T("in_progress", 80)] },
      { workPackageId: "c", weight: 50, tasks: [T("todo")] },
    ];
    const p = computeProgress(leaves, "2026-10-18");
    assert.equal(p.acceptedPct, 35);
    // Báo cáo: a 100%, b (100+80)/2 = 90%, c 0% → 20 + 27 + 0 = 47.
    assert.equal(p.reportedPct, 47);
  });

  test("chia nhỏ việc trong một lá không vượt trọng số lá; việc huỷ không tính hoàn thành", () => {
    const one = computeProgress(
      [
        { workPackageId: "b", weight: 30, tasks: [T("done"), T("todo")] },
        { workPackageId: "c", weight: 70, tasks: [T("todo")] },
      ],
      "2026-10-18",
    );
    // Tách việc chưa làm thành 3 việc nhỏ, 1 việc xong: tỷ lệ lá theo số việc, đóng góp ≤ 30.
    const split = computeProgress(
      [
        { workPackageId: "b", weight: 30, tasks: [T("done"), T("done"), T("todo"), T("todo")] },
        { workPackageId: "c", weight: 70, tasks: [T("todo")] },
      ],
      "2026-10-18",
    );
    assert.equal(one.acceptedPct, 15);
    assert.equal(split.acceptedPct, 15);
    const allDone = computeProgress(
      [
        { workPackageId: "b", weight: 30, tasks: Array.from({ length: 9 }, () => T("done")) },
        { workPackageId: "c", weight: 70, tasks: [T("todo")] },
      ],
      "x",
    );
    assert.equal(allDone.acceptedPct, 30, "tối đa bằng trọng số lá");
    const cancelled = computeProgress(
      [{ workPackageId: "b", weight: 10, tasks: [T("cancelled"), T("todo")] }],
      "x",
    );
    assert.equal(cancelled.acceptedPct, 0);
    const onlyCancelled = computeProgress(
      [{ workPackageId: "b", weight: 10, tasks: [T("cancelled"), T("done")] }],
      "x",
    );
    assert.equal(onlyCancelled.acceptedPct, 100, "huỷ bị loại khỏi mẫu số, không phải tử số");
  });

  test("tiến độ kế hoạch theo hạn ≤ hôm nay; ba con số tách nhau", () => {
    const p = computeProgress(
      [
        {
          workPackageId: "a",
          weight: 1,
          tasks: [T("in_progress", 50, "2026-10-01"), T("todo", 0, "2026-11-01"), T("todo", 0, null)],
        },
      ],
      "2026-10-18",
    );
    assert.equal(p.plannedPct, 33.33);
    assert.equal(p.reportedPct, 16.67);
    assert.equal(p.acceptedPct, 0);
  });

  test("ca biên: không có lá/trọng số → null (không phải 0); lá không có việc → 0; trọng số 0 bị bỏ", () => {
    assert.deepEqual(computeProgress([], "x").acceptedPct, null);
    assert.equal(
      computeProgress([{ workPackageId: "a", weight: 0, tasks: [T("done")] }], "x").acceptedPct,
      null,
    );
    const p = computeProgress(
      [
        { workPackageId: "a", weight: 5, tasks: [] },
        { workPackageId: "b", weight: 5, tasks: [T("done")] },
      ],
      "x",
    );
    assert.equal(p.acceptedPct, 50);
    assert.equal(p.leaves.length, 2);
  });
});
