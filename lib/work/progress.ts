// Tiến độ (SPEC-work, AT10): ba con số tách — kế hoạch, người thực hiện báo, đã nghiệm thu — tính trên hạng mục LÁ
// của baseline đã duyệt (cha không cộng trùng). Hàm `computeProgress` thuần; phần DB chỉ nạp dữ liệu.
import type { ActorContext } from "../authz/index.ts";
import { can } from "../authz/index.ts";
import { appendAudit } from "../audit/index.ts";
import type { Queryable } from "../db/index.ts";
import { AppError } from "../nen/app-error.ts";
import { projectAccess } from "./tasks.ts";

import { computeProgress, type LeafInput, type Progress } from "./progress-compute.ts";
import { BUSINESS_TZ } from "../nen/time.ts";
import { t as tr } from "../i18n/index.ts";
export { computeProgress } from "./progress-compute.ts";
export type { LeafInput, Progress } from "./progress-compute.ts";

/** Đề xuất baseline: trọng số chỉ cho hạng mục LÁ của dự án. */
export async function proposeBaseline(
  tx: Queryable,
  actor: ActorContext,
  projectId: string,
  weights: Record<string, number>,
  reason: string,
): Promise<string> {
  const a = await projectAccess(tx, actor, projectId);
  if (!a.canManage)
    throw new AppError("FORBIDDEN", 403, tr("err.work.banKhongCoQuyenDeXuat"), {
      action: "project.manage",
      object: { type: "project", id: projectId },
    });
  if (reason.trim() === "") throw new AppError("VALIDATION", 422, tr("err.work.canLyDoDeXuatBaseline"));
  const leaves = await tx.query<{ id: string }>(
    `SELECT w.id FROM work_package w WHERE w.project_id = $1
     AND NOT EXISTS (SELECT 1 FROM work_package c WHERE c.parent_id = w.id)`,
    [projectId],
  );
  const leafIds = new Set(leaves.rows.map((r) => r.id));
  for (const [id, w] of Object.entries(weights)) {
    if (!leafIds.has(id)) throw new AppError("NOT_LEAF", 422, tr("err.work.trongSoChiGanChoHang"), { id });
    if (!Number.isFinite(w) || w < 0) throw new AppError("VALIDATION", 422, tr("err.work.trongSoPhai0"));
  }
  if (Object.values(weights).reduce((s, w) => s + w, 0) <= 0)
    throw new AppError("VALIDATION", 422, tr("err.work.tongTrongSoPhai0"));
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO plan_baseline (company_id, project_id, version, weights, reason, proposed_by_user_id)
     VALUES ($1, $2, (SELECT COALESCE(max(version), 0) + 1 FROM plan_baseline WHERE project_id = $2), $3, $4, $5) RETURNING id`,
    [actor.companyId, projectId, JSON.stringify(weights), reason, actor.userId],
  );
  await appendAudit(tx, {
    actorUserId: actor.userId,
    companyId: actor.companyId,
    action: "baseline.propose",
    objectType: "plan_baseline",
    objectId: rows[0]!.id,
    after: weights,
    reason,
  });
  return rows[0]!.id;
}

export async function approveBaseline(tx: Queryable, actor: ActorContext, baselineId: string): Promise<void> {
  const { rows } = await tx.query<{ project_id: string; status: string; proposed_by_user_id: string }>(
    "SELECT project_id, status, proposed_by_user_id FROM plan_baseline WHERE company_id = $1 AND id = $2 FOR UPDATE",
    [actor.companyId, baselineId],
  );
  const b = rows[0];
  if (!b) throw new AppError("NOT_FOUND", 404, tr("err.work.khongTimThayBaseline"));
  if (!can(actor, "project.approve_baseline", { companyId: actor.companyId, projectId: b.project_id }))
    throw new AppError("FORBIDDEN", 403, tr("err.work.banKhongCoQuyenDuyetBaseline"), {
      action: "project.approve_baseline",
      object: { type: "plan_baseline", id: baselineId },
    });
  if (b.proposed_by_user_id === actor.userId)
    throw new AppError("SELF_APPROVAL", 409, tr("err.work.khongTuDuyetBaselineMinhDe"));
  if (b.status !== "proposed") throw new AppError("INVALID_STATE", 409, tr("err.work.baselineDaDuocXuLy"));
  await tx.query(
    "UPDATE plan_baseline SET status = 'approved', approved_by_user_id = $2, approved_at = now() WHERE id = $1",
    [baselineId, actor.userId],
  );
  await appendAudit(tx, {
    actorUserId: actor.userId,
    companyId: actor.companyId,
    action: "baseline.approve",
    objectType: "plan_baseline",
    objectId: baselineId,
  });
}

/** Tiến độ dự án theo baseline đã duyệt MỚI NHẤT. Không có baseline → các con số null. */
export async function projectProgress(
  db: Queryable,
  projectId: string,
  today: string,
): Promise<Progress & { baselineVersion: number | null }> {
  const b = await db.query<{ version: number; weights: Record<string, number> }>(
    "SELECT version, weights FROM plan_baseline WHERE project_id = $1 AND status = 'approved' ORDER BY version DESC LIMIT 1",
    [projectId],
  );
  const base = b.rows[0];
  if (!base) return { ...computeProgress([], today), baselineVersion: null };
  const t = await db.query<{
    work_package_id: string;
    status: string;
    reported_pct: number;
    due_date: string | null;
  }>(
    "SELECT work_package_id, status, reported_pct, due_date FROM task WHERE project_id = $1 AND work_package_id = ANY($2::uuid[])",
    [projectId, Object.keys(base.weights)],
  );
  const leaves: LeafInput[] = Object.entries(base.weights).map(([wp, weight]) => ({
    workPackageId: wp,
    weight,
    tasks: t.rows
      .filter((r) => r.work_package_id === wp)
      .map((r) => ({ status: r.status, reportedPct: r.reported_pct, dueDate: r.due_date })),
  }));
  return { ...computeProgress(leaves, today), baselineVersion: base.version };
}

export interface AssignWarning {
  code: "ASSIGNEE_ON_LEAVE";
  employeeId: string;
  date: string;
}

/** S-WK-04: người được giao có đơn nghỉ đã duyệt trùng ngày hạn (giờ VN) → cảnh báo, không chặn. */
export async function assignmentWarnings(
  db: Queryable,
  employeeId: string,
  dueDate: string | null,
): Promise<AssignWarning[]> {
  if (!dueDate) return [];
  const { rows } = await db.query(
    `SELECT 1 FROM leave_request WHERE employee_id = $1 AND status = 'approved'
     AND tstzrange(start_at, end_at, '[)') && tstzrange(($2::date)::timestamp AT TIME ZONE $3,
                                                       ($2::date + 1)::timestamp AT TIME ZONE $3, '[)')`,
    [employeeId, dueDate, BUSINESS_TZ],
  );
  return rows.length > 0 ? [{ code: "ASSIGNEE_ON_LEAVE", employeeId, date: dueDate }] : [];
}
