import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { withTx } from "../../lib/db/index.ts";
import { loadActor } from "../../lib/authz/load.ts";
import type { ActorContext } from "../../lib/authz/index.ts";
import { assignEmployment } from "../../lib/org/index.ts";
import { recordEvent } from "../../lib/attendance/events.ts";
import {
  addMember,
  createProject,
  createTask,
  createWorkPackage,
  transitionTask,
} from "../../lib/work/tasks.ts";
import { approveBaseline, proposeBaseline } from "../../lib/work/progress.ts";
import { dashboard } from "../../lib/dashboard/index.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { seedCompany, seedUser } from "../helpers/fixtures.ts";

const TODAY = "2026-10-20";
const vn = (d: string, t: string) => new Date(`${d}T${t}:00+07:00`);

describe("dashboard ngoại lệ (T-023, F-012)", () => {
  let db: TestDb;
  let pm: ActorContext,
    dev: ActorContext,
    rev: ActorContext,
    lead: ActorContext,
    outsider: ActorContext,
    exec: ActorContext;
  let projectId: string, overdueTask: string, blockedTask: string, milestoneSoon: string;

  before(async () => {
    db = await freshDb();
    const org = await seedCompany();
    const actorOf = async (u: { userId: string }) => (await loadActor(db.app, u.userId))!;
    exec = await actorOf(
      await seedUser(org.companyId, { grants: [{ role: "executive", scopeType: "company" }] }),
    );
    pm = await actorOf(await seedUser(org.companyId));
    dev = await actorOf(await seedUser(org.companyId));
    rev = await actorOf(await seedUser(org.companyId));
    outsider = await actorOf(await seedUser(org.companyId));
    lead = await actorOf(
      await seedUser(org.companyId, {
        grants: [{ role: "team_lead", scopeType: "department", scopeId: org.deptId }],
      }),
    );
    await withTx((tx) =>
      assignEmployment(tx, { userId: null }, org.companyId, dev.employeeId!, {
        departmentId: org.deptId,
        validFrom: "2026-01-01",
      }),
    );
    projectId = await withTx((tx) =>
      createProject(tx, exec, { code: "D", name: "Dự án D", managerEmployeeId: pm.employeeId! }),
    );
    await withTx(async (tx) => {
      await addMember(tx, pm, projectId, dev.employeeId!);
      await addMember(tx, pm, projectId, rev.employeeId!);
    });
    const wp = await withTx((tx) => createWorkPackage(tx, pm, projectId, { code: "W", name: "W" }));
    const mk = (title: string, due: string) =>
      withTx((tx) =>
        createTask(tx, pm, {
          projectId,
          workPackageId: wp,
          title,
          dueDate: due,
          responsibleEmployeeId: dev.employeeId!,
          reviewerEmployeeId: rev.employeeId!,
          acceptanceCriteria: "ok",
        }),
      );
    overdueTask = await mk("Việc quá hạn", "2026-10-15");
    blockedTask = await mk("Việc bị chặn", "2026-11-30");
    await mk("Việc còn hạn", "2026-10-25");
    await withTx((tx) =>
      transitionTask(tx, dev, blockedTask, "block", { expectedVersion: 1, reason: "chờ vật tư" }),
    );
    await db.admin.query("UPDATE task SET blocked_at = '2026-10-10T03:00:00Z' WHERE id = $1", [blockedTask]);
    const bl = await withTx((tx) => proposeBaseline(tx, pm, projectId, { [wp]: 1 }, "kế hoạch"));
    await withTx((tx) => approveBaseline(tx, exec, bl));
    milestoneSoon = (
      await db.admin.query(
        `INSERT INTO milestone (company_id, project_id, name, due_date, baseline_due_date) VALUES
         ($1, $2, 'Bàn giao giai đoạn 1', '2026-10-24', '2026-10-17'), ($1, $2, 'Bàn giao cuối', '2026-12-20', '2026-12-20') RETURNING id`,
        [org.companyId, projectId],
      )
    ).rows[0].id;
    // Ngoại lệ chấm công của dev (lệch giờ → needs_review) và thiếu giờ ra hôm qua.
    const tpl = await db.admin.query(
      `INSERT INTO shift_template (company_id, code, name, start_time, end_time) VALUES ($1, 'HC', 'HC', '08:00', '17:00') RETURNING id`,
      [org.companyId],
    );
    await db.admin.query(
      "INSERT INTO shift_assignment (company_id, employee_id, business_date, shift_template_id) VALUES ($1, $2, '2026-10-19', $3)",
      [org.companyId, dev.employeeId, tpl.rows[0].id],
    );
    const actor = { userId: dev.userId, companyId: dev.companyId, employeeId: dev.employeeId! };
    await recordEvent(
      db.app,
      actor,
      { idempotencyKey: randomUUID(), kind: "in", deviceTime: vn("2026-10-19", "08:00"), source: "gps" },
      vn("2026-10-19", "08:00"),
    );
    await recordEvent(
      db.app,
      actor,
      { idempotencyKey: randomUUID(), kind: "out", deviceTime: vn("2026-10-18", "08:00"), source: "gps" },
      vn("2026-10-18", "09:00"),
    );
  });
  after(async () => {
    await db.close();
  });

  test("quản lý dự án thấy việc quá hạn, việc bị chặn lâu, mốc nguy cơ trễ — mỗi mục có người xử lý + hành động", async () => {
    const d = await dashboard(db.app, pm, TODAY);
    const codes = d.alerts.map((a) => [a.code, a.objectId]);
    assert.deepEqual(
      codes.filter(([c]) => c === "TASK_OVERDUE"),
      [["TASK_OVERDUE", overdueTask]],
    );
    assert.deepEqual(
      codes.filter(([c]) => c === "TASK_BLOCKED_LONG"),
      [["TASK_BLOCKED_LONG", blockedTask]],
    );
    assert.deepEqual(
      codes.filter(([c]) => c === "MILESTONE_AT_RISK"),
      [["MILESTONE_AT_RISK", milestoneSoon]],
    );
    for (const a of d.alerts) {
      assert.ok(a.ownerEmployeeId, `${a.code} có người xử lý`);
      assert.ok(a.nextAction.length > 5, `${a.code} có hành động tiếp theo`);
    }
    assert.equal(d.alerts.find((a) => a.code === "TASK_OVERDUE")!.ownerEmployeeId, dev.employeeId);
    assert.equal(d.alerts.find((a) => a.code === "MILESTONE_AT_RISK")!.ownerEmployeeId, pm.employeeId);
    // PM không thấy ngoại lệ chấm công (không có quyền duyệt công — R4).
    assert.ok(!d.alerts.some((a) => a.code === "ATTENDANCE_NEEDS_REVIEW" || a.code === "MISSING_CHECKOUT"));
  });

  test("bảng mốc bàn giao tách riêng, có độ trượt so với baseline", async () => {
    const d = await dashboard(db.app, pm, TODAY);
    assert.deepEqual(
      d.milestones.map((m) => [m.name, m.dueDate, m.slipDays, m.achieved]),
      [
        ["Bàn giao giai đoạn 1", "2026-10-24", 7, false],
        ["Bàn giao cuối", "2026-12-20", 0, false],
      ],
    );
  });

  test("trưởng nhóm thấy ngoại lệ chấm công trong phạm vi (cần xác minh, thiếu giờ ra); người ngoài không thấy gì", async () => {
    const d = await dashboard(db.app, lead, TODAY);
    const codes = d.alerts.map((a) => a.code).sort();
    assert.deepEqual(codes, ["ATTENDANCE_NEEDS_REVIEW", "MISSING_CHECKOUT"]);
    assert.deepEqual(await dashboard(db.app, outsider, TODAY), { alerts: [], milestones: [] });
    // Nhân viên không thấy ngoại lệ chấm công của chính mình ở dashboard quản lý.
    assert.ok(
      !(await dashboard(db.app, dev, TODAY)).alerts.some((a) => a.code === "ATTENDANCE_NEEDS_REVIEW"),
    );
  });
});
