import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { withTx } from "../../lib/db/index.ts";
import { loadActor } from "../../lib/authz/load.ts";
import type { ActorContext } from "../../lib/authz/index.ts";
import { assignEmployment } from "../../lib/org/index.ts";
import { recordEvent } from "../../lib/attendance/events.ts";
import { decideOt, requestOt } from "../../lib/attendance/ot.ts";
import { addMember, createProject, createTask, transitionTask } from "../../lib/work/tasks.ts";
import { decideTimesheet, explainDay, logTime, reconcile } from "../../lib/work/timesheet.ts";
import { AppError } from "../../lib/nen/app-error.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { seedCompany, seedUser } from "../helpers/fixtures.ts";

const isCode = (code: string) => (e: unknown) => e instanceof AppError && e.code === code;
const vn = (d: string, t: string) => new Date(`${d}T${t}:00+07:00`);

describe("giờ dự án & đối chiếu công (T-018, AT08)", () => {
  let db: TestDb;
  let pm: ActorContext, dev: ActorContext, rev: ActorContext, lead: ActorContext, outsider: ActorContext;
  let t1: string, t2: string;

  before(async () => {
    db = await freshDb();
    const org = await seedCompany();
    const actorOf = async (u: { userId: string }) => (await loadActor(db.app, u.userId))!;
    const exec = await actorOf(
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
    const mk = async (code: string) => {
      const p = await withTx((tx) =>
        createProject(tx, exec, { code, name: code, managerEmployeeId: pm.employeeId! }),
      );
      await withTx(async (tx) => {
        await addMember(tx, pm, p, dev.employeeId!);
        await addMember(tx, pm, p, rev.employeeId!);
      });
      return withTx((tx) =>
        createTask(tx, pm, {
          projectId: p,
          title: code,
          responsibleEmployeeId: dev.employeeId!,
          reviewerEmployeeId: rev.employeeId!,
          acceptanceCriteria: "ok",
        }),
      );
    };
    t1 = await mk("P1");
    t2 = await mk("P2");
    const tpl = await db.admin.query(
      `INSERT INTO shift_template (company_id, code, name, start_time, end_time, break_minutes)
       VALUES ($1, 'HC', 'HC', '08:00', '17:00', 60) RETURNING id`,
      [org.companyId],
    );
    for (const d of ["2026-10-12", "2026-10-13", "2026-10-14"])
      await db.admin.query(
        "INSERT INTO shift_assignment (company_id, employee_id, business_date, shift_template_id) VALUES ($1, $2, $3, $4)",
        [org.companyId, dev.employeeId, d, tpl.rows[0].id],
      );
    for (const [d, i, o] of [
      ["2026-10-12", "08:00", "17:00"],
      ["2026-10-13", "08:00", "17:00"],
      ["2026-10-14", "08:00", "12:00"],
    ] as const) {
      for (const [k, t] of [
        ["in", i],
        ["out", o],
      ] as const)
        await recordEvent(
          db.app,
          { userId: dev.userId, companyId: dev.companyId, employeeId: dev.employeeId! },
          { idempotencyKey: randomUUID(), kind: k, deviceTime: vn(d, t), source: "gps" },
          vn(d, t),
        );
    }
  });
  after(async () => {
    await db.close();
  });

  test("chỉ người thực hiện khai giờ; quản lý dự án duyệt, không tự duyệt; từ chối cần lý do", async () => {
    await assert.rejects(
      withTx((tx) => logTime(tx, outsider, { taskId: t1, businessDate: "2026-10-12", minutes: 60 })),
      isCode("FORBIDDEN"),
    );
    await assert.rejects(
      withTx((tx) => logTime(tx, dev, { taskId: t1, businessDate: "2026-10-12", minutes: 0 })),
      isCode("VALIDATION"),
    );
    const a = await withTx((tx) =>
      logTime(tx, dev, { taskId: t1, businessDate: "2026-10-12", minutes: 300 }),
    );
    const b = await withTx((tx) =>
      logTime(tx, dev, { taskId: t2, businessDate: "2026-10-12", minutes: 180 }),
    );
    await assert.rejects(
      withTx((tx) => decideTimesheet(tx, dev, a, "approve")),
      isCode("FORBIDDEN"),
    );
    await withTx((tx) => decideTimesheet(tx, pm, a, "approve"));
    await assert.rejects(
      withTx((tx) => decideTimesheet(tx, pm, b, "reject", "")),
      isCode("VALIDATION"),
    );
    await withTx((tx) => decideTimesheet(tx, pm, b, "approve"));
    await assert.rejects(
      withTx((tx) => decideTimesheet(tx, pm, b, "approve")),
      isCode("INVALID_STATE"),
    );
  });

  test("AT08: tách có mặt / OT duyệt / giờ dự án; khớp trong ngưỡng không cảnh báo", async () => {
    const r = await reconcile(db.app, dev, dev.employeeId!, "2026-10-12", "2026-10-12");
    assert.deepEqual(r[0], {
      businessDate: "2026-10-12",
      presentMinutes: 480,
      otApprovedMinutes: 0,
      projectApprovedMinutes: 480,
      projectPendingMinutes: 0,
      diffMinutes: 0,
      note: null,
      warnings: [],
    });
  });

  test("giờ dự án vượt có mặt + OT → PROJECT_GT_PRESENT; OT đã duyệt bù được", async () => {
    const e = await withTx((tx) =>
      logTime(tx, dev, { taskId: t1, businessDate: "2026-10-13", minutes: 600 }),
    );
    await withTx((tx) => decideTimesheet(tx, pm, e, "approve"));
    let r = (await reconcile(db.app, dev, dev.employeeId!, "2026-10-13", "2026-10-13"))[0]!;
    assert.deepEqual(r.warnings, ["PROJECT_GT_PRESENT", "DIFF_NEEDS_REASON"]);
    const ot = await withTx((tx) =>
      requestOt(tx, dev, { businessDate: "2026-10-13", minutes: 120, reason: "chạy tiến độ", consent: true }),
    );
    await withTx((tx) => decideOt(tx, lead, ot, "approve"));
    r = (await reconcile(db.app, dev, dev.employeeId!, "2026-10-13", "2026-10-13"))[0]!;
    assert.equal(r.otApprovedMinutes, 120);
    assert.deepEqual(
      r.warnings,
      ["DIFF_NEEDS_REASON"],
      "OT bù phần vượt; chênh lệch có mặt vs dự án vẫn cần giải trình",
    );
    await withTx((tx) => explainDay(tx, dev, dev.employeeId!, "2026-10-13", "làm thêm 2 giờ theo đơn OT"));
    r = (await reconcile(db.app, dev, dev.employeeId!, "2026-10-13", "2026-10-13"))[0]!;
    assert.deepEqual(r.warnings, []);
    assert.equal(r.note, "làm thêm 2 giờ theo đơn OT");
  });

  test("chênh lệch lớn (có mặt nhiều hơn dự án) cần giải trình; giờ chờ duyệt hiện riêng, chưa tính", async () => {
    await withTx((tx) => logTime(tx, dev, { taskId: t2, businessDate: "2026-10-14", minutes: 60 }));
    const r = (await reconcile(db.app, dev, dev.employeeId!, "2026-10-14", "2026-10-14"))[0]!;
    // 08:00–12:00 = 240', mẫu ca nghỉ cố định 60' (C2: có mặt > nghỉ thì trừ) → 180' — HR chốt quy tắc nửa ngày ở F02.
    assert.equal(r.presentMinutes, 180);
    assert.equal(r.projectPendingMinutes, 60);
    assert.equal(r.projectApprovedMinutes, 0);
    assert.deepEqual(r.warnings, ["DIFF_NEEDS_REASON"]);
  });

  test("tổng giờ dự án một ngày không vượt 24 giờ; việc huỷ không khai giờ", async () => {
    await withTx((tx) => logTime(tx, dev, { taskId: t1, businessDate: "2026-10-20", minutes: 1400 }));
    await assert.rejects(
      withTx((tx) => logTime(tx, dev, { taskId: t2, businessDate: "2026-10-20", minutes: 60 })),
      isCode("TIMESHEET_DAY_OVERFLOW"),
    );
    const p1 = (await db.admin.query("SELECT project_id FROM task WHERE id = $1", [t1])).rows[0].project_id;
    const c = await withTx((tx) =>
      createTask(tx, pm, {
        projectId: p1,
        title: "huỷ",
        responsibleEmployeeId: dev.employeeId!,
        requiresAcceptance: false,
      }),
    );
    await withTx((tx) => transitionTask(tx, pm, c, "cancel", { expectedVersion: 1, reason: "không làm" }));
    await assert.rejects(
      withTx((tx) => logTime(tx, dev, { taskId: c, businessDate: "2026-10-21", minutes: 30 })),
      isCode("INVALID_STATE"),
    );
  });

  test("quyền xem đối chiếu: chính chủ, trưởng nhóm phạm vi; người ngoài/PM (R4) → 403", async () => {
    assert.ok((await reconcile(db.app, lead, dev.employeeId!, "2026-10-12", "2026-10-14")).length >= 3);
    await assert.rejects(
      reconcile(db.app, outsider, dev.employeeId!, "2026-10-12", "2026-10-14"),
      isCode("FORBIDDEN"),
    );
    await assert.rejects(
      reconcile(db.app, pm, dev.employeeId!, "2026-10-12", "2026-10-14"),
      isCode("FORBIDDEN"),
    );
    await assert.rejects(
      withTx((tx) => explainDay(tx, outsider, dev.employeeId!, "2026-10-14", "x")),
      isCode("FORBIDDEN"),
    );
    await assert.rejects(
      withTx((tx) => explainDay(tx, dev, dev.employeeId!, "2026-10-14", " ")),
      isCode("VALIDATION"),
    );
  });
});
