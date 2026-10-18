import type { Metadata } from "next";
import { requireSession } from "@/app/server/session";
import { getPool } from "@/lib/db";
import { EVENT_STATUS, fmtDateTime, KIND_LABEL } from "@/app/components/labels";
import { RequestForms } from "@/app/components/request-forms";

export const metadata: Metadata = { title: "Chấm công" };

export default async function AttendancePage() {
  const { actor } = await requireSession();
  const pool = getPool();
  const events = actor.employeeId
    ? (
        await pool.query<{
          id: string;
          kind: string;
          device_time: Date;
          status: string;
          review_reason: string | null;
        }>(
          `SELECT id, kind, device_time, status, review_reason FROM attendance_event
           WHERE employee_id = $1 AND device_time >= now() - interval '14 days' AND voided_by_adjustment_id IS NULL
           ORDER BY device_time DESC LIMIT 100`,
          [actor.employeeId],
        )
      ).rows
    : [];
  const types = (
    await pool.query<{ id: string; name: string }>(
      "SELECT id, name FROM leave_type WHERE company_id = $1 ORDER BY name",
      [actor.companyId],
    )
  ).rows;
  return (
    <>
      <h1>Chấm công</h1>
      <section className="card" aria-labelledby="lich-su">
        <h2 id="lich-su">14 ngày gần đây</h2>
        {events.length === 0 ? (
          <p className="muted">Chưa có lần chấm nào.</p>
        ) : (
          <ul className="list">
            {events.map((e) => (
              <li key={e.id}>
                {KIND_LABEL[e.kind] ?? e.kind} · {fmtDateTime(e.device_time.toISOString())} ·{" "}
                <span className={`badge ${EVENT_STATUS[e.status]?.cls ?? ""}`}>
                  {EVENT_STATUS[e.status]?.label ?? e.status}
                </span>
                {e.review_reason && <span className="muted"> ({e.review_reason})</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <RequestForms leaveTypes={types} />
    </>
  );
}
