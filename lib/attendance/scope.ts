// Phạm vi của dữ liệu một nhân viên (cho can()): công ty, chi nhánh, phòng ban tại ngày xét, chủ dữ liệu.
import { appendAudit } from "../audit/index.ts";
import { can, isSelfApproval, type Action, type ActorContext, type Resource } from "../authz/index.ts";
import type { Queryable } from "../db/index.ts";
import { AppError } from "../nen/app-error.ts";
import { localDate } from "../nen/time.ts";
import { t } from "../i18n/index.ts";

export async function employeeResource(
  db: Queryable,
  companyId: string,
  employeeId: string,
  date: string = localDate(new Date()),
): Promise<Resource> {
  const { rows } = await db.query<{ department_id: string | null; branch_id: string | null }>(
    `SELECT h.department_id, d.branch_id FROM employee e
     LEFT JOIN employment_history h ON h.employee_id = e.id AND h.valid_from <= $3::date AND (h.valid_to IS NULL OR h.valid_to > $3::date)
     LEFT JOIN department d ON d.id = h.department_id
     WHERE e.company_id = $1 AND e.id = $2`,
    [companyId, employeeId, date],
  );
  if (!rows[0]) throw new AppError("NOT_FOUND", 404, t("err.attendance.khongTimThayNhanVien"));
  return {
    companyId,
    ownerEmployeeId: employeeId,
    departmentId: rows[0].department_id,
    branchId: rows[0].branch_id,
  };
}

/**
 * Quyền trên dữ liệu của nhân viên; thiếu quyền → 403 FORBIDDEN mang `details.action/object`. Lớp HTTP (withActor)
 * ghi audit `denied` cho lỗi này ở giao dịch riêng (giao dịch nghiệp vụ đã rollback).
 */
export async function requireOn(
  _tx: Queryable,
  actor: ActorContext,
  action: Action,
  res: Resource,
  object: { type: string; id: string },
): Promise<void> {
  if (can(actor, action, res)) return;
  throw new AppError("FORBIDDEN", 403, t("err.shared.banKhongCoQuyenThucHien"), { action, object });
}

/** R5: người tạo đơn / chủ đơn không tự duyệt. */
export function requireNotSelf(actor: ActorContext, creatorUserId: string, ownerEmployeeId: string): void {
  if (
    isSelfApproval(actor, { userId: creatorUserId }) ||
    isSelfApproval(actor, { employeeId: ownerEmployeeId })
  )
    throw new AppError("SELF_APPROVAL", 409, t("err.attendance.khongTheTuDuyetDonCua"));
}

export function auditDecision(
  tx: Queryable,
  actor: ActorContext,
  action: string,
  objectType: string,
  id: string,
  extra: { before?: unknown; after?: unknown; reason?: string | null } = {},
) {
  return appendAudit(tx, {
    actorUserId: actor.userId,
    companyId: actor.companyId,
    action,
    objectType,
    objectId: id,
    before: extra.before,
    after: extra.after,
    reason: extra.reason ?? null,
  });
}
