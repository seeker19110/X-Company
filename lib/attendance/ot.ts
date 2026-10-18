// Làm thêm giờ (F-005, AT07): đơn OT, đồng ý của người lao động ghi riêng (BLLĐ Điều 107), hạn mức ngày/tháng/năm
// kiểm ĐỒNG THỜI theo ot_policy có hiệu lực; vượt cần căn cứ + quyền attendance.ot_exception. Không tự duyệt.
import type { ActorContext } from "../authz/index.ts";
import { can } from "../authz/index.ts";
import type { Queryable } from "../db/index.ts";
import { AppError } from "../nen/app-error.ts";
import { guardPeriodChange } from "./period.ts";
import { auditDecision, employeeResource, requireNotSelf, requireOn } from "./scope.ts";

export interface OtPolicy {
  id: string | null;
  maxOtDay: number;
  maxTotalDay: number;
  maxMonth: number;
  maxYear: number;
}

export const DEFAULT_OT_POLICY: OtPolicy = {
  id: null,
  maxOtDay: 240,
  maxTotalDay: 720,
  maxMonth: 2400,
  maxYear: 12000,
};

export async function otPolicyAt(db: Queryable, companyId: string, date: string): Promise<OtPolicy> {
  const { rows } = await db.query<{
    id: string;
    max_ot_day_minutes: number;
    max_total_day_minutes: number;
    max_month_minutes: number;
    max_year_minutes: number;
  }>(
    "SELECT * FROM ot_policy WHERE company_id = $1 AND valid_from <= $2::date ORDER BY valid_from DESC LIMIT 1",
    [companyId, date],
  );
  const r = rows[0];
  return r
    ? {
        id: r.id,
        maxOtDay: r.max_ot_day_minutes,
        maxTotalDay: r.max_total_day_minutes,
        maxMonth: r.max_month_minutes,
        maxYear: r.max_year_minutes,
      }
    : DEFAULT_OT_POLICY;
}

/** Phút làm việc theo ca được giao trong ngày nghiệp vụ (thời lượng ca − nghỉ). */
async function scheduledMinutes(db: Queryable, employeeId: string, date: string): Promise<number> {
  const { rows } = await db.query<{ m: string | null }>(
    `SELECT sum(
       (EXTRACT(EPOCH FROM (CASE WHEN s.end_time > s.start_time THEN s.end_time - s.start_time
                               ELSE s.end_time - s.start_time + interval '24 hours' END)) / 60)::int - s.break_minutes
     ) AS m
     FROM shift_assignment a JOIN shift_template s ON s.id = a.shift_template_id
     WHERE a.employee_id = $1 AND a.business_date = $2::date`,
    [employeeId, date],
  );
  return Number(rows[0]?.m ?? 0);
}

export interface LimitCheck {
  code: "OT_LIMIT_DAY" | "OT_LIMIT_TOTAL_DAY" | "OT_LIMIT_MONTH" | "OT_LIMIT_YEAR";
  limit: number;
  total: number;
}

/** Mọi hạn mức bị vượt nếu thêm `minutes` OT đã duyệt vào ngày `date` (kiểm đồng thời — không dừng ở cái đầu). */
export async function checkOtLimits(
  db: Queryable,
  employeeId: string,
  date: string,
  minutes: number,
  policy: OtPolicy,
  excludeRequestId: string | null = null,
): Promise<LimitCheck[]> {
  const { rows } = await db.query<{ day: string; month: string; year: string }>(
    `SELECT
       COALESCE(sum(minutes) FILTER (WHERE business_date = $2::date), 0) AS day,
       COALESCE(sum(minutes) FILTER (WHERE date_trunc('month', business_date) = date_trunc('month', $2::date)), 0) AS month,
       COALESCE(sum(minutes) FILTER (WHERE date_trunc('year', business_date) = date_trunc('year', $2::date)), 0) AS year
     FROM ot_request WHERE employee_id = $1 AND status = 'approved' AND id IS DISTINCT FROM $3`,
    [employeeId, date, excludeRequestId],
  );
  const day = Number(rows[0]!.day) + minutes;
  const month = Number(rows[0]!.month) + minutes;
  const year = Number(rows[0]!.year) + minutes;
  const total = (await scheduledMinutes(db, employeeId, date)) + day;
  const out: LimitCheck[] = [];
  if (day > policy.maxOtDay) out.push({ code: "OT_LIMIT_DAY", limit: policy.maxOtDay, total: day });
  if (total > policy.maxTotalDay) out.push({ code: "OT_LIMIT_TOTAL_DAY", limit: policy.maxTotalDay, total });
  if (month > policy.maxMonth) out.push({ code: "OT_LIMIT_MONTH", limit: policy.maxMonth, total: month });
  if (year > policy.maxYear) out.push({ code: "OT_LIMIT_YEAR", limit: policy.maxYear, total: year });
  return out;
}

function limitError(v: LimitCheck[]): AppError {
  return new AppError(v[0]!.code, 422, "Vượt hạn mức làm thêm giờ", { violations: v });
}

