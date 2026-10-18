// Hộp phê duyệt (§3 Webapp: Phê duyệt): đơn nghỉ, OT, sửa công đang chờ mà người dùng CÓ QUYỀN duyệt (phạm vi),
// không gồm đơn của chính họ (R5). Quyết định đi qua đúng hàm nghiệp vụ (kiểm quyền + kỳ khoá ở đó).
import type { ActorContext } from "../authz/index.ts";
import { can } from "../authz/index.ts";
import type { Queryable } from "../db/index.ts";
import { AppError } from "../nen/app-error.ts";
import { fetchLimit, MAX_PAGE, toPage, type Page, type PageRequest } from "../nen/pagination.ts";
import { decideLeave } from "./leave.ts";
import { decideOt } from "./ot.ts";
import { decideAdjustment } from "./period.ts";
import { employeeResource } from "./scope.ts";
import { t } from "../i18n/index.ts";

export type ApprovalType = "leave" | "ot" | "adjustment";

export interface PendingItem {
  type: ApprovalType;
  id: string;
  employeeId: string;
  employeeName: string;
  summary: string;
  createdAt: Date;
}

/** Truy vấn lõi hàng chờ duyệt — xuất ra để test EXPLAIN (DB-PERF-001). */
export const PENDING_APPROVALS_SQL = `SELECT 'leave' AS type, r.id, r.employee_id, e.full_name, t.name AS label, r.minutes AS minutes, false AS awaiting_consent, r.created_at, r.created_by_user_id
       FROM leave_request r JOIN employee e ON e.id = r.employee_id JOIN leave_type t ON t.id = r.leave_type_id
       WHERE r.company_id = $1 AND r.status = 'pending'
     UNION ALL
     SELECT 'ot', o.id, o.employee_id, e.full_name, o.business_date::text, o.minutes, o.employee_consent_at IS NULL, o.created_at, o.created_by_user_id
       FROM ot_request o JOIN employee e ON e.id = o.employee_id WHERE o.company_id = $1 AND o.status = 'pending'
     UNION ALL
     SELECT 'adjustment', a.id, a.employee_id, e.full_name, a.reason, NULL::int, false, a.created_at, a.created_by_user_id
       FROM attendance_adjustment a JOIN employee e ON e.id = a.employee_id WHERE a.company_id = $1 AND a.status = 'pending'
     ORDER BY created_at, id LIMIT 500`;

/** Tóm tắt hiển thị dựng ở TS (không nhúng chữ vào SQL) từ cột thô: nhãn/ngày/lý do, số phút, cờ chờ đồng ý. */
function summarize(r: {
  type: ApprovalType;
  label: string;
  minutes: number | null;
  awaiting_consent: boolean;
}): string {
  const minutes = r.minutes ?? 0;
  if (r.type === "leave") return t("msg.approvals.summaryLeave", { name: r.label, minutes });
  if (r.type === "ot")
    return r.awaiting_consent
      ? t("msg.approvals.summaryOtAwaitingConsent", { date: r.label, minutes })
      : t("msg.approvals.summaryOt", { date: r.label, minutes });
  return t("msg.approvals.summaryAdjustment", { reason: r.label });
}

export async function pendingApprovals(db: Queryable, actor: ActorContext): Promise<PendingItem[]> {
  const { rows } = await db.query<{
    type: ApprovalType;
    id: string;
    employee_id: string;
    full_name: string;
    label: string;
    minutes: number | null;
    awaiting_consent: boolean;
    created_at: Date;
    created_by_user_id: string;
  }>(PENDING_APPROVALS_SQL, [actor.companyId]);
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
      summary: summarize(r),
      createdAt: r.created_at,
    });
  }
  return out;
}

/**
 * Một trang hộp duyệt (XC-PERF-006). Lọc quyền chạy sau SQL (trần 500 ứng viên) nên phân trang cắt trên kết quả đã lọc,
 * thứ tự ổn định (created_at, id).
 */
export async function pendingApprovalsPage(
  db: Queryable,
  actor: ActorContext,
  page: PageRequest = MAX_PAGE,
): Promise<Page<PendingItem>> {
  const all = await pendingApprovals(db, actor);
  return toPage(all.slice(page.offset, page.offset + fetchLimit(page)), page);
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
  throw new AppError("NOT_FOUND", 404, t("err.attendance.loaiDonKhongHopLe"));
}
