import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/app/server/session";
import { getPool } from "@/lib/db";
import { todayView } from "@/lib/today";
import { EVENT_STATUS, fmtTime, KIND_LABEL, TASK_STATUS } from "@/app/components/labels";
import { ClockButtons } from "@/app/components/clock-buttons";

export const metadata: Metadata = { title: "Hôm nay" };

export default async function TodayPage() {
  const { actor } = await requireSession();
  const v = await todayView(getPool(), actor);
  const last = v.events.filter((e) => e.kind === "in" || e.kind === "out").at(-1);
  return (
    <>
      <h1>Hôm nay</h1>
      <section className="card" aria-labelledby="ca">
        <h2 id="ca">Ca làm việc</h2>
        {v.shifts.length === 0 ? (
          <p className="muted">Hôm nay bạn không có ca được giao.</p>
        ) : (
          <ul className="list">
            {v.shifts.map((s) => (
              <li key={s.id}>
                <strong>{s.name}</strong> {s.start}–{s.end}
                {s.worksite && <> · {s.worksite}</>}
              </li>
            ))}
          </ul>
        )}
        <ClockButtons nextKind={last?.kind === "in" ? "out" : "in"} />
        {v.events.length > 0 && (
          <ul className="list" aria-label="Lần chấm gần đây">
            {v.events.map((e) => (
              <li key={e.at}>
                {KIND_LABEL[e.kind] ?? e.kind} lúc {fmtTime(e.at)} ·{" "}
                <span className={`badge ${EVENT_STATUS[e.status]?.cls ?? ""}`}>
                  {EVENT_STATUS[e.status]?.label ?? e.status}
                </span>
                {e.reviewReason && <span className="muted"> ({e.reviewReason})</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card" aria-labelledby="viec">
        <h2 id="viec">Việc ưu tiên</h2>
        {v.tasks.length === 0 ? (
          <p className="muted">Không có việc đang mở.</p>
        ) : (
          <ul className="list">
            {v.tasks.map((t) => (
              <li key={t.id}>
                <strong>{t.title}</strong> · {TASK_STATUS[t.status] ?? t.status}
                {t.due_date && <> · hạn {t.due_date}</>}
                <br />
                <span className="muted">{t.project_name}</span>
              </li>
            ))}
          </ul>
        )}
        <Link href="/app/tasks">Xem tất cả công việc</Link>
      </section>
      <section className="card" aria-labelledby="cho">
        <h2 id="cho">Đang chờ</h2>
        <p>Đơn của tôi đang chờ duyệt: {v.myPending}</p>
        <p>
          <Link href="/app/dashboard">Bảng điều hành (ngoại lệ, mốc bàn giao)</Link>
        </p>
        {v.toApprove > 0 && (
          <p>
            <Link href="/app/approvals">Có {v.toApprove} đơn chờ bạn duyệt</Link>
          </p>
        )}
      </section>
    </>
  );
}
