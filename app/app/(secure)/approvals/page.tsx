import type { Metadata } from "next";
import { requireSession } from "@/app/server/session";
import { getPool } from "@/lib/db";
import { pendingApprovals } from "@/lib/attendance/approvals";
import { DecisionButtons } from "@/app/components/decision-buttons";
import { formatDateTime } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("approvals.title") };
const TYPE: Record<string, string> = {
  leave: t("approvals.type.leave"),
  ot: t("approvals.type.ot"),
  adjustment: t("approvals.type.adjustment"),
};

export default async function ApprovalsPage() {
  const { actor } = await requireSession();
  const items = await pendingApprovals(getPool(), actor);
  return (
    <>
      <h1>{t("approvals.title")}</h1>
      {items.length === 0 ? (
        <p className="muted">{t("approvals.empty")}</p>
      ) : (
        <ul className="list">
          {items.map((i) => (
            <li key={`${i.type}:${i.id}`}>
              <span className="badge">{TYPE[i.type]}</span> <strong>{i.employeeName}</strong>
              <br />
              {i.summary}
              <br />
              <span className="muted">{t("approvals.sentAt", { time: formatDateTime(i.createdAt) })}</span>
              <DecisionButtons
                type={i.type}
                id={i.id}
                subject={t("approvals.subject", { type: TYPE[i.type] ?? i.type, name: i.employeeName })}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
