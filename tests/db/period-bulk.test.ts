import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { withTx, type Queryable } from "../../lib/db/index.ts";
import { loadActor } from "../../lib/authz/load.ts";
import type { ActorContext } from "../../lib/authz/index.ts";
import {
  advancePeriod,
  computeLines,
  createPeriod,
  getExport,
  lockPeriod,
} from "../../lib/attendance/period.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { seedCompany, seedUser } from "../helpers/fixtures.ts";

// AUD-PERF-001: chốt kỳ ghi dòng công theo lô (unnest), không một INSERT mỗi dòng.
// Lô 200 nhân viên × 31 ngày: dòng ghi ra phải trùng từng cột với computeLines, đúng thứ tự, và số câu SQL không tăng theo số dòng.
const EMPLOYEES = 200;
const START = "2026-10-01";
const END = "2026-10-31";
const DAYS = 31;

describe("chốt kỳ công theo lô (AUD-PERF-001)", () => {
  let db: TestDb;
  let hr: ActorContext;
  let companyId: string;
  let periodId: string;

  before(async () => {
    db = await freshDb();
    const org = await seedCompany("Công ty Lô");
    companyId = org.companyId;
    hr = (await loadActor(
      db.app,
      (await seedUser(companyId, { grants: [{ role: "hr", scopeType: "company" }] })).userId,
    ))!;
    const tpl = (
      await db.admin.query<{ id: string }>(
        `INSERT INTO shift_template (company_id, code, name, start_time, end_time, break_minutes)
         VALUES ($1, 'HC', 'Hành chính', '08:00', '17:00', 60) RETURNING id`,
        [companyId],
      )
    ).rows[0]!.id;
    await db.admin.query(
      `INSERT INTO employee (company_id, code, full_name)
       SELECT $1, 'LO' || lpad(i::text, 4, '0'), 'Nhân viên lô ' || i FROM generate_series(1, $2::int) AS i`,
      [companyId, EMPLOYEES],
    );
    // Mỗi nhân viên lô có ca mọi ngày trong tháng (vắng → present_minutes NULL, shift_assignment_id có giá trị).
    await db.admin.query(
      `INSERT INTO shift_assignment (company_id, employee_id, business_date, shift_template_id)
       SELECT $1, e.id, d::date, $2 FROM employee e, generate_series($3::date, $4::date, interval '1 day') AS d
       WHERE e.company_id = $1 AND e.code LIKE 'LO%'`,
      [companyId, tpl, START, END],
    );
    // 10 nhân viên đầu đi làm đủ giờ mọi ngày (status ok, present_minutes 480).
    await db.admin.query(
      `INSERT INTO attendance_event (company_id, employee_id, idempotency_key, request_hash, kind, device_time, source, status)
       SELECT $1, e.id, 'bulk-' || k.kind || '-' || e.code || '-' || d::date, 'h', k.kind,
              (d::date + k.t) AT TIME ZONE 'Asia/Ho_Chi_Minh', 'gps', 'accepted'
       FROM employee e, generate_series($2::date, $3::date, interval '1 day') AS d,
            (VALUES ('in', time '08:00'), ('out', time '17:00')) AS k(kind, t)
       WHERE e.company_id = $1 AND e.code BETWEEN 'LO0001' AND 'LO0010'`,
      [companyId, START, END],
    );
    // OT đã duyệt: ngày có ca (cộng vào dòng ca) và ngày ngoài ca của nhân viên chưa có ca → dòng ot_only (shift NULL).
    const extra = (await seedUser(companyId)).employeeId!;
    await db.admin.query(
      `INSERT INTO ot_request (company_id, employee_id, business_date, minutes, reason, status, created_by_user_id,
         employee_consent_at)
       SELECT $1, e.id, $2::date, 90, 'chạy lô', 'approved', $3::uuid, now() FROM employee e
       WHERE e.company_id = $1 AND e.code BETWEEN 'LO0001' AND 'LO0005'
       UNION ALL SELECT $1, $4::uuid, $2::date, 120, 'trực', 'approved', $3::uuid, now()`,
      [companyId, "2026-10-15", hr.userId, extra],
    );
    periodId = await withTx((tx) =>
      createPeriod(tx, hr, { code: "2026-10", startDate: START, endDate: END }),
    );
    for (const s of ["employee_review", "manager_confirmed", "hr_closed"] as const)
      await withTx((tx) => advancePeriod(tx, hr, periodId, s));
  });
  after(async () => {
    await db.close();
  });

  test("lô 200×31: dòng ghi trùng computeLines từng cột, đúng thứ tự; số câu SQL không phụ thuộc số dòng", async () => {
    const expected = await computeLines(db.app, companyId, START, END);
    assert.equal(expected.length, EMPLOYEES * DAYS + 1);
    assert.ok(expected.some((l) => l.status === "ok" && l.presentMinutes === 480));
    assert.ok(expected.some((l) => l.status === "absent" && l.presentMinutes === null));
    assert.ok(expected.some((l) => l.status === "ot_only" && l.shiftAssignmentId === null));
    assert.ok(expected.some((l) => l.status === "ok" && l.otApprovedMinutes === 90));

    let queries = 0;
    const started = performance.now();
    const res = await withTx((tx) => {
      const spy = {
        query: (...args: unknown[]) => {
          queries++;
          return (tx.query as (...a: unknown[]) => unknown)(...args);
        },
      } as unknown as Queryable;
      return lockPeriod(spy, hr, periodId);
    });
    const ms = performance.now() - started;
    // Số đo ghi vào log test để so trước/sau (không phải ngưỡng thời gian).
    console.log(`AUD-PERF-001 lockPeriod ${expected.length} dòng: ${queries} câu SQL, ${ms.toFixed(0)} ms`);
    assert.equal(res.version, 1);
    // Trước khi gom: ≥ 6.201 câu (một INSERT mỗi dòng). Sau: hằng số nhỏ, không phụ thuộc số dòng.
    assert.ok(queries < 50, `lockPeriod chạy ${queries} câu SQL`);

    const { rows } = await db.admin.query<{
      employee_id: string;
      business_date: string;
      shift_assignment_id: string | null;
      status: string;
      present_minutes: number | null;
      ot_approved_minutes: number;
      leave_minutes: number;
      note: string | null;
    }>(
      `SELECT employee_id, business_date, shift_assignment_id, status, present_minutes, ot_approved_minutes,
              leave_minutes, note
       FROM period_line WHERE period_id = $1 AND version = 1 ORDER BY id`,
      [periodId],
    );
    assert.deepEqual(
      rows,
      expected.map((l) => ({
        employee_id: l.employeeId,
        business_date: l.businessDate,
        shift_assignment_id: l.shiftAssignmentId,
        status: l.status,
        present_minutes: l.presentMinutes,
        ot_approved_minutes: l.otApprovedMinutes,
        leave_minutes: l.leaveMinutes,
        note: null,
      })),
    );
    const exp = await getExport(db.app, hr, periodId);
    assert.equal(exp.rowCount, expected.length);
    assert.equal(exp.checksum, res.checksum);
  });
});
