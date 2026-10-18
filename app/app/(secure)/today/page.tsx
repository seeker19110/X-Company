import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/app/server/session";
import { getPool } from "@/lib/db";
import { todayView } from "@/lib/today";
import { EVENT_STATUS, KIND_LABEL, TASK_STATUS } from "@/app/components/labels";
import { ClockButtons } from "@/app/components/clock-buttons";
import { formatDate, formatNumber, formatTime } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("today.title") };

export default async function TodayPage() {
  const { actor } = await requireSession();
  const v = await todayView(getPool(), actor);
  const last = v.events.filter((e) => e.kind === "in" || e.kind === "out").at(-1);
  return (
    <>
      <h1>{t("today.title")}</h1>
      <section className="card" aria-labelledby="ca">
        <h2 id="ca">{t("today.shiftsHeading")}</h2>
        {v.shifts.length === 0 ? (
          <p className="muted">{t("today.shiftsEmpty")}</p>
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
          <ul className="list" aria-label={t("today.recentEvents")}>
            {v.events.map((e) => (
              <li key={e.at}>
                {t("today.eventAt", { kind: KIND_LABEL[e.kind] ?? e.kind, time: formatTime(e.at) })} ·{" "}
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
        <h2 id="viec">{t("today.tasksHeading")}</h2>
        {v.tasks.length === 0 ? (
          <p className="muted">{t("today.tasksEmpty")}</p>
        ) : (
          <ul className="list">
            {v.tasks.map((task) => (
              <li key={task.id}>
                <strong>{task.title}</strong> · {TASK_STATUS[task.status] ?? task.status}
                {task.due_date && <> · {t("tasks.due", { date: formatDate(task.due_date) })}</>}
                <br />
                <span className="muted">{task.project_name}</span>
              </li>
            ))}
          </ul>
        )}
        <Link href="/app/tasks">{t("today.allTasks")}</Link>
      </section>
      <section className="card" aria-labelledby="cho">
        <h2 id="cho">{t("today.waitingHeading")}</h2>
        <p>{t("today.myPending", { count: formatNumber(v.myPending) })}</p>
        <p>
          <Link href="/app/dashboard">{t("today.dashboardLink")}</Link>
        </p>
        {v.toApprove > 0 && (
          <p>
            <Link href="/app/approvals">{t("today.toApprove", { count: formatNumber(v.toApprove) })}</Link>
          </p>
        )}
      </section>
    </>
  );
}
