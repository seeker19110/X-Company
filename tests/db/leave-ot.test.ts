import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { withTx } from "../../lib/db/index.ts";
import { loadActor } from "../../lib/authz/load.ts";
import type { ActorContext } from "../../lib/authz/index.ts";
import { assignEmployment } from "../../lib/org/index.ts";
import {
  cancelApprovedLeave,
  decideLeave,
  leaveBalance,
  postLedger,
  requestLeave,
} from "../../lib/attendance/leave.ts";
import { checkOtLimits, decideOt, giveOtConsent, otPolicyAt, requestOt } from "../../lib/attendance/ot.ts";
import { pendingApprovals, pendingApprovalsPage } from "../../lib/attendance/approvals.ts";
import { formatDate } from "../../lib/i18n/format.ts";
import { AppError } from "../../lib/nen/app-error.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { seedCompany, seedUser } from "../helpers/fixtures.ts";

const isCode = (code: string) => (e: unknown) => e instanceof AppError && e.code === code;
const D = (iso: string) => new Date(iso);

describe("nghỉ phép & OT (T-013)", () => {
  let db: TestDb;
  let org: Awaited<ReturnType<typeof seedCompany>>;
  let emp: ActorContext, lead: ActorContext, hr: ActorContext, otherLead: ActorContext;
  let annual: string, unpaid: string;

  async function actorOf(u: { userId: string }) {
    return (await loadActor(db.app, u.userId))!;
  }

  before(async () => {
    db = await freshDb();
    org = await seedCompany();
    const e = await seedUser(org.companyId, { grants: [{ role: "employee", scopeType: "self" }] });
    const l = await seedUser(org.companyId, {
      grants: [{ role: "team_lead", scopeType: "department", scopeId: org.deptId }],
    });
    const h = await seedUser(org.companyId, { grants: [{ role: "hr", scopeType: "company" }] });
    const o = await seedUser(org.companyId, {
      grants: [{ role: "team_lead", scopeType: "department", scopeId: org.otherDeptId }],
    });
    await withTx(async (tx) => {
      // Nhân viên thuộc phòng con của D1 → trưởng nhóm D1 duyệt được (cây).
      await assignEmployment(tx, { userId: null }, org.companyId, e.employeeId!, {
        departmentId: org.subDeptId,
        validFrom: "2026-01-01",
      });
      await assignEmployment(tx, { userId: null }, org.companyId, l.employeeId!, {
        departmentId: org.deptId,
        validFrom: "2026-01-01",
      });
    });
    emp = await actorOf(e);
    lead = await actorOf(l);
    hr = await actorOf(h);
    otherLead = await actorOf(o);
    const t = await db.admin.query(
      `INSERT INTO leave_type (company_id, code, name, paid, requires_balance) VALUES
       ($1, 'PN', 'Phép năm', true, true), ($1, 'KL', 'Không lương', false, false) RETURNING id`,
      [org.companyId],
    );
    annual = t.rows[0].id;
    unpaid = t.rows[1].id;
  });
  after(async () => {
    await db.close();
  });

  describe("sổ phép", () => {
    test("số dư = tổng bút toán; điều chỉnh cần lý do; chỉ HR ghi sổ; sổ chỉ thêm", async () => {
      await withTx((tx) =>
        postLedger(tx, hr, {
          employeeId: emp.employeeId!,
          leaveTypeId: annual,
          entryType: "accrual",
          minutes: 960,
          reason: "kỳ 1",
        }),
      );
      await withTx((tx) =>
        postLedger(tx, hr, {
          employeeId: emp.employeeId!,
          leaveTypeId: annual,
          entryType: "adjustment",
          minutes: -60,
          reason: "trừ do nhập sai",
        }),
      );
      assert.equal(await leaveBalance(db.app, emp.employeeId!, annual), 900);
      await assert.rejects(
        withTx((tx) =>
          postLedger(tx, hr, {
            employeeId: emp.employeeId!,
            leaveTypeId: annual,
            entryType: "adjustment",
            minutes: 5,
            reason: " ",
          }),
        ),
        isCode("VALIDATION"),
      );
      await assert.rejects(
        withTx((tx) =>
          postLedger(tx, lead, {
            employeeId: emp.employeeId!,
            leaveTypeId: annual,
            entryType: "accrual",
            minutes: 60,
            reason: "x",
          }),
        ),
        isCode("FORBIDDEN"),
      );
      await assert.rejects(db.app.query("UPDATE leave_ledger SET minutes = 99999"), /permission denied/);
    });
  });

  describe("đơn nghỉ (AT07)", () => {
    test("duyệt → ghi taken cùng giao dịch, số dư giảm; trưởng nhóm phòng cha duyệt được", async () => {
      const id = await withTx((tx) =>
        requestLeave(tx, emp, {
          leaveTypeId: annual,
          startAt: D("2026-11-02T01:00:00Z"),
          endAt: D("2026-11-02T10:00:00Z"),
          minutes: 480,
        }),
      );
      await withTx((tx) => decideLeave(tx, lead, id, "approve"));
      assert.equal(await leaveBalance(db.app, emp.employeeId!, annual), 420);
      const st = await db.admin.query("SELECT status, decided_by_user_id FROM leave_request WHERE id = $1", [
        id,
      ]);
      assert.deepEqual(st.rows[0], { status: "approved", decided_by_user_id: lead.userId });
    });

    test("trùng đơn đã duyệt → LEAVE_OVERLAP trước khi duyệt; DB cũng chặn", async () => {
      const id = await withTx((tx) =>
        requestLeave(tx, emp, {
          leaveTypeId: unpaid,
          startAt: D("2026-11-02T05:00:00Z"),
          endAt: D("2026-11-02T12:00:00Z"),
          minutes: 120,
        }),
      );
      await assert.rejects(
        withTx((tx) => decideLeave(tx, lead, id, "approve")),
        isCode("LEAVE_OVERLAP"),
      );
      await assert.rejects(
        db.admin.query(
          "UPDATE leave_request SET status = 'approved', decided_by_user_id = $2 WHERE id = $1",
          [id, lead.userId],
        ),
        /leave_request_employee_id_tstzrange_excl|conflicting key/,
      );
    });

    test("không đủ phép → INSUFFICIENT_BALANCE; loại không cần số dư thì duyệt được", async () => {
      const big = await withTx((tx) =>
        requestLeave(tx, emp, {
          leaveTypeId: annual,
          startAt: D("2026-11-10T01:00:00Z"),
          endAt: D("2026-11-11T10:00:00Z"),
          minutes: 960,
        }),
      );
      await assert.rejects(
        withTx((tx) => decideLeave(tx, lead, big, "approve")),
        isCode("INSUFFICIENT_BALANCE"),
      );
      const un = await withTx((tx) =>
        requestLeave(tx, emp, {
          leaveTypeId: unpaid,
          startAt: D("2026-11-12T01:00:00Z"),
          endAt: D("2026-11-12T10:00:00Z"),
          minutes: 480,
        }),
      );
      await withTx((tx) => decideLeave(tx, lead, un, "approve"));
    });

    test("S-ID-04/R5: không tự duyệt — người tạo hộ hoặc chủ đơn; trưởng nhóm khác phòng → 403", async () => {
      // Trưởng nhóm tạo đơn hộ nhân viên rồi tự duyệt → SELF_APPROVAL.
      const byLead = await withTx((tx) =>
        requestLeave(tx, lead, {
          employeeId: emp.employeeId!,
          leaveTypeId: unpaid,
          startAt: D("2026-11-20T01:00:00Z"),
          endAt: D("2026-11-20T03:00:00Z"),
          minutes: 120,
        }),
      );
      await assert.rejects(
        withTx((tx) => decideLeave(tx, lead, byLead, "approve")),
        isCode("SELF_APPROVAL"),
      );
      await withTx((tx) => decideLeave(tx, hr, byLead, "approve"));
      // Đơn của chính trưởng nhóm: không tự duyệt dù có quyền trên phòng mình.
      const own = await withTx((tx) =>
        requestLeave(tx, lead, {
          leaveTypeId: unpaid,
          startAt: D("2026-11-21T01:00:00Z"),
          endAt: D("2026-11-21T03:00:00Z"),
          minutes: 120,
        }),
      );
      await assert.rejects(
        withTx((tx) => decideLeave(tx, lead, own, "approve")),
        isCode("SELF_APPROVAL"),
      );
      const x = await withTx((tx) =>
        requestLeave(tx, emp, {
          leaveTypeId: unpaid,
          startAt: D("2026-11-22T01:00:00Z"),
          endAt: D("2026-11-22T03:00:00Z"),
          minutes: 120,
        }),
      );
      await assert.rejects(
        withTx((tx) => decideLeave(tx, otherLead, x, "approve")),
        isCode("FORBIDDEN"),
      );
      await assert.rejects(
        withTx((tx) => decideLeave(tx, lead, x, "reject", "")),
        isCode("VALIDATION"),
      );
      await withTx((tx) => decideLeave(tx, lead, x, "reject", "trùng lịch họp"));
      await assert.rejects(
        withTx((tx) => decideLeave(tx, lead, x, "approve")),
        isCode("INVALID_STATE"),
      );
      // Nhân viên không tạo đơn hộ người khác.
      await assert.rejects(
        withTx((tx) =>
          requestLeave(tx, emp, {
            employeeId: lead.employeeId!,
            leaveTypeId: unpaid,
            startAt: D("2026-11-23T01:00:00Z"),
            endAt: D("2026-11-23T03:00:00Z"),
            minutes: 60,
          }),
        ),
        isCode("FORBIDDEN"),
      );
    });

    test("huỷ đơn đã duyệt → bút toán reversal trả phép, không sửa dòng taken", async () => {
      const before = await leaveBalance(db.app, emp.employeeId!, annual);
      const id = await withTx((tx) =>
        requestLeave(tx, emp, {
          leaveTypeId: annual,
          startAt: D("2026-12-01T01:00:00Z"),
          endAt: D("2026-12-01T03:00:00Z"),
          minutes: 120,
        }),
      );
      await withTx((tx) => decideLeave(tx, lead, id, "approve"));
      assert.equal(await leaveBalance(db.app, emp.employeeId!, annual), before - 120);
      await withTx((tx) => cancelApprovedLeave(tx, hr, id, "dự án dời lịch"));
      assert.equal(await leaveBalance(db.app, emp.employeeId!, annual), before);
      const rows = await db.admin.query(
        "SELECT entry_type, minutes FROM leave_ledger WHERE leave_request_id = $1 ORDER BY id",
        [id],
      );
      assert.deepEqual(
        rows.rows.map((r) => [r.entry_type, r.minutes]),
        [
          ["taken", -120],
          ["reversal", 120],
        ],
      );
      await assert.rejects(
        withTx((tx) => cancelApprovedLeave(tx, hr, id, "lần 2")),
        isCode("INVALID_STATE"),
      );
    });
  });

  describe("OT (S-AT-08)", () => {
    test("đơn OT 5 giờ ngày thường → 422 OT_LIMIT_DAY ngay khi tạo", async () => {
      await assert.rejects(
        withTx((tx) =>
          requestOt(tx, emp, { businessDate: "2026-11-03", minutes: 300, reason: "gấp", consent: true }),
        ),
        isCode("OT_LIMIT_DAY"),
      );
    });

    test("tổng ngày = ca được giao + OT ≤ 12 giờ; kiểm đồng thời trả mọi hạn mức vượt", async () => {
      const tpl = await db.admin.query(
        `INSERT INTO shift_template (company_id, code, name, start_time, end_time, break_minutes)
         VALUES ($1, 'HC', 'Hành chính', '08:00', '17:00', 60) RETURNING id`,
        [org.companyId],
      );
      await db.admin.query(
        "INSERT INTO shift_assignment (company_id, employee_id, business_date, shift_template_id) VALUES ($1, $2, '2026-11-04', $3)",
        [org.companyId, emp.employeeId, tpl.rows[0].id],
      );
      const policy = { id: null, maxOtDay: 300, maxTotalDay: 720, maxMonth: 200, maxYear: 12000 };
      const v = await checkOtLimits(db.app, emp.employeeId!, "2026-11-04", 250, policy);
      // 480' ca + 250' OT = 730' > 720'; 250 > tháng 200 → hai vi phạm cùng lúc.
      assert.deepEqual(
        v.map((x) => x.code),
        ["OT_LIMIT_TOTAL_DAY", "OT_LIMIT_MONTH"],
      );
    });

    test("duyệt cần đồng ý của người lao động; tạo hộ chưa có đồng ý → OT_CONSENT_REQUIRED; tự duyệt → SELF_APPROVAL", async () => {
      const byLead = await withTx((tx) =>
        requestOt(tx, lead, {
          employeeId: emp.employeeId!,
          businessDate: "2026-11-05",
          minutes: 120,
          reason: "chạy tiến độ",
        }),
      );
      await assert.rejects(
        withTx((tx) => decideOt(tx, hr, byLead, "approve")),
        isCode("OT_CONSENT_REQUIRED"),
      );
      await withTx((tx) => giveOtConsent(tx, emp, byLead));
      await assert.rejects(
        withTx((tx) => giveOtConsent(tx, emp, byLead)),
        isCode("NOT_FOUND"),
      );
      await assert.rejects(
        withTx((tx) => decideOt(tx, lead, byLead, "approve")),
        isCode("SELF_APPROVAL"),
      );
      await withTx((tx) => decideOt(tx, hr, byLead, "approve"));
      const own = await withTx((tx) =>
        requestOt(tx, emp, { businessDate: "2026-11-06", minutes: 60, reason: "x", consent: true }),
      );
      // Nhân viên không có quyền duyệt → 403; trưởng nhóm duyệt được.
      await assert.rejects(
        withTx((tx) => decideOt(tx, emp, own, "approve")),
        isCode("FORBIDDEN"),
      );
      await withTx((tx) => decideOt(tx, lead, own, "approve"));
      const db2 = await db.admin.query(
        "SELECT employee_consent_at IS NOT NULL AS c FROM ot_request WHERE id = $1",
        [own],
      );
      assert.equal(db2.rows[0].c, true);
    });

    test("vượt hạn mức tháng khi duyệt: không có căn cứ → 422; có căn cứ cần quyền ngoại lệ (HR)", async () => {
      await db.admin.query(
        "INSERT INTO ot_policy (company_id, valid_from, max_month_minutes, source_note) VALUES ($1, '2026-12-01', 180, 'thử hạn mức')",
        [org.companyId],
      );
      assert.equal((await otPolicyAt(db.app, org.companyId, "2026-12-15")).maxMonth, 180);
      assert.equal(
        (await otPolicyAt(db.app, org.companyId, "2026-11-15")).maxMonth,
        2400,
        "chưa hiệu lực → mặc định",
      );
      const a = await withTx((tx) =>
        requestOt(tx, emp, { businessDate: "2026-12-02", minutes: 120, reason: "a", consent: true }),
      );
      await withTx((tx) => decideOt(tx, lead, a, "approve"));
      const b = await withTx((tx) =>
        requestOt(tx, emp, {
          businessDate: "2026-12-03",
          minutes: 120,
          reason: "b",
          consent: true,
          exceptionBasis: "sự cố",
        }),
      );
      await assert.rejects(
        withTx((tx) => decideOt(tx, lead, b, "approve")),
        isCode("FORBIDDEN"),
      );
      await withTx((tx) => decideOt(tx, hr, b, "approve"));
      await assert.rejects(
        withTx((tx) =>
          requestOt(tx, emp, { businessDate: "2026-12-04", minutes: 60, reason: "c", consent: true }),
        ),
        isCode("OT_LIMIT_MONTH"),
      );
      // DB chặn duyệt khi chưa có đồng ý kể cả ghi tay.
      await assert.rejects(
        db.admin.query(
          `INSERT INTO ot_request (company_id, employee_id, business_date, minutes, reason, status, created_by_user_id)
           VALUES ($1, $2, '2026-12-05', 30, 'tay', 'approved', $3)`,
          [org.companyId, emp.employeeId, hr.userId],
        ),
        /check constraint/,
      );
    });
  });

  describe("kiểm tra đầu vào + hộp duyệt (audit 2026-10-19)", () => {
    test("AUD-CODE-006: số phút nghỉ không được vượt khoảng start..end; đúng bằng khoảng thì qua", async () => {
      const base = {
        leaveTypeId: annual,
        startAt: D("2026-11-09T01:00:00Z"),
        endAt: D("2026-11-09T10:00:00Z"), // 540 phút
      };
      await withTx((tx) =>
        assert.rejects(requestLeave(tx, emp, { ...base, minutes: 541 }), isCode("VALIDATION")),
      );
      const id = await withTx((tx) => requestLeave(tx, emp, { ...base, minutes: 540 }));
      assert.notEqual(id, "");
      await db.admin.query("UPDATE leave_request SET status = 'cancelled' WHERE id = $1", [id]);
    });

    test("AUD-CODE-006: hộp duyệt hiện khoảng ngày của đơn nghỉ", async () => {
      const id = await withTx((tx) =>
        requestLeave(tx, emp, {
          leaveTypeId: annual,
          startAt: D("2026-12-01T01:00:00Z"),
          endAt: D("2026-12-03T10:00:00Z"),
          minutes: 120,
        }),
      );
      const items = await pendingApprovals(db.app, lead);
      const it = items.find((x) => x.id === id);
      assert.ok(it, "đơn nằm trong hộp duyệt của trưởng nhóm");
      assert.match(it.summary, new RegExp(formatDate("2026-12-01").replace(/\//g, "\\/")));
      assert.match(it.summary, new RegExp(formatDate("2026-12-03").replace(/\//g, "\\/")));
      await db.admin.query("UPDATE leave_request SET status = 'cancelled' WHERE id = $1", [id]);
    });

    test("AUD-CODE-008: >500 đơn chờ của phòng khác không làm trống hộp của trưởng nhóm có đơn phía sau", async () => {
      const x = await seedUser(org.companyId, { grants: [{ role: "employee", scopeType: "self" }] });
      await withTx((tx) =>
        assignEmployment(tx, { userId: null }, org.companyId, x.employeeId!, {
          departmentId: org.otherDeptId,
          validFrom: "2026-01-01",
        }),
      );
      await db.admin.query(
        `INSERT INTO leave_request (company_id, employee_id, leave_type_id, start_at, end_at, minutes, created_by_user_id, created_at)
         SELECT $1, $2, $3, '2027-03-01T01:00:00Z', '2027-03-01T05:00:00Z', 60, $4, now() - interval '1 day' - g * interval '1 second'
           FROM generate_series(1, 501) g`,
        [org.companyId, x.employeeId, annual, x.userId],
      );
      const id = await withTx((tx) =>
        requestLeave(tx, emp, {
          leaveTypeId: annual,
          startAt: D("2027-04-01T01:00:00Z"),
          endAt: D("2027-04-01T05:00:00Z"),
          minutes: 120,
        }),
      );
      const items = await pendingApprovals(db.app, lead);
      assert.ok(
        items.some((i) => i.id === id),
        "đơn của D1 phải hiện dù 501 đơn D2 cũ hơn đứng trước",
      );
      assert.ok(
        items.every((i) => i.employeeId !== x.employeeId),
        "không thấy đơn của phòng khác",
      );
      const page = await pendingApprovalsPage(db.app, lead, { limit: 1, offset: 0 });
      assert.equal(page.items.length, 1);
      // trưởng nhóm D2 vẫn thấy đủ 501 đơn của phòng mình (lấy qua nhiều lô)
      const other = await pendingApprovals(db.app, otherLead);
      assert.equal(other.filter((i) => i.employeeId === x.employeeId).length, 501);
      await db.admin.query("DELETE FROM leave_request WHERE employee_id = $1", [x.employeeId]);
      await db.admin.query("UPDATE leave_request SET status = 'cancelled' WHERE id = $1", [id]);
    });
  });
});
