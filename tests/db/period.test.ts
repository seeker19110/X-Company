import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { withTx } from "../../lib/db/index.ts";
import { loadActor } from "../../lib/authz/load.ts";
import type { ActorContext } from "../../lib/authz/index.ts";
import { assignEmployment, createEmployee } from "../../lib/org/index.ts";
import { pendingApprovals } from "../../lib/attendance/approvals.ts";
import { recordEvent } from "../../lib/attendance/events.ts";
import {
  advancePeriod,
  computeLines,
  createPeriod,
  decideAdjustment,
  explainException,
  getExport,
  lockPeriod,
  periodExceptions,
  requestAdjustment,
} from "../../lib/attendance/period.ts";
import { AppError } from "../../lib/nen/app-error.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { seedCompany, seedUser } from "../helpers/fixtures.ts";

const isCode = (code: string) => (e: unknown) => e instanceof AppError && e.code === code;
const vn = (d: string, t: string) => new Date(`${d}T${t}:00+07:00`);

describe("kỳ công & sửa công (T-014, AT06)", () => {
  let db: TestDb;
  let org: Awaited<ReturnType<typeof seedCompany>>;
  let emp: ActorContext, lead: ActorContext, hr: ActorContext, acc: ActorContext;
  let tpl: string;
  let sep: string;

  async function event(a: ActorContext, kind: "in" | "out", at: Date, now: Date = at) {
    return recordEvent(
      db.app,
      { userId: a.userId, companyId: a.companyId, employeeId: a.employeeId! },
      { idempotencyKey: randomUUID(), kind, deviceTime: at, source: "gps" },
      now,
    );
  }
  async function assign(employeeId: string, date: string) {
    await db.admin.query(
      "INSERT INTO shift_assignment (company_id, employee_id, business_date, shift_template_id) VALUES ($1, $2, $3, $4)",
      [org.companyId, employeeId, date, tpl],
    );
  }
  async function walkToHrClosed(periodId: string) {
    for (const s of ["employee_review", "manager_confirmed", "hr_closed"] as const)
      await withTx((tx) => advancePeriod(tx, hr, periodId, s));
  }

  before(async () => {
    db = await freshDb();
    org = await seedCompany();
    const e = await seedUser(org.companyId, { grants: [{ role: "employee", scopeType: "self" }] });
    const l = await seedUser(org.companyId, {
      grants: [{ role: "team_lead", scopeType: "department", scopeId: org.deptId }],
    });
    const h = await seedUser(org.companyId, { grants: [{ role: "hr", scopeType: "company" }] });
    const a = await seedUser(org.companyId, { grants: [{ role: "accountant", scopeType: "company" }] });
    await withTx((tx) =>
      assignEmployment(tx, { userId: null }, org.companyId, e.employeeId!, {
        departmentId: org.deptId,
        validFrom: "2026-01-01",
      }),
    );
    const actorOf = async (u: { userId: string }) => (await loadActor(db.app, u.userId))!;
    emp = await actorOf(e);
    lead = await actorOf(l);
    hr = await actorOf(h);
    acc = await actorOf(a);
    tpl = (
      await db.admin.query(
        `INSERT INTO shift_template (company_id, code, name, start_time, end_time, break_minutes)
         VALUES ($1, 'HC', 'Hành chính', '08:00', '17:00', 60) RETURNING id`,
        [org.companyId],
      )
    ).rows[0].id;
    for (const d of ["2026-09-01", "2026-09-02", "2026-09-03"]) await assign(emp.employeeId!, d);
    await event(emp, "in", vn("2026-09-01", "08:00"));
    await event(emp, "out", vn("2026-09-01", "17:00"));
    await event(emp, "in", vn("2026-09-02", "08:00")); // thiếu giờ ra
    sep = await withTx((tx) =>
      createPeriod(tx, hr, { code: "2026-09", startDate: "2026-09-01", endDate: "2026-09-30" }),
    );
  });
  after(async () => {
    await db.close();
  });

  test("AUD-DATA-004 (D-012): đơn nghỉ vắt ranh kỳ tính trọn vào ngày bắt đầu (giờ VN) và kỳ chứa ngày đó; không mất, không đếm hai lần", async () => {
    const lt = (
      await db.admin.query(
        "INSERT INTO leave_type (company_id, code, name, requires_balance) VALUES ($1, 'P-RANH', 'Phép ranh kỳ', false) RETURNING id",
        [org.companyId],
      )
    ).rows[0].id;
    const leave = (start: Date, end: Date, minutes: number) =>
      db.admin.query(
        `INSERT INTO leave_request (company_id, employee_id, leave_type_id, start_at, end_at, minutes, status, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'approved', $7)`,
        [org.companyId, emp.employeeId, lt, start, end, minutes, emp.userId],
      );
    // 31/10 → 03/11 (giờ VN), 1440 phút; và đơn bắt đầu 01/12 06:00 VN = 30/11 23:00 UTC (ngày UTC khác ngày VN).
    await leave(vn("2026-10-31", "08:00"), vn("2026-11-03", "17:00"), 1440);
    await leave(vn("2026-12-01", "06:00"), vn("2026-12-01", "10:00"), 240);
    const sum = (ls: { employeeId: string; businessDate: string; leaveMinutes: number }[]) =>
      ls.filter((l) => l.employeeId === emp.employeeId).map((l) => [l.businessDate, l.leaveMinutes]);
    const oct = sum(await computeLines(db.app, org.companyId, "2026-10-01", "2026-10-31", emp.employeeId!));
    const nov = sum(await computeLines(db.app, org.companyId, "2026-11-01", "2026-11-30", emp.employeeId!));
    const dec = sum(await computeLines(db.app, org.companyId, "2026-12-01", "2026-12-31", emp.employeeId!));
    assert.deepEqual(
      oct,
      [["2026-10-31", 1440]],
      "trọn đơn 31/10→03/11 vào kỳ tháng 10, ngày không có ca → leave_only",
    );
    assert.deepEqual(nov, [], "phần đơn rơi vào 01–03/11 không bị đếm lại ở kỳ tháng 11");
    assert.deepEqual(
      dec,
      [["2026-12-01", 240]],
      "đơn 06:00 VN ngày 01/12 thuộc tháng 12 dù ngày UTC là 30/11",
    );
  });

  test("số liệu tạm: đủ / thiếu giờ ra / vắng", async () => {
    const lines = await computeLines(db.app, org.companyId, "2026-09-01", "2026-09-30");
    assert.deepEqual(
      lines.map((l) => [l.businessDate, l.status, l.presentMinutes]),
      [
        ["2026-09-01", "ok", 480],
        ["2026-09-02", "incomplete", 0],
        ["2026-09-03", "absent", null],
      ],
    );
  });

  test("kỳ chỉ đi tới từng bước; khoá phải qua thao tác riêng; chỉ HR; kỳ chồng ngày bị chặn", async () => {
    await assert.rejects(
      withTx((tx) => advancePeriod(tx, hr, sep, "hr_closed")),
      isCode("INVALID_STATE"),
    );
    await assert.rejects(
      withTx((tx) => advancePeriod(tx, lead, sep, "employee_review")),
      isCode("FORBIDDEN"),
    );
    await assert.rejects(
      withTx((tx) => lockPeriod(tx, hr, sep)),
      isCode("INVALID_STATE"),
    );
    await walkToHrClosed(sep);
    await assert.rejects(
      withTx((tx) => advancePeriod(tx, hr, sep, "locked")),
      isCode("INVALID_STATE"),
    );
    await assert.rejects(
      withTx((tx) =>
        createPeriod(tx, hr, { code: "2026-09b", startDate: "2026-09-15", endDate: "2026-10-15" }),
      ),
      isCode("PERIOD_OVERLAP"),
    );
  });

  test("khoá bị chặn khi còn ngoại lệ trọng yếu (thiếu giờ ra)", async () => {
    await assert.rejects(
      withTx((tx) => lockPeriod(tx, hr, sep)),
      (e: unknown) => {
        assert.ok(e instanceof AppError && e.code === "PERIOD_HAS_EXCEPTIONS");
        const ex = (e.details?.exceptions ?? []) as { ref: string; kind: string }[];
        assert.deepEqual(
          ex.map((x) => [x.ref, x.kind]),
          [[`line:${emp.employeeId}:2026-09-02`, "MISSING_CHECKOUT"]],
        );
        return true;
      },
    );
  });

  test("AUD-CODE-007: add_event không được ở tương lai; summary hộp duyệt nêu loại + thời điểm", async () => {
    await assert.rejects(
      withTx((tx) =>
        requestAdjustment(tx, emp, {
          employeeId: emp.employeeId!,
          action: "add_event",
          newKind: "out",
          newAt: new Date(Date.now() + 30 * 86_400_000),
          reason: "quên chấm ra",
        }),
      ),
      isCode("VALIDATION"),
    );
    // tương lai gần trong dung sai đồng hồ (5 phút) vẫn qua
    const soon = await withTx((tx) =>
      requestAdjustment(tx, emp, {
        employeeId: emp.employeeId!,
        action: "add_event",
        newKind: "out",
        newAt: new Date(Date.now() + 60_000),
        reason: "lệch đồng hồ",
      }),
    );
    assert.notEqual(soon, "");
    const items = await pendingApprovals(db.app, lead);
    const it = items.find((x) => x.id === soon);
    assert.ok(it);
    assert.match(it.summary, /out/, "summary nêu loại sự kiện");
    await db.admin.query("UPDATE attendance_adjustment SET status = 'rejected' WHERE id = $1", [soon]);
  });

  test("AT06: sửa công có trước/sau, lý do, người duyệt ≠ người đề nghị; đề nghị chờ cũng chặn khoá", async () => {
    await assert.rejects(
      withTx((tx) =>
        requestAdjustment(tx, emp, {
          employeeId: emp.employeeId!,
          action: "add_event",
          newKind: "out",
          newAt: vn("2026-09-02", "17:00"),
          reason: " ",
        }),
      ),
      isCode("VALIDATION"),
    );
    const id = await withTx((tx) =>
      requestAdjustment(tx, emp, {
        employeeId: emp.employeeId!,
        action: "add_event",
        newKind: "out",
        newAt: vn("2026-09-02", "17:00"),
        reason: "quên bấm ra, có xác nhận của tổ trưởng",
      }),
    );
    const pend = await periodExceptions(db.app, org.companyId, {
      id: sep,
      code: "2026-09",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      status: "hr_closed",
      currentVersion: 0,
    });
    assert.ok(pend.some((x) => x.ref === `adjustment:${id}`));
    await assert.rejects(
      withTx((tx) => decideAdjustment(tx, emp, id, "approve")),
      isCode("FORBIDDEN"),
    );
    await withTx((tx) => decideAdjustment(tx, lead, id, "approve"));
    const row = await db.admin.query(
      "SELECT before, after, reason, decided_by_user_id, post_lock FROM attendance_adjustment WHERE id = $1",
      [id],
    );
    assert.deepEqual(row.rows[0].after, { kind: "out", at: "2026-09-02T10:00:00.000Z" });
    assert.equal(row.rows[0].decided_by_user_id, lead.userId);
    assert.equal(row.rows[0].post_lock, false);
    const ev = await db.admin.query(
      "SELECT source, status FROM attendance_event WHERE idempotency_key = $1",
      [`adj:${id}`],
    );
    assert.deepEqual(ev.rows[0], { source: "manual_request", status: "accepted" });
    // Trưởng nhóm tạo hộ rồi tự duyệt → SELF_APPROVAL.
    const byLead = await withTx((tx) =>
      requestAdjustment(tx, lead, {
        employeeId: emp.employeeId!,
        action: "add_event",
        newKind: "in",
        newAt: vn("2026-09-03", "08:00"),
        reason: "x",
      }),
    );
    await assert.rejects(
      withTx((tx) => decideAdjustment(tx, lead, byLead, "approve")),
      isCode("SELF_APPROVAL"),
    );
    await withTx((tx) => decideAdjustment(tx, hr, byLead, "reject", "không có căn cứ"));
  });

  test("S-AT-07: khoá → số liệu v1 + xuất CSV có checksum; log muộn → needs_review, không đổi bản xuất", async () => {
    const r = await withTx((tx) => lockPeriod(tx, hr, sep));
    assert.equal(r.version, 1);
    const ex = await getExport(db.app, hr, sep);
    assert.equal(ex.version, 1);
    assert.equal(ex.periodCode, "2026-09");
    assert.equal(ex.rowCount, 3);
    assert.equal(ex.checksum, createHash("sha256").update(ex.content, "utf8").digest("hex"));
    assert.ok(
      ex.content.startsWith("﻿ma_nv,ho_ten,ngay,trang_thai,co_mat_phut,ot_duyet_phut,nghi_phep_phut\r\n"),
    );
    assert.match(ex.content, /,2026-09-02,ok,480,0,0\r\n/);
    assert.match(ex.content, /,2026-09-03,absent,,0,0\r\n/);
    // Log đến muộn của ngày thuộc kỳ đã khoá.
    const late = await event(emp, "in", vn("2026-09-03", "08:00"));
    assert.equal(late.status, "needs_review");
    assert.match(late.reviewReason ?? "", /LATE_FOR_LOCKED_PERIOD/);
    assert.equal((await getExport(db.app, hr, sep)).checksum, ex.checksum);
    // Kế toán đọc được; trưởng nhóm thì không.
    assert.equal((await getExport(db.app, acc, sep)).version, 1);
    await assert.rejects(getExport(db.app, lead, sep), isCode("FORBIDDEN"));
  });

  test("sau khoá: điều chỉnh post_lock chỉ HR duyệt → phiên bản xuất mới; bản cũ giữ nguyên checksum", async () => {
    const v1 = await getExport(db.app, hr, sep, 1);
    const addIn = await withTx((tx) =>
      requestAdjustment(tx, emp, {
        employeeId: emp.employeeId!,
        action: "add_event",
        newKind: "in",
        newAt: vn("2026-09-03", "08:00"),
        reason: "đi công tác, có giấy",
      }),
    );
    const addOut = await withTx((tx) =>
      requestAdjustment(tx, emp, {
        employeeId: emp.employeeId!,
        action: "add_event",
        newKind: "out",
        newAt: vn("2026-09-03", "17:00"),
        reason: "đi công tác, có giấy",
      }),
    );
    const pl = await db.admin.query("SELECT post_lock FROM attendance_adjustment WHERE id = $1", [addIn]);
    assert.equal(pl.rows[0].post_lock, true);
    await assert.rejects(
      withTx((tx) => decideAdjustment(tx, lead, addIn, "approve")),
      isCode("FORBIDDEN"),
    );
    assert.deepEqual(await withTx((tx) => decideAdjustment(tx, hr, addIn, "approve")), {
      newExportVersion: 2,
    });
    assert.deepEqual(await withTx((tx) => decideAdjustment(tx, hr, addOut, "approve")), {
      newExportVersion: 3,
    });
    const v3 = await getExport(db.app, hr, sep);
    assert.equal(v3.version, 3);
    assert.match(v3.content, /,2026-09-03,ok,480,0,0\r\n/);
    assert.notEqual(v3.checksum, v1.checksum);
    assert.equal((await getExport(db.app, hr, sep, 1)).checksum, v1.checksum, "phiên bản 1 không đổi");
    await assert.rejects(getExport(db.app, hr, sep, 9), isCode("NOT_FOUND"));
    // Huỷ sự kiện (void) cũng đi qua điều chỉnh; huỷ lần hai bị chặn.
    const target = (
      await db.admin.query("SELECT id FROM attendance_event WHERE idempotency_key = $1", [`adj:${addOut}`])
    ).rows[0].id;
    const voidId = await withTx((tx) =>
      requestAdjustment(tx, emp, {
        employeeId: emp.employeeId!,
        action: "void_event",
        targetEventId: target,
        reason: "bấm nhầm",
      }),
    );
    await withTx((tx) => decideAdjustment(tx, hr, voidId, "approve"));
    await assert.rejects(
      withTx((tx) =>
        requestAdjustment(tx, emp, {
          employeeId: emp.employeeId!,
          action: "void_event",
          targetEventId: target,
          reason: "lần 2",
        }),
      ),
      isCode("INVALID_STATE"),
    );
    assert.equal((await getExport(db.app, hr, sep)).version, 4);
  });

  test("giải trình ngoại lệ cho phép khoá; vắng không chặn; CSV chống injection công thức", async () => {
    const evil = await withTx((tx) =>
      createEmployee(tx, { userId: null }, org.companyId, {
        code: "NV-X",
        fullName: '=HYPERLINK("http://x","bấm")',
      }),
    );
    await assign(evil, "2026-10-01");
    await assign(emp.employeeId!, "2026-10-01");
    await event(emp, "in", vn("2026-10-01", "08:00"));
    const oct = await withTx((tx) =>
      createPeriod(tx, hr, { code: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" }),
    );
    await walkToHrClosed(oct);
    await assert.rejects(
      withTx((tx) => lockPeriod(tx, hr, oct)),
      isCode("PERIOD_HAS_EXCEPTIONS"),
    );
    await assert.rejects(
      withTx((tx) => explainException(tx, hr, oct, `line:${emp.employeeId}:2026-10-01`, " ")),
      isCode("VALIDATION"),
    );
    await assert.rejects(
      withTx((tx) => explainException(tx, lead, oct, "x", "y")),
      isCode("FORBIDDEN"),
    );
    await withTx((tx) =>
      explainException(
        tx,
        hr,
        oct,
        `line:${emp.employeeId}:2026-10-01`,
        "nhân viên về sớm do ốm, đã xác minh",
      ),
    );
    await withTx((tx) => lockPeriod(tx, hr, oct));
    const ex = await getExport(db.app, hr, oct);
    assert.ok(ex.content.includes(`"'=HYPERLINK(""http://x"",""bấm"")"`), ex.content);
    assert.match(ex.content, /,2026-10-01,incomplete,0,0,0\r\n/);
    await assert.rejects(getExport(db.app, hr, randomUUID()), isCode("NOT_FOUND"));
  });
});
