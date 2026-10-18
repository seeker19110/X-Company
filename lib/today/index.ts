// Dữ liệu màn hình "Hôm nay" (SPEC-pwa): ca hôm nay, sự kiện đã chấm, việc ưu tiên (≤ 5), đơn đang chờ của tôi,
// số việc chờ tôi duyệt. Chỉ dữ liệu của chính người dùng.
import type { ActorContext } from "../authz/index.ts";
import type { Queryable } from "../db/index.ts";
import { pendingApprovals } from "../attendance/approvals.ts";
import { shiftBounds } from "../attendance/compute.ts";
import { localDate } from "../nen/time.ts";
import { myTasks } from "../work/routes.ts";

export interface TodayView {
  date: string;
  shifts: {
    id: string;
    name: string;
    start: string;
    end: string;
    worksite: string | null;
    startsAt: string;
    endsAt: string;
  }[];
  events: { kind: string; at: string; status: string; reviewReason: string | null }[];
  tasks: Awaited<ReturnType<typeof myTasks>>;
  myPending: number;
  toApprove: number;
}

/** Sự kiện công 20 giờ gần nhất của nhân viên — xuất ra để test EXPLAIN (DB-PERF-001). */
export const TODAY_EVENTS_SQL = `SELECT kind, device_time, status, review_reason FROM attendance_event
       WHERE employee_id = $1 AND device_time >= now() - interval '20 hours' AND voided_by_adjustment_id IS NULL
       ORDER BY device_time`;

export async function todayView(
  db: Queryable,
  actor: ActorContext,
  now: Date = new Date(),
): Promise<TodayView> {
  const date = localDate(now);
  const view: TodayView = { date, shifts: [], events: [], tasks: [], myPending: 0, toApprove: 0 };
  if (actor.employeeId) {
    const s = await db.query<{
      id: string;
      name: string;
      start: string;
      end: string;
      tz: string;
      worksite: string | null;
      business_date: string;
    }>(
      `SELECT a.id, s.name, to_char(s.start_time, 'HH24:MI') AS start, to_char(s.end_time, 'HH24:MI') AS end, s.tz,
              w.name AS worksite, a.business_date
       FROM shift_assignment a JOIN shift_template s ON s.id = a.shift_template_id LEFT JOIN worksite w ON w.id = a.worksite_id
       WHERE a.employee_id = $1 AND a.business_date = $2::date ORDER BY s.start_time`,
      [actor.employeeId, date],
    );
    view.shifts = s.rows.map((r) => {
      const b = shiftBounds({
        businessDate: r.business_date,
        start: r.start,
        end: r.end,
        breakMinutes: 0,
        tz: r.tz,
      });
      return {
        id: r.id,
        name: r.name,
        start: r.start,
        end: r.end,
        worksite: r.worksite,
        startsAt: b.start.toISOString(),
        endsAt: b.end.toISOString(),
      };
    });
    const e = await db.query<{
      kind: string;
      device_time: Date;
      status: string;
      review_reason: string | null;
    }>(TODAY_EVENTS_SQL, [actor.employeeId]);
    view.events = e.rows.map((r) => ({
      kind: r.kind,
      at: r.device_time.toISOString(),
      status: r.status,
      reviewReason: r.review_reason,
    }));
    view.tasks = (await myTasks(db, actor.companyId, actor.employeeId)).slice(0, 5);
    const p = await db.query<{ n: number }>(
      `SELECT (SELECT count(*) FROM leave_request WHERE employee_id = $1 AND status = 'pending')
            + (SELECT count(*) FROM ot_request WHERE employee_id = $1 AND status = 'pending')
            + (SELECT count(*) FROM attendance_adjustment WHERE employee_id = $1 AND status = 'pending') AS n`,
      [actor.employeeId],
    );
    view.myPending = Number(p.rows[0]?.n ?? 0);
  }
  view.toApprove = (await pendingApprovals(db, actor)).length;
  return view;
}
