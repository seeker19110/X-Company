import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { withTx } from "../../lib/db/index.ts";
import { loadActor } from "../../lib/authz/load.ts";
import type { ActorContext } from "../../lib/authz/index.ts";
import {
  addDependency,
  addEvidence,
  addMember,
  createProject,
  createTask,
  createWorkPackage,
  dependencyWarnings,
  requireProjectRead,
  transitionTask,
  updateTask,
} from "../../lib/work/tasks.ts";
import { AppError } from "../../lib/nen/app-error.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { seedCompany, seedUser } from "../helpers/fixtures.ts";

const isCode = (code: string) => (e: unknown) => e instanceof AppError && e.code === code;

describe("công việc (T-015, SPEC-work)", () => {
  let db: TestDb;
  let pm: ActorContext, dev: ActorContext, rev: ActorContext, outsider: ActorContext, exec: ActorContext;
  let projectId: string, wp: string, companyId: string;

  const base = () => ({
    projectId,
    workPackageId: wp,
    title: "Lắp tủ điện tầng 3",
    responsibleEmployeeId: dev.employeeId!,
    reviewerEmployeeId: rev.employeeId!,
    acceptanceCriteria: "Đo cách điện đạt, ảnh trước/sau",
    dueDate: "2026-11-30",
  });

  before(async () => {
    db = await freshDb();
    const org = await seedCompany();
    companyId = org.companyId;
    const actorOf = async (u: { userId: string }) => (await loadActor(db.app, u.userId))!;
    pm = await actorOf(
      await seedUser(org.companyId, { grants: [{ role: "project_manager", scopeType: "self" }] }),
    );
    dev = await actorOf(await seedUser(org.companyId));
    rev = await actorOf(await seedUser(org.companyId));
    outsider = await actorOf(await seedUser(org.companyId));
    exec = await actorOf(
      await seedUser(org.companyId, { grants: [{ role: "executive", scopeType: "company" }] }),
    );
    projectId = await withTx((tx) =>
      createProject(tx, exec, { code: "DA01", name: "Dự án A", managerEmployeeId: pm.employeeId! }),
    );
    await withTx(async (tx) => {
      await addMember(tx, pm, projectId, dev.employeeId!);
      await addMember(tx, pm, projectId, rev.employeeId!);
    });
    wp = await withTx((tx) => createWorkPackage(tx, pm, projectId, { code: "HM1", name: "Hệ thống điện" }));
  });
  after(async () => {
    await db.close();
  });

  test("tạo dự án cần quyền; thành viên/quản lý/grant đọc mới thấy dự án, người ngoài nhận 404", async () => {
    await assert.rejects(
      withTx((tx) => createProject(tx, dev, { code: "X", name: "X", managerEmployeeId: dev.employeeId! })),
      isCode("FORBIDDEN"),
    );
    await assert.rejects(
      withTx((tx) =>
        createProject(tx, exec, { code: "DA01", name: "Trùng", managerEmployeeId: pm.employeeId! }),
      ),
      isCode("DUPLICATE"),
    );
    assert.ok((await requireProjectRead(db.app, dev, projectId)).isMember);
    assert.ok((await requireProjectRead(db.app, pm, projectId)).isManager);
    assert.equal(
      (await requireProjectRead(db.app, exec, projectId)).canRead,
      true,
      "lãnh đạo có grant project.read phạm vi công ty",
    );
    await assert.rejects(requireProjectRead(db.app, outsider, projectId), isCode("NOT_FOUND"));
    await assert.rejects(
      withTx((tx) => addMember(tx, dev, projectId, outsider.employeeId!)),
      isCode("FORBIDDEN"),
    );
  });

  test("tạo việc: chỉ quản lý dự án; người được giao phải là thành viên; nghiệm thu cần người + tiêu chí ≠ người làm", async () => {
    await assert.rejects(
      withTx((tx) => createTask(tx, dev, base())),
      isCode("FORBIDDEN"),
    );
    await assert.rejects(
      withTx((tx) => createTask(tx, pm, { ...base(), responsibleEmployeeId: outsider.employeeId! })),
      isCode("NOT_MEMBER"),
    );
    await assert.rejects(
      withTx((tx) => createTask(tx, pm, { ...base(), reviewerEmployeeId: null })),
      isCode("VALIDATION"),
    );
    await assert.rejects(
      withTx((tx) => createTask(tx, pm, { ...base(), acceptanceCriteria: " " })),
      isCode("VALIDATION"),
    );
    await assert.rejects(
      withTx((tx) => createTask(tx, pm, { ...base(), reviewerEmployeeId: dev.employeeId! })),
      isCode("SELF_APPROVAL"),
    );
    const id = await withTx((tx) => createTask(tx, pm, base()));
    const ob = await db.admin.query("SELECT topic, payload FROM outbox_event WHERE payload->>'taskId' = $1", [
      id,
    ]);
    assert.equal(ob.rows[0].topic, "task.assigned");
    assert.deepEqual(new Set(ob.rows[0].payload.employeeIds), new Set([dev.employeeId, rev.employeeId]));
  });

  test("S-WK-01 (AT09): thiếu bằng chứng bắt buộc → 422; có bằng chứng → chờ nghiệm thu; người làm không tự nghiệm thu", async () => {
    const id = await withTx((tx) => createTask(tx, pm, { ...base(), evidenceRequired: true }));
    let v = await withTx((tx) => transitionTask(tx, dev, id, "start", { expectedVersion: 1 }));
    await assert.rejects(
      withTx((tx) => transitionTask(tx, dev, id, "submit", { expectedVersion: v })),
      isCode("EVIDENCE_REQUIRED"),
    );
    await assert.rejects(
      withTx((tx) => addEvidence(tx, outsider, id, { kind: "note", ref: "x" })),
      isCode("NOT_FOUND"),
    );
    await assert.rejects(
      withTx((tx) => addEvidence(tx, dev, id, { kind: "link", ref: "javascript:x" })),
      isCode("VALIDATION"),
    );
    await withTx((tx) =>
      addEvidence(tx, dev, id, { kind: "link", ref: "https://drive.example/anh-truoc-sau" }),
    );
    v = await withTx((tx) => transitionTask(tx, dev, id, "submit", { expectedVersion: v }));
    await assert.rejects(
      withTx((tx) => transitionTask(tx, dev, id, "accept", { expectedVersion: v })),
      isCode("SELF_APPROVAL"),
    );
    await assert.rejects(
      withTx((tx) => transitionTask(tx, pm, id, "accept", { expectedVersion: v })),
      isCode("FORBIDDEN"),
    );
    v = await withTx((tx) => transitionTask(tx, rev, id, "accept", { expectedVersion: v }));
    const st = await db.admin.query("SELECT status, reported_pct FROM task WHERE id = $1", [id]);
    assert.deepEqual(st.rows[0], { status: "done", reported_pct: 100 });
  });

  test("S-WK-02 (AT09): trả lại và mở lại đều cần lý do và có lịch sử", async () => {
    const id = await withTx((tx) => createTask(tx, pm, base()));
    let v = await withTx((tx) => transitionTask(tx, dev, id, "start", { expectedVersion: 1 }));
    v = await withTx((tx) => transitionTask(tx, dev, id, "submit", { expectedVersion: v }));
    await assert.rejects(
      withTx((tx) => transitionTask(tx, rev, id, "return", { expectedVersion: v })),
      isCode("VALIDATION"),
    );
    v = await withTx((tx) =>
      transitionTask(tx, rev, id, "return", { expectedVersion: v, reason: "Thiếu biên bản đo" }),
    );
    v = await withTx((tx) => transitionTask(tx, dev, id, "submit", { expectedVersion: v }));
    v = await withTx((tx) => transitionTask(tx, rev, id, "accept", { expectedVersion: v }));
    v = await withTx((tx) =>
      transitionTask(tx, pm, id, "reopen", { expectedVersion: v, reason: "Khách phản ánh lỗi" }),
    );
    const h = await db.admin.query(
      "SELECT action, from_status, to_status, reason FROM task_history WHERE task_id = $1 ORDER BY id",
      [id],
    );
    assert.deepEqual(
      h.rows.map((r) => [r.action, r.from_status, r.to_status, r.reason]),
      [
        ["create", null, "todo", null],
        ["start", "todo", "in_progress", null],
        ["submit", "in_progress", "awaiting_acceptance", null],
        ["return", "awaiting_acceptance", "in_progress", "Thiếu biên bản đo"],
        ["submit", "in_progress", "awaiting_acceptance", null],
        ["accept", "awaiting_acceptance", "done", null],
        ["reopen", "done", "in_progress", "Khách phản ánh lỗi"],
      ],
    );
    await assert.rejects(
      withTx((tx) => transitionTask(tx, dev, id, "accept", { expectedVersion: v })),
      isCode("SELF_APPROVAL"),
    );
    await assert.rejects(
      withTx((tx) => transitionTask(tx, rev, id, "accept", { expectedVersion: v })),
      isCode("INVALID_STATE"),
    );
  });

  test("S-WK-06: hai người sửa cùng version → người thứ hai 409 VERSION_CONFLICT", async () => {
    const id = await withTx((tx) => createTask(tx, pm, base()));
    await withTx((tx) => updateTask(tx, pm, id, 1, { dueDate: "2026-12-05" }, "khách lùi lịch"));
    await assert.rejects(
      withTx((tx) => updateTask(tx, pm, id, 1, { priority: 1 })),
      (e: unknown) =>
        e instanceof AppError && e.code === "VERSION_CONFLICT" && e.details?.currentVersion === 2,
    );
    await assert.rejects(
      withTx((tx) => transitionTask(tx, dev, id, "start", { expectedVersion: 1 })),
      isCode("VERSION_CONFLICT"),
    );
  });

  test("W3: đổi hạn/người cần lý do, lịch sử trước–sau, báo cả người cũ và người mới; người làm chỉ báo % tiến độ", async () => {
    const id = await withTx((tx) => createTask(tx, pm, base()));
    await assert.rejects(
      withTx((tx) => updateTask(tx, pm, id, 1, { dueDate: "2026-12-10" })),
      isCode("VALIDATION"),
    );
    const extra = (await loadActor(db.app, (await seedUser(companyId)).userId))!;
    await withTx((tx) => addMember(tx, pm, projectId, extra.employeeId!));
    const v = await withTx((tx) =>
      updateTask(
        tx,
        pm,
        id,
        1,
        { responsibleEmployeeId: extra.employeeId!, dueDate: "2026-12-10" },
        "đổi người do quá tải",
      ),
    );
    const h = await db.admin.query(
      "SELECT changes, reason FROM task_history WHERE task_id = $1 AND action = 'update'",
      [id],
    );
    assert.deepEqual(h.rows[0].changes.before, {
      dueDate: "2026-11-30",
      responsibleEmployeeId: dev.employeeId,
    });
    assert.deepEqual(h.rows[0].changes.after, {
      dueDate: "2026-12-10",
      responsibleEmployeeId: extra.employeeId,
    });
    const ob = await db.admin.query(
      "SELECT payload FROM outbox_event WHERE topic = 'task.updated' AND payload->>'taskId' = $1",
      [id],
    );
    assert.equal(ob.rows[0].payload.employeeIds.includes(dev.employeeId), true, "người cũ được báo");
    assert.equal(ob.rows[0].payload.employeeIds.includes(extra.employeeId), true, "người mới được báo");
    await assert.rejects(
      withTx((tx) => updateTask(tx, dev, id, v, { reportedPct: 50 })),
      isCode("FORBIDDEN"),
    );
    const v2 = await withTx((tx) => updateTask(tx, extra, id, v, { reportedPct: 40 }));
    await assert.rejects(
      withTx((tx) => updateTask(tx, extra, id, v2, { dueDate: "2027-01-01" }, "x")),
      isCode("FORBIDDEN"),
    );
    await assert.rejects(
      withTx((tx) => updateTask(tx, extra, id, v2, { reportedPct: 140 })),
      isCode("VALIDATION"),
    );
  });

  test("W5: chặn cần lý do; huỷ chỉ quản lý, cần lý do; việc huỷ không sửa được", async () => {
    const id = await withTx((tx) => createTask(tx, pm, base()));
    await assert.rejects(
      withTx((tx) => transitionTask(tx, dev, id, "block", { expectedVersion: 1 })),
      isCode("VALIDATION"),
    );
    let v = await withTx((tx) =>
      transitionTask(tx, dev, id, "block", { expectedVersion: 1, reason: "chờ vật tư" }),
    );
    const b = await db.admin.query(
      "SELECT blocked_reason, blocked_at IS NOT NULL AS at FROM task WHERE id = $1",
      [id],
    );
    assert.deepEqual(b.rows[0], { blocked_reason: "chờ vật tư", at: true });
    v = await withTx((tx) => transitionTask(tx, dev, id, "unblock", { expectedVersion: v }));
    await assert.rejects(
      withTx((tx) => transitionTask(tx, dev, id, "cancel", { expectedVersion: v, reason: "x" })),
      isCode("FORBIDDEN"),
    );
    v = await withTx((tx) =>
      transitionTask(tx, pm, id, "cancel", { expectedVersion: v, reason: "khách huỷ hạng mục" }),
    );
    await assert.rejects(
      withTx((tx) => updateTask(tx, pm, id, v, { priority: 1 })),
      isCode("INVALID_STATE"),
    );
  });

  test("việc không cần nghiệm thu: gửi là hoàn tất ngay (hoàn thành giản lược), vẫn có lịch sử", async () => {
    const id = await withTx((tx) =>
      createTask(tx, pm, {
        ...base(),
        requiresAcceptance: false,
        reviewerEmployeeId: null,
        acceptanceCriteria: null,
      }),
    );
    let v = await withTx((tx) => transitionTask(tx, dev, id, "start", { expectedVersion: 1 }));
    v = await withTx((tx) => transitionTask(tx, dev, id, "submit", { expectedVersion: v }));
    const st = await db.admin.query("SELECT status FROM task WHERE id = $1", [id]);
    assert.equal(st.rows[0].status, "done");
    assert.equal(v, 3);
  });

  test("phụ thuộc FS: chặn vòng lặp, khác dự án; cảnh báo hạn việc sau trước việc trước", async () => {
    const a = await withTx((tx) => createTask(tx, pm, { ...base(), title: "A", dueDate: "2026-11-20" }));
    const b = await withTx((tx) => createTask(tx, pm, { ...base(), title: "B", dueDate: "2026-11-10" }));
    const c = await withTx((tx) => createTask(tx, pm, { ...base(), title: "C" }));
    await withTx((tx) => addDependency(tx, pm, a, b));
    await withTx((tx) => addDependency(tx, pm, b, c));
    await assert.rejects(
      withTx((tx) => addDependency(tx, pm, c, a)),
      isCode("DEPENDENCY_CYCLE"),
    );
    await assert.rejects(
      withTx((tx) => addDependency(tx, pm, a, a)),
      isCode("DEPENDENCY_CYCLE"),
    );
    await assert.rejects(
      withTx((tx) => addDependency(tx, dev, a, c)),
      isCode("FORBIDDEN"),
    );
    const w = await dependencyWarnings(db.app, projectId);
    assert.deepEqual(
      w.map((x) => [x.predecessor_id, x.successor_id]),
      [[a, b]],
    );
  });
});
