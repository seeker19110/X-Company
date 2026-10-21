// Hộp phê duyệt (§3 Webapp: Phê duyệt): đơn nghỉ, OT, sửa công đang chờ mà người dùng CÓ QUYỀN duyệt (phạm vi),
// không gồm đơn của chính họ (R5). Quyết định đi qua đúng hàm nghiệp vụ (kiểm quyền + kỳ khoá ở đó).
import type { ActorContext } from "../authz/index.ts";
import { can } from "../authz/index.ts";
import type { Queryable } from "../db/index.ts";
import { formatDate, formatDateTime } from "../i18n/format.ts";
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

/** Số dòng mỗi lần lấy (keyset theo created_at, id). Lọc quyền chạy SAU SQL nên phải lấy tiếp tới khi đủ/hết, không cắt cứng. */
const BATCH = 500; // khớp `LIMIT 500` trong PENDING_APPROVALS_SQL

/**
 * Truy vấn lõi hàng chờ duyệt — xuất ra để test EXPLAIN (DB-PERF-001). $2/$3 = con trỏ keyset (created_at, id) của dòng cuối
 * lô trước (NULL = lô đầu). Cột `at_from`/`at_to`/`kind` để người duyệt thấy NGÀY của đơn nghỉ và LOẠI/GIỜ của sự kiện thêm tay.
 */
export const PENDING_APPROVALS_SQL = `SELECT 'leave' AS type, r.id, r.employee_id, e.full_name, t.name AS label, r.minutes AS minutes, false AS awaiting_consent,
         r.start_at AS at_from, r.end_at AS at_to, NULL::text AS kind, r.created_at, r.created_at::text AS cursor_at, r.created_by_user_id
       FROM leave_request r JOIN employee e ON e.id = r.employee_id JOIN leave_type t ON t.id = r.leave_type_id
       WHERE r.company_id = $1 AND r.status = 'pending' AND ($2::timestamptz IS NULL OR (r.created_at, r.id) > ($2::timestamptz, $3::uuid))
     UNION ALL
     SELECT 'ot', o.id, o.employee_id, e.full_name, o.business_date::text, o.minutes, o.employee_consent_at IS NULL,
         NULL::timestamptz, NULL::timestamptz, NULL::text, o.created_at, o.created_at::text, o.created_by_user_id
       FROM ot_request o JOIN employee e ON e.id = o.employee_id
       WHERE o.company_id = $1 AND o.status = 'pending' AND ($2::timestamptz IS NULL OR (o.created_at, o.id) > ($2::timestamptz, $3::uuid))
     UNION ALL
     SELECT 'adjustment', a.id, a.employee_id, e.full_name, a.reason, NULL::int, false,
         a.new_at, NULL::timestamptz, a.new_kind, a.created_at, a.created_at::text, a.created_by_user_id
       FROM attendance_adjustment a JOIN employee e ON e.id = a.employee_id
       WHERE a.company_id = $1 AND a.status = 'pending' AND ($2::timestamptz IS NULL OR (a.created_at, a.id) > ($2::timestamptz, $3::uuid))
     ORDER BY created_at, id LIMIT 500`; // 500 = BATCH (viết thẳng: không nội suy vào SQL)

interface PendingRow {
  type: ApprovalType;
  id: string;
  employee_id: string;
  full_name: string;
  label: string;
  minutes: number | null;
  awaiting_consent: boolean;
  at_from: Date | null;
  at_to: Date | null;
  kind: string | null;
  created_at: Date;
  /** created_at dạng chuỗi đủ độ chính xác micro giây — Date của JS chỉ tới mili giây, làm con trỏ keyset lặp lại dòng cuối lô. */
  cursor_at: string;
  created_by_user_id: string;
}

/** Tóm tắt hiển thị dựng ở TS (không nhúng chữ vào SQL) từ cột thô: nhãn/ngày/lý do, số phút, cờ chờ đồng ý. */
function summarize(r: PendingRow): string {
  const minutes = r.minutes ?? 0;
  if (r.type === "leave")
    return t("msg.approvals.summaryLeave", {
      name: r.label,
      from: r.at_from ? formatDate(r.at_from) : "",
      to: r.at_to ? formatDate(r.at_to) : "",
      minutes,
    });
  if (r.type === "ot")
    return r.awaiting_consent
      ? t("msg.approvals.summaryOtAwaitingConsent", { date: r.label, minutes })
      : t("msg.approvals.summaryOt", { date: r.label, minutes });
  if (r.kind !== null && r.at_from !== null)
    return t("msg.approvals.summaryAdjustmentAdd", {
      kind: r.kind,
      at: formatDateTime(r.at_from),
      reason: r.label,
    });
  return t("msg.approvals.summaryAdjustment", { reason: r.label });
}

/**
 * Đơn chờ người dùng CÓ QUYỀN duyệt, cũ nhất trước. Lọc quyền sau SQL nên lấy theo lô keyset tới khi đủ `want` mục (hoặc hết đơn) —
 * trước đây cắt cứng 500 đơn đầu của cả công ty rồi mới lọc, đơn của phòng khác đứng trước làm hộp trống (AUD-CODE-008).
 */
export async function pendingApprovals(
  db: Queryable,
  actor: ActorContext,
  want = Number.POSITIVE_INFINITY,
): Promise<PendingItem[]> {
  const out: PendingItem[] = [];
  const resources = new Map<string, Awaited<ReturnType<typeof employeeResource>>>();
  let curAt: string | null = null;
  let curId: string | null = null;
  while (out.length < want) {
    const res: { rows: PendingRow[] } = await db.query<PendingRow>(PENDING_APPROVALS_SQL, [
      actor.companyId,
      curAt,
      curId,
    ]);
    const rows = res.rows;
    for (const r of rows) {
      if (r.created_by_user_id === actor.userId || r.employee_id === actor.employeeId) continue; // R5
      // Cùng ngày xét phạm vi với hàm quyết định (AUD-CODE-009): OT theo business_date (`decideOt`), nghỉ/sửa công theo hôm
      // nay (`decideLeave`/`decideAdjustment`) — lệch ngày thì người thấy đơn bị 403 còn người duyệt được lại không thấy.
      const date = r.type === "ot" ? r.label : undefined;
      const key = `${r.employee_id}|${date ?? ""}`;
      let scope = resources.get(key);
      if (scope === undefined) {
        scope = await employeeResource(db, actor.companyId, r.employee_id, date);
        resources.set(key, scope);
      }
      if (!can(actor, "attendance.approve", scope)) continue;
      out.push({
        type: r.type,
        id: r.id,
        employeeId: r.employee_id,
        employeeName: r.full_name,
        summary: summarize(r),
        createdAt: r.created_at,
      });
    }
    const last: PendingRow | undefined = rows[rows.length - 1];
    if (rows.length < BATCH || last === undefined) break;
    curAt = last.cursor_at;
    curId = last.id;
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
  const all = await pendingApprovals(db, actor, page.offset + fetchLimit(page));
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
