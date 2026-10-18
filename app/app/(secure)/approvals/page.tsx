import type { Metadata } from "next";
import { requireSession } from "@/app/server/session";
import { getPool } from "@/lib/db";
import { pendingApprovals } from "@/lib/attendance/approvals";
import { DecisionButtons } from "@/app/components/decision-buttons";
import { fmtDateTime } from "@/app/components/labels";

export const metadata: Metadata = { title: "Phê duyệt" };
const TYPE: Record<string, string> = { leave: "Nghỉ phép", ot: "Làm thêm", adjustment: "Sửa công" };

export default async function ApprovalsPage() {
  const { actor } = await requireSession();
  const items = await pendingApprovals(getPool(), actor);
  return (
    <>
      <h1>Phê duyệt</h1>
      {items.length === 0 ? (
        <p className="muted">Không có đơn chờ bạn duyệt.</p>
      ) : (
        <ul className="list">
          {items.map((i) => (
            <li key={`${i.type}:${i.id}`}>
              <span className="badge">{TYPE[i.type]}</span> <strong>{i.employeeName}</strong>
              <br />
              {i.summary}
              <br />
              <span className="muted">Gửi lúc {fmtDateTime(i.createdAt.toISOString())}</span>
              <DecisionButtons type={i.type} id={i.id} subject={`${TYPE[i.type]} của ${i.employeeName}`} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
