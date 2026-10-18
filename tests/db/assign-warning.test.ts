import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { withTx } from "../../lib/db/index.ts";
import { loadActor } from "../../lib/authz/load.ts";
import type { ActorContext } from "../../lib/authz/index.ts";
import {
  addMember,
  createProject,
  createTask,
  createWorkPackage,
  transitionTask,
} from "../../lib/work/tasks.ts";
import {
  approveBaseline,
  assignmentWarnings,
  projectProgress,
  proposeBaseline,
} from "../../lib/work/progress.ts";
import { AppError } from "../../lib/nen/app-error.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { seedCompany, seedUser } from "../helpers/fixtures.ts";

const isCode = (code: string) => (e: unknown) => e instanceof AppError && e.code === code;

describe("baseline, tiến độ dự án, cảnh báo phân công (T-016)", () => {
  let db: TestDb;
  let pm: ActorContext, dev: ActorContext, rev: ActorContext, exec: ActorContext, exec2: ActorContext;
  let projectId: string, root: string, a: string, b: string, c: string;

  before(async () => {
    db = await freshDb();
    const org = await seedCompany();
    const actorOf = async (u: { userId: string }) => (await loadActor(db.app, u.userId))!;
    pm = await actorOf(await seedUser(org.companyId));
    dev = await actorOf(await seedUser(org.companyId));
    rev = await actorOf(await seedUser(org.companyId));
    exec = await actorOf(
      await seedUser(org.companyId, { grants: [{ role: "executive", scopeType: "company" }] }),
    );
    exec2 = await actorOf(
      await seedUser(org.companyId, { grants: [{ role: "executive", scopeType: "company" }] }),
    );
    projectId = await withTx((tx) =>
      createProject(tx, exec, { code: "P", name: "P", managerEmployeeId: pm.employeeId! }),
    );
    await withTx(async (tx) => {
      await addMember(tx, pm, projectId, dev.employeeId!);
      await addMember(tx, pm, projectId, rev.employeeId!);
    });
    root = await withTx((tx) => createWorkPackage(tx, pm, projectId, { code: "R", name: "Gốc" }));
    a = await withTx((tx) => createWorkPackage(tx, pm, projectId, { code: "A", name: "A", parentId: root }));
    b = await withTx((tx) => createWorkPackage(tx, pm, projectId, { code: "B", name: "B", parentId: root }));
    c = await withTx((tx) => createWorkPackage(tx, pm, projectId, { code: "C", name: "C" }));
  });
  after(async () => {
    await db.close();
  });

  const task = (wp: string, title: string) =>
    withTx((tx) =>
      createTask(tx, pm, {
        projectId,
        workPackageId: wp,
        title,
        responsibleEmployeeId: dev.employeeId!,
        reviewerEmployeeId: rev.employeeId!,
        acceptanceCriteria: "đạt",
      }),
    );
  const finish = async (id: string) => {
    let v = await withTx((tx) => transitionTask(tx, dev, id, "start", { expectedVersion: 1 }));
    v = await withTx((tx) => transitionTask(tx, dev, id, "submit", { expectedVersion: v }));
    await withTx((tx) => transitionTask(tx, rev, id, "accept", { expectedVersion: v }));
  };

  test("trọng số chỉ cho hạng mục lá (cha không cộng trùng); đề xuất cần quyền + lý do", async () => {
    await assert.rejects(
      withTx((tx) => proposeBaseline(tx, pm, projectId, { [root]: 10, [a]: 20 }, "x")),
      isCode("NOT_LEAF"),
    );
    await assert.rejects(
      withTx((tx) => proposeBaseline(tx, pm, projectId, { [a]: -1 }, "x")),
      isCode("VALIDATION"),
    );
    await assert.rejects(
      withTx((tx) => proposeBaseline(tx, pm, projectId, { [a]: 0 }, "x")),
      isCode("VALIDATION"),
    );
    await assert.rejects(
      withTx((tx) => proposeBaseline(tx, pm, projectId, { [a]: 1 }, " ")),
      isCode("VALIDATION"),
    );
    await assert.rejects(
      withTx((tx) => proposeBaseline(tx, dev, projectId, { [a]: 1 }, "x")),
      isCode("FORBIDDEN"),
    );
  });

  test("chưa có baseline duyệt → tiến độ null; duyệt cần lãnh đạo ≠ người đề xuất; ví dụ 20/30/50 → 35%", async () => {
    const t1 = await task(a, "a1");
    const t2 = await task(b, "b1");
    await task(b, "b2");
    await task(c, "c1");
    await finish(t1);
    await finish(t2);
    const bl = await withTx((tx) =>
      proposeBaseline(tx, pm, projectId, { [a]: 20, [b]: 30, [c]: 50 }, "kế hoạch ban đầu"),
    );
    assert.equal((await projectProgress(db.app, projectId, "2026-10-18")).acceptedPct, null);
    await assert.rejects(
      withTx((tx) => approveBaseline(tx, pm, bl)),
      isCode("FORBIDDEN"),
    );
    // Người vừa là quản lý dự án vừa là lãnh đạo không tự duyệt baseline mình đề xuất.
    const p2id = await withTx((tx) =>
      createProject(tx, exec2, { code: "P2", name: "P2", managerEmployeeId: exec2.employeeId! }),
    );
    const leaf = await withTx((tx) => createWorkPackage(tx, exec2, p2id, { code: "L", name: "L" }));
    const own = await withTx((tx) => proposeBaseline(tx, exec2, p2id, { [leaf]: 1 }, "tự đề xuất"));
    await assert.rejects(
      withTx((tx) => approveBaseline(tx, exec2, own)),
      isCode("SELF_APPROVAL"),
    );
    await withTx((tx) => approveBaseline(tx, exec, bl));
    await assert.rejects(
      withTx((tx) => approveBaseline(tx, exec2, bl)),
      isCode("INVALID_STATE"),
    );
    const p = await projectProgress(db.app, projectId, "2026-10-18");
    assert.equal(p.baselineVersion, 1);
    assert.equal(p.acceptedPct, 35);
    // Baseline mới (đổi trọng số) cần duyệt lại; baseline cũ giữ nguyên.
    const bl2 = await withTx((tx) =>
      proposeBaseline(tx, pm, projectId, { [a]: 50, [b]: 50 }, "bỏ hạng mục C"),
    );
    assert.equal((await projectProgress(db.app, projectId, "2026-10-18")).baselineVersion, 1);
    await withTx((tx) => approveBaseline(tx, exec2, bl2));
    const p2 = await projectProgress(db.app, projectId, "2026-10-18");
    assert.deepEqual([p2.baselineVersion, p2.acceptedPct], [2, 75]);
    const old = await db.admin.query("SELECT weights FROM plan_baseline WHERE id = $1", [bl]);
    assert.deepEqual(old.rows[0].weights, { [a]: 20, [b]: 30, [c]: 50 });
    await assert.rejects(db.app.query("DELETE FROM plan_baseline WHERE id = $1", [bl]), /permission denied/);
  });

  test("S-WK-04: giao việc cho người có đơn nghỉ đã duyệt trùng ngày hạn → cảnh báo (giờ VN)", async () => {
    const lt = await db.admin.query(
      "INSERT INTO leave_type (company_id, code, name) VALUES ($1, 'PN', 'Phép') RETURNING id",
      [
        (await db.admin.query("SELECT company_id FROM project WHERE id = $1", [projectId])).rows[0]
          .company_id,
      ],
    );
    await db.admin.query(
      `INSERT INTO leave_request (company_id, employee_id, leave_type_id, start_at, end_at, minutes, status, created_by_user_id, decided_by_user_id)
       SELECT company_id, $1, $2, '2026-11-10T08:00:00+07', '2026-11-10T17:00:00+07', 480, 'approved', $3, $4 FROM project WHERE id = $5`,
      [dev.employeeId, lt.rows[0].id, dev.userId, pm.userId, projectId],
    );
    assert.deepEqual(await assignmentWarnings(db.app, dev.employeeId!, "2026-11-10"), [
      { code: "ASSIGNEE_ON_LEAVE", employeeId: dev.employeeId, date: "2026-11-10" },
    ]);
    assert.deepEqual(await assignmentWarnings(db.app, dev.employeeId!, "2026-11-11"), []);
    assert.deepEqual(await assignmentWarnings(db.app, dev.employeeId!, null), []);
    assert.deepEqual(await assignmentWarnings(db.app, rev.employeeId!, "2026-11-10"), []);
  });
});
