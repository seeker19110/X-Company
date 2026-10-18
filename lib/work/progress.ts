// Tiến độ (SPEC-work, AT10): ba con số tách — kế hoạch, người thực hiện báo, đã nghiệm thu — tính trên hạng mục LÁ
// của baseline đã duyệt (cha không cộng trùng). Hàm `computeProgress` thuần; phần DB chỉ nạp dữ liệu.
import type { ActorContext } from "../authz/index.ts";
import { can } from "../authz/index.ts";
import { appendAudit } from "../audit/index.ts";
import type { Queryable } from "../db/index.ts";
import { AppError } from "../nen/app-error.ts";
import { projectAccess } from "./tasks.ts";

export interface LeafInput {
  workPackageId: string;
  weight: number;
  tasks: { status: string; reportedPct: number; dueDate: string | null }[];
}

export interface Progress {
  /** null khi không có baseline/trọng số (không đồng nhất với 0%). */
  acceptedPct: number | null;
  reportedPct: number | null;
  plannedPct: number | null;
  leaves: { workPackageId: string; weight: number; accepted: number; reported: number; planned: number }[];
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Mỗi lá: tỷ lệ = phần việc (không tính việc huỷ) — chia đều trong lá. accepted = việc `done` / tổng; reported =
 * trung bình % báo (done = 100); planned = việc có hạn ≤ hôm nay / tổng. Tiến độ = Σ(trọng số × tỷ lệ) / Σ trọng số.
 * Chia nhỏ việc trong một lá không vượt được trọng số của lá.
 */
export function computeProgress(leaves: LeafInput[], today: string): Progress {
  const valid = leaves.filter((l) => l.weight > 0);
  const total = valid.reduce((s, l) => s + l.weight, 0);
  const out: Progress["leaves"] = valid.map((l) => {
    const tasks = l.tasks.filter((t) => t.status !== "cancelled");
    const n = tasks.length;
    if (n === 0)
      return { workPackageId: l.workPackageId, weight: l.weight, accepted: 0, reported: 0, planned: 0 };
    return {
      workPackageId: l.workPackageId,
      weight: l.weight,
      accepted: tasks.filter((t) => t.status === "done").length / n,
      reported: tasks.reduce((s, t) => s + (t.status === "done" ? 100 : t.reportedPct), 0) / (100 * n),
      planned: tasks.filter((t) => t.dueDate !== null && t.dueDate <= today).length / n,
    };
  });
  if (total === 0) return { acceptedPct: null, reportedPct: null, plannedPct: null, leaves: out };
  const pct = (k: "accepted" | "reported" | "planned") =>
    round2((100 * out.reduce((s, l) => s + l.weight * l[k], 0)) / total);
  return {
    acceptedPct: pct("accepted"),
    reportedPct: pct("reported"),
    plannedPct: pct("planned"),
    leaves: out,
  };
}

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
    throw new AppError("FORBIDDEN", 403, "Bạn không có quyền đề xuất baseline", {
      action: "project.manage",
      object: { type: "project", id: projectId },
    });
  if (!reason.trim()) throw new AppError("VALIDATION", 422, "Cần lý do đề xuất baseline");
  const leaves = await tx.query<{ id: string }>(
    `SELECT w.id FROM work_package w WHERE w.project_id = $1
     AND NOT EXISTS (SELECT 1 FROM work_package c WHERE c.parent_id = w.id)`,
    [projectId],
  );
  const leafIds = new Set(leaves.rows.map((r) => r.id));
  for (const [id, w] of Object.entries(weights)) {
    if (!leafIds.has(id))
      throw new AppError("NOT_LEAF", 422, "Trọng số chỉ gán cho hạng mục lá của dự án", { id });
    if (!Number.isFinite(w) || w < 0) throw new AppError("VALIDATION", 422, "Trọng số phải ≥ 0");
  }
  if (Object.values(weights).reduce((s, w) => s + w, 0) <= 0)
    throw new AppError("VALIDATION", 422, "Tổng trọng số phải > 0");
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
  if (!b) throw new AppError("NOT_FOUND", 404, "Không tìm thấy baseline");
  if (!can(actor, "project.approve_baseline", { companyId: actor.companyId, projectId: b.project_id }))
    throw new AppError("FORBIDDEN", 403, "Bạn không có quyền duyệt baseline", {
      action: "project.approve_baseline",
      object: { type: "plan_baseline", id: baselineId },
    });
  if (b.proposed_by_user_id === actor.userId)
    throw new AppError("SELF_APPROVAL", 409, "Không tự duyệt baseline mình đề xuất");
  if (b.status !== "proposed") throw new AppError("INVALID_STATE", 409, "Baseline đã được xử lý");
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
     AND tstzrange(start_at, end_at, '[)') && tstzrange(($2::date)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh',
                                                       ($2::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh', '[)')`,
    [employeeId, dueDate],
  );
  return rows.length ? [{ code: "ASSIGNEE_ON_LEAVE", employeeId, date: dueDate }] : [];
}
