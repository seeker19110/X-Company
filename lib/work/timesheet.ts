// Giờ dự án (F-009, AT08): khai theo việc mình tham gia, quản lý dự án duyệt (≠ người khai); đối chiếu với công:
// TÁCH giờ có mặt, OT đã duyệt và giờ dự án — không ép các tổng bằng nhau (§6), chênh lệch trọng yếu cần giải trình.
import { appendAudit } from "../audit/index.ts";
import type { ActorContext } from "../authz/index.ts";
import type { Queryable } from "../db/index.ts";
import { AppError } from "../nen/app-error.ts";
import { computeLines } from "../attendance/period.ts";
import { employeeResource, requireOn } from "../attendance/scope.ts";
import { projectAccess } from "./tasks.ts";

/** Ngưỡng chênh lệch cần giải trình (phút) ⚙ — SPEC-work. */
export const DIFF_THRESHOLD_MINUTES = 60;

export async function logTime(
  tx: Queryable,
  actor: ActorContext,
  e: { taskId: string; businessDate: string; minutes: number; note?: string | null },
): Promise<string> {
  if (!actor.employeeId) throw new AppError("NO_EMPLOYEE", 403, "Tài khoản không gắn hồ sơ nhân viên");
  if (!Number.isInteger(e.minutes) || e.minutes < 1 || e.minutes > 1440)
    throw new AppError("VALIDATION", 422, "Số phút từ 1 đến 1.440");
  const { rows } = await tx.query<{ project_id: string; involved: boolean; status: string }>(
    `SELECT t.project_id, t.status,
            (t.responsible_employee_id = $3 OR EXISTS (SELECT 1 FROM task_collaborator c WHERE c.task_id = t.id AND c.employee_id = $3)) AS involved
     FROM task t WHERE t.company_id = $1 AND t.id = $2`,
    [actor.companyId, e.taskId, actor.employeeId],
  );
  const t = rows[0];
  if (!t) throw new AppError("NOT_FOUND", 404, "Không tìm thấy công việc");
  if (!t.involved)
    throw new AppError("FORBIDDEN", 403, "Chỉ khai giờ cho việc mình thực hiện", {
      action: "timesheet.log",
      object: { type: "task", id: e.taskId },
    });
  if (t.status === "cancelled") throw new AppError("INVALID_STATE", 409, "Không khai giờ cho việc đã huỷ");
  // Khoá theo nhân viên + ngày: tổng giờ dự án trong ngày không vượt 24 giờ (không cộng trùng khoảng giữa hai dự án).
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('ts:' || $1 || $2, 0))", [
    actor.employeeId,
    e.businessDate,
  ]);
  const sum = await tx.query<{ m: string | null }>(
    "SELECT sum(minutes) AS m FROM timesheet_entry WHERE employee_id = $1 AND business_date = $2 AND status <> 'rejected'",
    [actor.employeeId, e.businessDate],
  );
  if (Number(sum.rows[0]?.m ?? 0) + e.minutes > 1440)
    throw new AppError("TIMESHEET_DAY_OVERFLOW", 422, "Tổng giờ dự án trong ngày vượt 24 giờ");
  const ins = await tx.query<{ id: string }>(
    `INSERT INTO timesheet_entry (company_id, employee_id, project_id, task_id, business_date, minutes, note, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      actor.companyId,
      actor.employeeId,
      t.project_id,
      e.taskId,
      e.businessDate,
      e.minutes,
      e.note ?? null,
      actor.userId,
    ],
  );
  await appendAudit(tx, {
    actorUserId: actor.userId,
    companyId: actor.companyId,
    action: "timesheet.log",
    objectType: "timesheet_entry",
    objectId: ins.rows[0]!.id,
    after: e,
  });
  return ins.rows[0]!.id;
}

export async function decideTimesheet(
  tx: Queryable,
  actor: ActorContext,
  id: string,
  decision: "approve" | "reject",
  note?: string | null,
): Promise<void> {
  const { rows } = await tx.query<{
    project_id: string;
    employee_id: string;
    created_by_user_id: string;
    status: string;
  }>(
    "SELECT project_id, employee_id, created_by_user_id, status FROM timesheet_entry WHERE company_id = $1 AND id = $2 FOR UPDATE",
    [actor.companyId, id],
  );
  const e = rows[0];
  if (!e) throw new AppError("NOT_FOUND", 404, "Không tìm thấy dòng giờ");
  const a = await projectAccess(tx, actor, e.project_id);
  if (!a.canManage)
    throw new AppError("FORBIDDEN", 403, "Chỉ quản lý dự án duyệt giờ", {
      action: "timesheet.approve",
      object: { type: "timesheet_entry", id },
    });
  if (e.created_by_user_id === actor.userId || e.employee_id === actor.employeeId)
    throw new AppError("SELF_APPROVAL", 409, "Không tự duyệt giờ của mình");
  if (e.status !== "submitted") throw new AppError("INVALID_STATE", 409, "Dòng giờ đã được xử lý");
  if (decision === "reject" && !note?.trim()) throw new AppError("VALIDATION", 422, "Từ chối cần lý do");
  await tx.query(
    "UPDATE timesheet_entry SET status = $2, decided_by_user_id = $3, decided_at = now(), decision_note = $4 WHERE id = $1",
    [id, decision === "approve" ? "approved" : "rejected", actor.userId, note ?? null],
  );
  await appendAudit(tx, {
    actorUserId: actor.userId,
    companyId: actor.companyId,
    action: `timesheet.${decision}`,
    objectType: "timesheet_entry",
    objectId: id,
    reason: note ?? null,
  });
}

export type ReconWarning = "PROJECT_GT_PRESENT" | "DIFF_NEEDS_REASON";

export interface DayReconciliation {
  businessDate: string;
  presentMinutes: number | null;
  otApprovedMinutes: number;
  projectApprovedMinutes: number;
  projectPendingMinutes: number;
  diffMinutes: number | null;
  note: string | null;
  warnings: ReconWarning[];
}

/**
 * Đối chiếu từng ngày trong khoảng (AT08). Quyền: chính chủ hoặc người có attendance.read trên nhân viên.
 * Giờ dự án đã duyệt > có mặt + OT đã duyệt → PROJECT_GT_PRESENT (luôn cảnh báo); |có mặt − dự án| > ngưỡng mà chưa
 * giải trình → DIFF_NEEDS_REASON.
 */
export async function reconcile(
  db: Queryable,
  actor: ActorContext,
  employeeId: string,
  from: string,
  to: string,
): Promise<DayReconciliation[]> {
  const res = await employeeResource(db, actor.companyId, employeeId);
  await requireOn(db, actor, "attendance.read", res, { type: "employee", id: employeeId });
  const lines = await computeLines(db, actor.companyId, from, to, employeeId);
  const ts = await db.query<{ d: string; approved: string; pending: string }>(
    `SELECT business_date AS d,
            COALESCE(sum(minutes) FILTER (WHERE status = 'approved'), 0) AS approved,
            COALESCE(sum(minutes) FILTER (WHERE status = 'submitted'), 0) AS pending
     FROM timesheet_entry WHERE employee_id = $1 AND business_date BETWEEN $2::date AND $3::date GROUP BY 1`,
    [employeeId, from, to],
  );
  const notes = await db.query<{ business_date: string; note: string }>(
    "SELECT business_date, note FROM reconciliation_note WHERE employee_id = $1 AND business_date BETWEEN $2::date AND $3::date",
    [employeeId, from, to],
  );
  const days = new Map<string, DayReconciliation>();
  const day = (d: string) => {
    let x = days.get(d);
    if (!x) {
      x = {
        businessDate: d,
        presentMinutes: null,
        otApprovedMinutes: 0,
        projectApprovedMinutes: 0,
        projectPendingMinutes: 0,
        diffMinutes: null,
        note: null,
        warnings: [],
      };
      days.set(d, x);
    }
    return x;
  };
  for (const l of lines) {
    const x = day(l.businessDate);
    if (l.presentMinutes !== null) x.presentMinutes = (x.presentMinutes ?? 0) + l.presentMinutes;
    x.otApprovedMinutes += l.otApprovedMinutes;
  }
  for (const r of ts.rows) {
    const x = day(r.d);
    x.projectApprovedMinutes = Number(r.approved);
    x.projectPendingMinutes = Number(r.pending);
  }
  for (const n of notes.rows) day(n.business_date).note = n.note;
  for (const x of days.values()) {
    const present = x.presentMinutes ?? 0;
    x.diffMinutes =
      x.presentMinutes === null && x.projectApprovedMinutes === 0 ? null : present - x.projectApprovedMinutes;
    if (x.projectApprovedMinutes > present + x.otApprovedMinutes) x.warnings.push("PROJECT_GT_PRESENT");
    if (x.diffMinutes !== null && Math.abs(x.diffMinutes) > DIFF_THRESHOLD_MINUTES && !x.note)
      x.warnings.push("DIFF_NEEDS_REASON");
  }
  return [...days.values()].sort((a, b) => (a.businessDate < b.businessDate ? -1 : 1));
}

export async function explainDay(
  tx: Queryable,
  actor: ActorContext,
  employeeId: string,
  date: string,
  note: string,
): Promise<void> {
  const res = await employeeResource(tx, actor.companyId, employeeId);
  // Chính chủ hoặc người quản lý công (attendance.read đi kèm vai trò quản lý) giải trình.
  await requireOn(tx, actor, "attendance.read", res, { type: "employee", id: employeeId });
  if (!note.trim()) throw new AppError("VALIDATION", 422, "Cần nội dung giải trình");
  await tx.query(
    `INSERT INTO reconciliation_note (company_id, employee_id, business_date, note, created_by_user_id) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (employee_id, business_date) DO UPDATE SET note = EXCLUDED.note, created_by_user_id = EXCLUDED.created_by_user_id`,
    [actor.companyId, employeeId, date, note, actor.userId],
  );
  await appendAudit(tx, {
    actorUserId: actor.userId,
    companyId: actor.companyId,
    action: "timesheet.explain",
    objectType: "employee",
    objectId: employeeId,
    reason: note,
  });
}
