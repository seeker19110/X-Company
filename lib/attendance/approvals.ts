// Hộp phê duyệt (§3 Webapp: Phê duyệt): đơn nghỉ, OT, sửa công đang chờ mà người dùng CÓ QUYỀN duyệt (phạm vi),
// không gồm đơn của chính họ (R5). Quyết định đi qua đúng hàm nghiệp vụ (kiểm quyền + kỳ khoá ở đó).
import type { ActorContext } from "../authz/index.ts";
import { can } from "../authz/index.ts";
import type { Queryable } from "../db/index.ts";
import { AppError } from "../nen/app-error.ts";
import { decideLeave } from "./leave.ts";
import { decideOt } from "./ot.ts";
import { decideAdjustment } from "./period.ts";
import { employeeResource } from "./scope.ts";

export type ApprovalType = "leave" | "ot" | "adjustment";

export interface PendingItem {
  type: ApprovalType;
  id: string;
  employeeId: string;
  employeeName: string;
  summary: string;
  createdAt: Date;
}

export async function pendingApprovals(db: Queryable, actor: ActorContext): Promise<PendingItem[]> {
  const { rows } = await db.query<{
    type: ApprovalType;
    id: string;
    employee_id: string;
    full_name: string;
    summary: string;
    created_at: Date;
    created_by_user_id: string;
  }>(
    `SELECT 'leave' AS type, r.id, r.employee_id, e.full_name, t.name || ' · ' || r.minutes || ' phút' AS summary, r.created_at, r.created_by_user_id
       FROM leave_request r JOIN employee e ON e.id = r.employee_id JOIN leave_type t ON t.id = r.leave_type_id
       WHERE r.company_id = $1 AND r.status = 'pending'
     UNION ALL
     SELECT 'ot', o.id, o.employee_id, e.full_name, 'OT ' || o.business_date || ' · ' || o.minutes || ' phút'
              || CASE WHEN o.employee_consent_at IS NULL THEN ' (chờ đồng ý)' ELSE '' END, o.created_at, o.created_by_user_id
       FROM ot_request o JOIN employee e ON e.id = o.employee_id WHERE o.company_id = $1 AND o.status = 'pending'
     UNION ALL
     SELECT 'adjustment', a.id, a.employee_id, e.full_name, 'Sửa công: ' || a.reason, a.created_at, a.created_by_user_id
       FROM attendance_adjustment a JOIN employee e ON e.id = a.employee_id WHERE a.company_id = $1 AND a.status = 'pending'
     ORDER BY created_at LIMIT 500`,
    [actor.companyId],
  );
  const out: PendingItem[] = [];
  for (const r of rows) {
    if (r.created_by_user_id === actor.userId || r.employee_id === actor.employeeId) continue; // R5
    const res = await employeeResource(db, actor.companyId, r.employee_id);
    if (!can(actor, "attendance.approve", res)) continue;
    out.push({
      type: r.type,
      id: r.id,
      employeeId: r.employee_id,
      employeeName: r.full_name,
      summary: r.summary,
      createdAt: r.created_at,
    });
  }
  return out;
}

export async function decide(
  tx: Queryable,
  actor: ActorContext,
  type: ApprovalType,
  id: string,
  decision: "approve" | "reject",
  note?: string | null,
): Promise<void> {
  if (type === "leave") return decideLeave(tx, actor, id, decision, note);
  if (type === "ot") return decideOt(tx, actor, id, decision, note);
  if (type === "adjustment") {
    await decideAdjustment(tx, actor, id, decision, note);
    return;
  }
  throw new AppError("NOT_FOUND", 404, "Loại đơn không hợp lệ");
}
