import type { Metadata } from "next";
import { requireSession } from "@/app/server/session";
import { getPool } from "@/lib/db";
import { dashboard } from "@/lib/dashboard";
import { EMPTY, formatDate, formatNumber } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";
import { localDate } from "@/lib/nen/time";

export const metadata: Metadata = { title: t("dashboard.title") };
const CODE: Record<string, string> = {
  TASK_OVERDUE: t("dashboard.alerts.code.TASK_OVERDUE"),
  TASK_BLOCKED_LONG: t("dashboard.alerts.code.TASK_BLOCKED_LONG"),
  MILESTONE_AT_RISK: t("dashboard.alerts.code.MILESTONE_AT_RISK"),
  ATTENDANCE_NEEDS_REVIEW: t("dashboard.alerts.code.ATTENDANCE_NEEDS_REVIEW"),
  MISSING_CHECKOUT: t("dashboard.alerts.code.MISSING_CHECKOUT"),
};

export default async function DashboardPage() {
  const { actor } = await requireSession();
  const d = await dashboard(getPool(), actor, localDate(new Date()));
  return (
    <>
      <h1>{t("dashboard.title")}</h1>
      <section className="card">
        <h2 id="mocs">{t("dashboard.milestones.heading")}</h2>
        {d.milestones.length === 0 ? (
          <p className="muted">{t("dashboard.milestones.empty")}</p>
        ) : (
          <div className="table-scroll" role="region" aria-labelledby="mocs" tabIndex={0}>
            <table>
              <caption className="visually-hidden">{t("dashboard.milestones.heading")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("dashboard.milestones.project")}</th>
                  <th scope="col">{t("dashboard.milestones.milestone")}</th>
                  <th scope="col">{t("dashboard.milestones.due")}</th>
                  <th scope="col">{t("dashboard.milestones.slip")}</th>
                  <th scope="col">{t("dashboard.milestones.status")}</th>
                </tr>
              </thead>
              <tbody>
                {d.milestones.map((m) => (
                  <tr key={m.id}>
                    <td>{m.projectName}</td>
                    <td>{m.name}</td>
                    <td>{formatDate(m.dueDate)}</td>
                    <td>
                      {m.slipDays === null
                        ? EMPTY
                        : t("dashboard.milestones.slipDays", { days: formatNumber(m.slipDays) })}
                    </td>
                    <td>
                      {m.achieved
                        ? t("dashboard.milestones.achieved")
                        : t("dashboard.milestones.notAchieved")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="card" aria-labelledby="cb">
        <h2 id="cb">{t("dashboard.alerts.heading", { count: formatNumber(d.alerts.length) })}</h2>
        {d.alerts.length === 0 ? (
          <p className="muted">{t("dashboard.alerts.empty")}</p>
        ) : (
          <ul className="list">
            {d.alerts.map((a) => (
              <li key={`${a.code}:${a.objectId}`}>
                <span className="badge warn">{CODE[a.code] ?? a.code}</span> {a.title}
                <br />
                <span className="muted">{t("dashboard.alerts.nextAction", { action: a.nextAction })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
