// Tái hiện các phát hiện review PR #8 (chặn 1–3, nên sửa 4–8, nhỏ 11–12) — mỗi test là một hàng rào hồi quy.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { withTx } from "../../lib/db/index.ts";
import { loadActor } from "../../lib/authz/load.ts";
import type { ActorContext } from "../../lib/authz/index.ts";
import { assignEmployment } from "../../lib/org/index.ts";
import { recordEvent } from "../../lib/attendance/events.ts";
import { computeShift } from "../../lib/attendance/compute.ts";
import { decideOt, requestOt } from "../../lib/attendance/ot.ts";
import { decideLeave, requestLeave, cancelApprovedLeave } from "../../lib/attendance/leave.ts";
import {
  advancePeriod,
  computeLines,
  createPeriod,
  decideAdjustment,
  explainException,
  getExport,
  lockPeriod,
  requestAdjustment,
} from "../../lib/attendance/period.ts";
import { login } from "../../lib/identity/auth.ts";
import { checkRate } from "../../lib/inquiry/index.ts";
import { approve, createPage, submitForReview, updateDraft } from "../../lib/cms/index.ts";
import { getCookie } from "../../lib/http/index.ts";
import { AppError } from "../../lib/nen/app-error.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { PASSWORD, seedCompany, seedUser, setTestEnv } from "../helpers/fixtures.ts";

setTestEnv();
const isCode = (code: string) => (e: unknown) => e instanceof AppError && e.code === code;
const vn = (d: string, t: string) => new Date(`${d}T${t}:00+07:00`);

