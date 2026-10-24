import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { getTasks, postTaskAction } from "../../lib/work/routes.ts";
import {
  getApprovals,
  postAdjustment,
  postDecision,
  postLeave,
  postOt,
} from "../../lib/attendance/request-routes.ts";
import { loadActor } from "../../lib/authz/load.ts";
import { withTx } from "../../lib/db/index.ts";
import { assignEmployment } from "../../lib/org/index.ts";
import { addMember, createProject, createTask } from "../../lib/work/tasks.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { cookieFrom, req, seedCompany, seedUser, setTestEnv, loginThrough } from "../helpers/fixtures.ts";

setTestEnv();
interface S {
  cookie: string;
  csrf: string;
}
async function login(email: string): Promise<S> {
  const r = await loginThrough(email);
  return { cookie: cookieFrom(r), csrf: (await r.json()).csrf_token };
}
const post = (h: (r: Request) => Promise<Response>, s: S, path: string, body: unknown) =>
  h(req("POST", path, { cookie: s.cookie, csrf: s.csrf, body }));

describe("API nội bộ: công việc, đơn từ, phê duyệt (T-019)", () => {
  let db: TestDb;
  let emp: S, lead: S, pm: S, rev: S, other: S;
  let taskId: string, leaveType: string, empEmployeeId: string;

  before(async () => {
    db = await freshDb();
    const org = await seedCompany();
    const e = await seedUser(org.companyId, { grants: [{ role: "employee", scopeType: "self" }] });
    const l = await seedUser(org.companyId, {
      grants: [{ role: "team_lead", scopeType: "department", scopeId: org.deptId }],
    });
    const p = await seedUser(org.companyId);
    const r = await seedUser(org.companyId);
    const o = await seedUser(org.companyId, {
      grants: [{ role: "team_lead", scopeType: "department", scopeId: org.otherDeptId }],
    });
    const x = await seedUser(org.companyId, { grants: [{ role: "executive", scopeType: "company" }] });
    empEmployeeId = e.employeeId!;
    await withTx((tx) =>
      assignEmployment(tx, { userId: null }, org.companyId, e.employeeId!, {
        departmentId: org.deptId,
        validFrom: "2026-01-01",
      }),
    );
    const exec = (await loadActor(db.app, x.userId))!;
    const pmA = (await loadActor(db.app, p.userId))!;
    const projectId = await withTx((tx) =>
      createProject(tx, exec, { code: "A", name: "Dự án A", managerEmployeeId: p.employeeId! }),
    );
    await withTx(async (tx) => {
      await addMember(tx, pmA, projectId, e.employeeId!);
      await addMember(tx, pmA, projectId, r.employeeId!);
    });
    taskId = await withTx((tx) =>
      createTask(tx, pmA, {
        projectId,
        title: "Việc 1",
        responsibleEmployeeId: e.employeeId!,
        reviewerEmployeeId: r.employeeId!,
        acceptanceCriteria: "ok",
      }),
    );
    leaveType = (
      await db.admin.query(
        "INSERT INTO leave_type (company_id, code, name, requires_balance) VALUES ($1, 'KL', 'Không lương', false) RETURNING id",
        [org.companyId],
      )
    ).rows[0].id;
    [emp, lead, pm, rev, other] = [
      await login(e.email),
      await login(l.email),
      await login(p.email),
      await login(r.email),
      await login(o.email),
    ];
  });
  after(async () => {
    await db.close();
  });

  test("không phiên → 401 trên mọi route; thiếu CSRF → 403", async () => {
    assert.equal((await getTasks(req("GET", "/api/app/tasks"))).status, 401);
    assert.equal((await getApprovals(req("GET", "/api/app/approvals"))).status, 401);
    assert.equal((await postLeave(req("POST", "/api/app/leave-requests", { body: {} }))).status, 401);
    assert.equal(
      (await postLeave(req("POST", "/api/app/leave-requests", { cookie: emp.cookie, body: {} }))).status,
      403,
    );
  });

  test("việc của tôi + chuyển trạng thái qua API (version, quyền theo quan hệ)", async () => {
    const list = await (await getTasks(req("GET", "/api/app/tasks", { cookie: emp.cookie }))).json();
    assert.deepEqual(
      list.items.map((t: { id: string; role: string }) => [t.id, t.role]),
      [[taskId, "responsible"]],
    );
    const s = await post(postTaskAction, emp, `/api/app/tasks/${taskId}/start`, { version: 1 });
    assert.equal(s.status, 200);
    assert.equal((await s.json()).version, 2);
    assert.equal(
      (await post(postTaskAction, emp, `/api/app/tasks/${taskId}/start`, { version: 1 })).status,
      409,
    );
    assert.equal(
      (await post(postTaskAction, other, `/api/app/tasks/${taskId}/cancel`, { version: 2, reason: "x" }))
        .status,
      404,
    );
    assert.equal(
      (await post(postTaskAction, emp, `/api/app/tasks/${taskId}/nhay`, { version: 2 })).status,
      404,
    );
    await post(postTaskAction, emp, `/api/app/tasks/${taskId}/submit`, { version: 2 });
    const revList = await (await getTasks(req("GET", "/api/app/tasks", { cookie: rev.cookie }))).json();
    assert.deepEqual(
      revList.items.map((t: { role: string }) => t.role),
      ["reviewer"],
    );
    assert.equal(
      (await post(postTaskAction, emp, `/api/app/tasks/${taskId}/accept`, { version: 3 })).status,
      409,
    );
    assert.equal(
      (await post(postTaskAction, rev, `/api/app/tasks/${taskId}/accept`, { version: 3 })).status,
      200,
    );
    void pm;
  });

  test("đơn nghỉ/OT/sửa công → hộp phê duyệt của trưởng nhóm đúng phạm vi; người khác không thấy; duyệt qua API", async () => {
    const lr = await post(postLeave, emp, "/api/app/leave-requests", {
      leave_type_id: leaveType,
      start_at: "2026-11-02T08:00:00+07:00",
      end_at: "2026-11-02T12:00:00+07:00",
      minutes: 240,
    });
    assert.equal(lr.status, 201);
    const leaveId = (await lr.json()).id;
    const ot = await post(postOt, emp, "/api/app/ot-requests", {
      business_date: "2026-11-03",
      minutes: 60,
      reason: "gấp",
      consent: true,
    });
    assert.equal(ot.status, 201);
    const adj = await post(postAdjustment, emp, "/api/app/adjustments", {
      action: "add_event",
      new_kind: "out",
      new_at: new Date(Date.now() - 86_400_000).toISOString(), // quá khứ gần: đề nghị sửa công không được ở tương lai
      reason: "quên bấm",
    });
    assert.equal(adj.status, 201);
    const inbox = await (
      await getApprovals(req("GET", "/api/app/approvals", { cookie: lead.cookie }))
    ).json();
    assert.deepEqual(inbox.items.map((i: { type: string }) => i.type).sort(), ["adjustment", "leave", "ot"]);
    assert.equal(
      inbox.items.every((i: { employeeId: string }) => i.employeeId === empEmployeeId),
      true,
    );
    assert.equal(
      (await (await getApprovals(req("GET", "/api/app/approvals", { cookie: other.cookie }))).json()).items
        .length,
      0,
    );
    assert.equal(
      (await (await getApprovals(req("GET", "/api/app/approvals", { cookie: emp.cookie }))).json()).items
        .length,
      0,
      "không thấy đơn của chính mình",
    );
    assert.equal(
      (await post(postDecision, other, `/api/app/approvals/leave/${leaveId}/approve`, {})).status,
      403,
    );
    assert.equal(
      (await post(postDecision, lead, `/api/app/approvals/leave/${leaveId}/approve`, {})).status,
      200,
    );
    assert.equal(
      (await post(postDecision, lead, `/api/app/approvals/leave/${leaveId}/approve`, {})).status,
      409,
    );
    assert.equal(
      (await post(postDecision, lead, `/api/app/approvals/xxx/${leaveId}/approve`, {})).status,
      404,
    );
    const denied = await db.admin.query(
      "SELECT count(*)::int AS n FROM audit_event WHERE result = 'denied' AND action = 'attendance.approve'",
    );
    assert.ok(denied.rows[0].n >= 1, "từ chối quyền ở lớp nghiệp vụ có audit");
  });

  test("dữ liệu sai → 400", async () => {
    // Bỏ qua client (như curl): server vẫn validate lại và trả lỗi theo trường (FE-FORM-001).
    const bad = await post(postOt, emp, "/api/app/ot-requests", {
      business_date: "03/11",
      minutes: 60,
      reason: "x",
      consent: true,
    });
    assert.equal(bad.status, 400);
    const badBody = await bad.json();
    assert.deepEqual(
      badBody.fields.map((f: { path: string }) => f.path),
      ["business_date"],
    );
    assert.equal(badBody.fields[0].message, "Vui lòng chọn ngày hợp lệ");
    const noReason = await post(postOt, emp, "/api/app/ot-requests", {
      business_date: "2026-11-03",
      minutes: 60,
      reason: "   ",
      consent: true,
    });
    assert.equal(noReason.status, 400);
    assert.equal((await noReason.json()).fields[0].path, "reason");
    assert.equal(
      (await post(postAdjustment, emp, "/api/app/adjustments", { action: "xoa", reason: "x" })).status,
      400,
    );
  });
});