export async function requestOt(
  tx: Queryable,
  actor: ActorContext,
  r: {
    employeeId?: string;
    businessDate: string;
    minutes: number;
    reason: string;
    consent?: boolean;
    exceptionBasis?: string | null;
  },
): Promise<string> {
  const employeeId = r.employeeId ?? actor.employeeId;
  if (!employeeId) throw new AppError("NO_EMPLOYEE", 403, "Tài khoản không gắn hồ sơ nhân viên");
  const self = employeeId === actor.employeeId;
  const res = await employeeResource(tx, actor.companyId, employeeId, r.businessDate);
  await requireOn(tx, actor, self ? "leave.request" : "attendance.approve", res, {
    type: "employee",
    id: employeeId,
  });
  if (r.reason.trim() === "") throw new AppError("VALIDATION", 422, "Cần lý do làm thêm");
  const policy = await otPolicyAt(tx, actor.companyId, r.businessDate);
  const v = await checkOtLimits(tx, employeeId, r.businessDate, r.minutes, policy);
  if (v.length > 0 && !r.exceptionBasis?.trim()) throw limitError(v);
  // Đồng ý chỉ do chính người lao động đưa ra; người khác tạo hộ thì chờ đồng ý.
  const consentAt = self && r.consent ? new Date() : null;
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO ot_request (company_id, employee_id, business_date, minutes, reason, employee_consent_at, exception_basis,
       policy_id, created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [
      actor.companyId,
      employeeId,
      r.businessDate,
      r.minutes,
      r.reason,
      consentAt,
      r.exceptionBasis ?? null,
      policy.id,
      actor.userId,
    ],
  );
  const id = rows[0]!.id;
  await auditDecision(tx, actor, "ot.request", "ot_request", id, {
    after: { ...r, employeeId, violations: v },
  });
  return id;
}

export async function giveOtConsent(tx: Queryable, actor: ActorContext, requestId: string): Promise<void> {
  const r = await tx.query(
    `UPDATE ot_request SET employee_consent_at = now()
     WHERE company_id = $1 AND id = $2 AND employee_id = $3 AND status = 'pending' AND employee_consent_at IS NULL`,
    [actor.companyId, requestId, actor.employeeId],
  );
  if (r.rowCount === 0) throw new AppError("NOT_FOUND", 404, "Không có đơn chờ đồng ý của bạn");
  await auditDecision(tx, actor, "ot.consent", "ot_request", requestId);
}

export async function decideOt(
  tx: Queryable,
  actor: ActorContext,
  requestId: string,
  decision: "approve" | "reject",
  note?: string | null,
): Promise<void> {
  const { rows } = await tx.query<{
    employee_id: string;
    business_date: string;
    minutes: number;
    status: string;
    created_by_user_id: string;
    employee_consent_at: Date | null;
    exception_basis: string | null;
  }>("SELECT * FROM ot_request WHERE company_id = $1 AND id = $2 FOR UPDATE", [actor.companyId, requestId]);
  const req = rows[0];
  if (!req) throw new AppError("NOT_FOUND", 404, "Không tìm thấy đơn");
  const res = await employeeResource(tx, actor.companyId, req.employee_id, req.business_date);
  await requireOn(tx, actor, "attendance.approve", res, { type: "ot_request", id: requestId });
  requireNotSelf(actor, req.created_by_user_id, req.employee_id);
  if (req.status !== "pending") throw new AppError("INVALID_STATE", 409, "Đơn đã được xử lý");
  if (decision === "approve") {
    if (!req.employee_consent_at)
      throw new AppError("OT_CONSENT_REQUIRED", 422, "Cần sự đồng ý của người lao động trước khi duyệt");
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('ot:' || $1, 0))", [req.employee_id]);
    const policy = await otPolicyAt(tx, actor.companyId, req.business_date);
    const v = await checkOtLimits(tx, req.employee_id, req.business_date, req.minutes, policy, requestId);
    if (v.length > 0) {
      if (!req.exception_basis?.trim()) throw limitError(v);
      if (!can(actor, "attendance.ot_exception", res))
        throw new AppError("FORBIDDEN", 403, "Vượt hạn mức cần quyền duyệt ngoại lệ", {
          action: "attendance.ot_exception",
          object: { type: "ot_request", id: requestId },
        });
    }
  } else if (!note?.trim()) throw new AppError("VALIDATION", 422, "Từ chối cần lý do");
  const guard =
    decision === "approve"
      ? await guardPeriodChange(tx, actor, req.employee_id, req.business_date, `OT ${requestId}`)
      : null;
  await tx.query(
    "UPDATE ot_request SET status = $2, decided_by_user_id = $3, decided_at = now(), decision_note = $4 WHERE id = $1",
    [requestId, decision === "approve" ? "approved" : "rejected", actor.userId, note ?? null],
  );
  await guard?.finish();
  await auditDecision(tx, actor, `ot.${decision}`, "ot_request", requestId, { reason: note ?? null });
}