describe("hồi quy review PR #8", () => {
  let db: TestDb;
  let org: Awaited<ReturnType<typeof seedCompany>>;
  let emp: ActorContext, lead: ActorContext, hr: ActorContext;
  let tpl: string, night: string;

  const ev = (a: ActorContext, kind: "in" | "out", at: Date, now: Date = at) =>
    recordEvent(
      db.app,
      { userId: a.userId, companyId: a.companyId, employeeId: a.employeeId! },
      { idempotencyKey: randomUUID(), kind, deviceTime: at, source: "gps" },
      now,
    );
  const assign = (employeeId: string, date: string, template = tpl) =>
    db.admin.query(
      "INSERT INTO shift_assignment (company_id, employee_id, business_date, shift_template_id) VALUES ($1, $2, $3, $4)",
      [org.companyId, employeeId, date, template],
    );
  const toHrClosed = async (id: string) => {
    for (const s of ["employee_review", "manager_confirmed", "hr_closed"] as const)
      await withTx((tx) => advancePeriod(tx, hr, id, s));
  };

  before(async () => {
    db = await freshDb();
    org = await seedCompany();
    const e = await seedUser(org.companyId, { grants: [{ role: "employee", scopeType: "self" }] });
    const l = await seedUser(org.companyId, {
      grants: [{ role: "team_lead", scopeType: "department", scopeId: org.deptId }],
    });
    const h = await seedUser(org.companyId, { grants: [{ role: "hr", scopeType: "company" }] });
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
    tpl = (
      await db.admin.query(
        `INSERT INTO shift_template (company_id, code, name, start_time, end_time, break_minutes)
         VALUES ($1, 'HC', 'HC', '08:00', '17:00', 60) RETURNING id`,
        [org.companyId],
      )
    ).rows[0].id;
    night = (
      await db.admin.query(
        `INSERT INTO shift_template (company_id, code, name, start_time, end_time, break_minutes)
         VALUES ($1, 'DEM', 'Đêm', '22:00', '06:00', 60) RETURNING id`,
        [org.companyId],
      )
    ).rows[0].id;
  });
  after(async () => {
    await db.close();
  });

  test("#1 OT đã duyệt vào ngày không có ca vẫn có dòng trong bảng công", async () => {
    const id = await withTx((tx) =>
      requestOt(tx, emp, { businessDate: "2026-07-05", minutes: 120, reason: "CN trực", consent: true }),
    );
    await withTx((tx) => decideOt(tx, lead, id, "approve"));
    const lines = await computeLines(db.app, org.companyId, "2026-07-01", "2026-07-31");
    assert.deepEqual(
      lines.map((l) => [l.businessDate, l.status, l.otApprovedMinutes]),
      [["2026-07-05", "ot_only", 120]],
    );
  });

  test("#2 duyệt sau khi khoá (điều chỉnh, OT, nghỉ) cần quyền HR và ra phiên bản xuất mới", async () => {
    await assign(emp.employeeId!, "2026-08-03");
    const aIn = await withTx((tx) =>
      requestAdjustment(tx, emp, {
        employeeId: emp.employeeId!,
        action: "add_event",
        newKind: "in",
        newAt: vn("2026-08-03", "08:00"),
        reason: "quên",
      }),
    );
    const ot = await withTx((tx) =>
      requestOt(tx, emp, { businessDate: "2026-08-04", minutes: 60, reason: "x", consent: true }),
    );
    const kl = await unpaidType();
    const lv = await withTx((tx) =>
      requestLeave(tx, emp, {
        leaveTypeId: kl,
        startAt: vn("2026-08-05", "08:00"),
        endAt: vn("2026-08-05", "12:00"),
        minutes: 240,
      }),
    );
    const aug = await withTx((tx) =>
      createPeriod(tx, hr, { code: "2026-08", startDate: "2026-08-01", endDate: "2026-08-31" }),
    );
    await toHrClosed(aug);
    for (const ref of [`adjustment:${aIn}`, `ot:${ot}`, `leave:${lv}`])
      await withTx((tx) => explainException(tx, hr, aug, ref, "xử lý sau khoá"));
    await withTx((tx) => lockPeriod(tx, hr, aug));
    // Trưởng nhóm không còn duyệt được thay đổi thuộc kỳ đã khoá.
    await assert.rejects(
      withTx((tx) => decideAdjustment(tx, lead, aIn, "approve")),
      isCode("FORBIDDEN"),
    );
    await assert.rejects(
      withTx((tx) => decideOt(tx, lead, ot, "approve")),
      isCode("FORBIDDEN"),
    );
    await assert.rejects(
      withTx((tx) => decideLeave(tx, lead, lv, "approve")),
      isCode("FORBIDDEN"),
    );
    // HR duyệt → mỗi lần một phiên bản xuất mới.
    assert.equal((await withTx((tx) => decideAdjustment(tx, hr, aIn, "approve"))).newExportVersion, 2);
    await withTx((tx) => decideOt(tx, hr, ot, "approve"));
    assert.equal((await getExport(db.app, hr, aug)).version, 3);
    await withTx((tx) => decideLeave(tx, hr, lv, "approve"));
    assert.equal((await getExport(db.app, hr, aug)).version, 4);
    await withTx((tx) => cancelApprovedLeave(tx, hr, lv, "huỷ"));
    const v5 = await getExport(db.app, hr, aug);
    assert.equal(v5.version, 5);
    assert.match(v5.content, /,2026-08-04,ot_only,,60,0\r\n/);
  });

  async function unpaidType(): Promise<string> {
    const r = await db.admin.query(
      `INSERT INTO leave_type (company_id, code, name, paid, requires_balance) VALUES ($1, 'KL', 'KL', false, false)
       ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [org.companyId],
    );
    return r.rows[0].id;
  }

  test("#3 đăng nhập song song không vượt được giới hạn 5 lần sai", async () => {
    const u = await seedUser(org.companyId);
    const tries = Array.from({ length: 12 }, (_, i) =>
      login(db.app, {
        email: u.email,
        password: i === 11 ? PASSWORD : "sai-mat-khau-dai",
        ip: "1.2.3.4",
      }).then(
        () => "OK",
        (e: AppError) => e.code,
      ),
    );
    const r = await Promise.all(tries);
    const counts = r.reduce<Record<string, number>>((m, c) => ({ ...m, [c]: (m[c] ?? 0) + 1 }), {});
    assert.ok((counts.INVALID_CREDENTIALS ?? 0) <= 5, JSON.stringify(counts));
    assert.ok((counts.RATE_LIMITED ?? 0) >= 6, JSON.stringify(counts));
  });

  test("#4 kỳ khoá xác định theo ngày nghiệp vụ của ca, không theo ngày lịch", async () => {
    await assign(emp.employeeId!, "2026-09-30", night);
    await ev(emp, "in", vn("2026-09-30", "22:00"));
    const sep = await withTx((tx) =>
      createPeriod(tx, hr, { code: "2026-09", startDate: "2026-09-01", endDate: "2026-09-30" }),
    );
    await toHrClosed(sep);
    await withTx((tx) => explainException(tx, hr, sep, `line:${emp.employeeId}:2026-09-30`, "chờ xác minh"));
    await withTx((tx) => lockPeriod(tx, hr, sep));
    const late = await ev(emp, "out", vn("2026-10-01", "05:59"));
    assert.equal(late.status, "needs_review");
    assert.match(late.reviewReason ?? "", /LATE_FOR_LOCKED_PERIOD/);
    // Đề nghị sửa giờ ra 01/10 05:59 thuộc ca 30/09 → post_lock, trưởng nhóm không duyệt được.
    const adj = await withTx((tx) =>
      requestAdjustment(tx, emp, {
        employeeId: emp.employeeId!,
        action: "add_event",
        newKind: "out",
        newAt: vn("2026-10-01", "05:59"),
        reason: "quên",
      }),
    );
    await assert.rejects(
      withTx((tx) => decideAdjustment(tx, lead, adj, "approve")),
      isCode("FORBIDDEN"),
    );
  });

  test("#5 nghỉ cố định không làm đoạn âm; tổng = có mặt − nghỉ", () => {
    const r = computeShift(
      { businessDate: "2026-10-05", start: "22:00", end: "06:00", breakMinutes: 60, tz: "Asia/Ho_Chi_Minh" },
      [
        { id: "a", kind: "in", at: vn("2026-10-05", "23:10") },
        { id: "b", kind: "out", at: vn("2026-10-06", "00:50") },
      ],
    );
    assert.equal(r.presentMinutes, 40);
    assert.ok(r.segments.every((s) => s.minutes > 0));
    assert.equal(
      r.segments.reduce((s, x) => s + x.minutes, 0),
      40,
    );
  });

  test("#7 giới hạn biểu mẫu công khai không bị vượt bằng request song song", async () => {
    const r = await Promise.all(
      Array.from({ length: 12 }, () =>
        checkRate(db.app, "inquiry", "9.9.9.9").then(
          () => "OK",
          (e: AppError) => e.code,
        ),
      ),
    );
    assert.equal(r.filter((x) => x === "OK").length, 5);
  });

  test("#8 CMS: chỉ tác giả sửa bản nháp (không lách R5 bằng sửa rồi tự duyệt)", async () => {
    const a = await seedUser(org.companyId);
    const b = await seedUser(org.companyId);
    const A = { userId: a.userId, companyId: org.companyId };
    const B = { userId: b.userId, companyId: org.companyId };
    const rev = await withTx((tx) =>
      createPage(tx, A, { type: "news", slug: `r5-${Date.now()}` }, { title: "A", bodyMarkdown: "" }),
    );
    await assert.rejects(
      withTx((tx) => updateDraft(tx, B, rev.id, { title: "B viết", bodyMarkdown: "x" })),
      isCode("NOT_AUTHOR"),
    );
    await withTx((tx) => submitForReview(tx, A, rev.id));
    await withTx((tx) => approve(tx, B, rev.id));
  });

  test("#11 cookie mã hoá sai → bỏ qua (401), không ném 500", () => {
    const r = new Request("http://xc.test/", { headers: { cookie: "xc_session=%E0%A4%A" } });
    assert.equal(getCookie(r, "xc_session"), null);
  });

  test("#12 period_line không trùng dòng leave_only (shift_assignment_id null)", async () => {
    const p = (await db.admin.query("SELECT id FROM attendance_period LIMIT 1")).rows[0].id;
    const row = [p, 99, emp.employeeId, "2026-08-20", null, "leave_only", null, 0, 60];
    const sql = `INSERT INTO period_line (period_id, version, employee_id, business_date, shift_assignment_id, status,
      present_minutes, ot_approved_minutes, leave_minutes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`;
    await db.admin.query(sql, row);
    await assert.rejects(db.admin.query(sql, row), /duplicate key/);
  });
});

describe("hồi quy review PR #8 — IP client (#6)", () => {
  test("lấy phần tử thứ N từ phải theo số proxy tin cậy; không cấu hình → direct", async () => {
    const { clientIp } = await import("../../lib/http/index.ts");
    const r = (xff: string) => new Request("http://xc.test/", { headers: { "x-forwarded-for": xff } });
    const saved = { a: process.env.TRUST_PROXY, b: process.env.TRUST_PROXY_HOPS };
    try {
      delete process.env.TRUST_PROXY;
      delete process.env.TRUST_PROXY_HOPS;
      assert.equal(clientIp(r("6.6.6.6, 1.1.1.1")), "direct");
      process.env.TRUST_PROXY_HOPS = "1";
      assert.equal(clientIp(r("6.6.6.6, 1.1.1.1")), "1.1.1.1", "phần tử client tự đặt bên trái bị bỏ qua");
      process.env.TRUST_PROXY_HOPS = "2";
      assert.equal(clientIp(r("6.6.6.6, 1.1.1.1, 10.0.0.2")), "1.1.1.1");
      assert.equal(clientIp(r("")), "direct");
    } finally {
      if (saved.a === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = saved.a;
      if (saved.b === undefined) delete process.env.TRUST_PROXY_HOPS;
      else process.env.TRUST_PROXY_HOPS = saved.b;
    }
  });
});
