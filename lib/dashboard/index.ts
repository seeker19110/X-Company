// Dashboard ngoại lệ (SPEC-work F-012, §7 "Cảnh báo và báo cáo quản lý"): mỗi cảnh báo có NGƯỜI XỬ LÝ và HÀNH ĐỘNG
// TIẾP THEO; chỉ trong phạm vi người xem được. Bảng mốc bàn giao luôn tách riêng (tiến độ tổng không che mốc trễ).
import type { ActorContext } from "../authz/index.ts";
import { can } from "../authz/index.ts";
import type { Queryable } from "../db/index.ts";
import { computeLines } from "../attendance/period.ts";
import { employeeResource } from "../attendance/scope.ts";
import { addDays } from "../attendance/compute.ts";
import { BUSINESS_TZ } from "../nen/time.ts";
import { projectProgress } from "../work/progress.ts";
import { projectAccess } from "../work/tasks.ts";
import { MS_PER_DAY } from "../nen/units.ts";
import { t as tr } from "../i18n/index.ts";

export const MILESTONE_RISK_POINTS = 10; // ⚙ chênh kế hoạch − nghiệm thu (điểm %)
export const MILESTONE_HORIZON_DAYS = 7; // ⚙
export const BLOCKED_DAYS = 3; // ⚙

export type AlertCode =
  "TASK_OVERDUE" | "TASK_BLOCKED_LONG" | "MILESTONE_AT_RISK" | "ATTENDANCE_NEEDS_REVIEW" | "MISSING_CHECKOUT";

export interface Alert {
  code: AlertCode;
  objectType: "task" | "milestone" | "attendance_event" | "employee";
  objectId: string;
  title: string;
  ownerEmployeeId: string | null;
  nextAction: string;
  since: string | null;
}

export interface MilestoneRow {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  dueDate: string;
  baselineDueDate: string | null;
  achieved: boolean;
  slipDays: number | null;
}

/** Dự án người xem đọc được (thành viên, quản lý hoặc grant project.read). */
async function readableProjects(
  db: Queryable,
  actor: ActorContext,
): Promise<{ id: string; name: string; manager: string }[]> {
  const { rows } = await db.query<{ id: string; name: string; manager_employee_id: string }>(
    "SELECT id, name, manager_employee_id FROM project WHERE company_id = $1 AND status = 'active' ORDER BY code",
    [actor.companyId],
  );
  const out = [];
  for (const p of rows)
    if ((await projectAccess(db, actor, p.id)).canRead)
      out.push({ id: p.id, name: p.name, manager: p.manager_employee_id });
  return out;
}

export async function dashboard(
  db: Queryable,
  actor: ActorContext,
  today: string,
): Promise<{ alerts: Alert[]; milestones: MilestoneRow[] }> {
  const alerts: Alert[] = [];
  const projects = await readableProjects(db, actor);
  const ids = projects.map((p) => p.id);
  const managerOf = new Map(projects.map((p) => [p.id, p.manager]));

  if (ids.length > 0) {
    const overdue = await db.query<{
      id: string;
      title: string;
      due_date: string;
      responsible_employee_id: string;
    }>(
      `SELECT id, title, due_date, responsible_employee_id FROM task
       WHERE project_id = ANY($1::uuid[]) AND due_date < $2::date AND status NOT IN ('done', 'cancelled') ORDER BY due_date`,
      [ids, today],
    );
    for (const t of overdue.rows)
      alerts.push({
        code: "TASK_OVERDUE",
        objectType: "task",
        objectId: t.id,
        title: tr("msg.dashboard.overdue", { title: t.title }),
        ownerEmployeeId: t.responsible_employee_id,
        nextAction: tr("msg.dashboard.overdueNext"),
        since: t.due_date,
      });
    const blocked = await db.query<{
      id: string;
      title: string;
      project_id: string;
      blocked_at: Date;
      blocked_reason: string;
    }>(
      `SELECT id, title, project_id, blocked_at, blocked_reason FROM task
       WHERE project_id = ANY($1::uuid[]) AND status = 'blocked'
         AND blocked_at < ($2::date - make_interval(days => $3))::timestamp AT TIME ZONE $4`,
      [ids, today, BLOCKED_DAYS, BUSINESS_TZ],
    );
    for (const t of blocked.rows)
      alerts.push({
        code: "TASK_BLOCKED_LONG",
        objectType: "task",
        objectId: t.id,
        title: tr("msg.dashboard.blocked", { days: BLOCKED_DAYS, title: t.title, reason: t.blocked_reason }),
        ownerEmployeeId: managerOf.get(t.project_id) ?? null,
        nextAction: tr("msg.dashboard.blockedNext"),
        since: t.blocked_at.toISOString(),
      });
  }

  const milestones: MilestoneRow[] = [];
  if (ids.length > 0) {
    const ms = await db.query<{
      id: string;
      project_id: string;
      name: string;
      due_date: string;
      baseline_due_date: string | null;
      achieved_at: Date | null;
    }>("SELECT * FROM milestone WHERE project_id = ANY($1::uuid[]) ORDER BY due_date", [ids]);
    const progress = new Map<string, Awaited<ReturnType<typeof projectProgress>>>();
    for (const m of ms.rows) {
      const p = projects.find((x) => x.id === m.project_id)!;
      const slip = m.baseline_due_date
        ? Math.round((Date.parse(m.due_date) - Date.parse(m.baseline_due_date)) / MS_PER_DAY)
        : null;
      milestones.push({
        id: m.id,
        projectId: m.project_id,
        projectName: p.name,
        name: m.name,
        dueDate: m.due_date,
        baselineDueDate: m.baseline_due_date,
        achieved: !!m.achieved_at,
        slipDays: slip,
      });
      if (m.achieved_at || m.due_date > addDays(today, MILESTONE_HORIZON_DAYS)) continue;
      if (!progress.has(m.project_id))
        progress.set(m.project_id, await projectProgress(db, m.project_id, today));
      const pr = progress.get(m.project_id)!;
      const gap = pr.plannedPct !== null && pr.acceptedPct !== null ? pr.plannedPct - pr.acceptedPct : null;
      if (m.due_date < today || (gap !== null && gap > MILESTONE_RISK_POINTS))
        alerts.push({
          code: "MILESTONE_AT_RISK",
          objectType: "milestone",
          objectId: m.id,
          title:
            m.due_date < today
              ? tr("msg.dashboard.milestoneLate", { name: m.name, project: p.name })
              : tr("msg.dashboard.milestoneAtRisk", {
                  name: m.name,
                  project: p.name,
                  planned: pr.plannedPct ?? 0, // nhánh này chỉ chạy khi gap != null (cả hai khác null)
                  accepted: pr.acceptedPct ?? 0,
                }),
          ownerEmployeeId: p.manager,
          nextAction: tr("msg.dashboard.milestoneNext"),
          since: m.due_date,
        });
    }
  }

  // Ngoại lệ chấm công trong phạm vi người xem có quyền duyệt (trưởng nhóm, HR).
  const reviews = await db.query<{
    id: string;
    employee_id: string;
    full_name: string;
    review_reason: string;
    device_time: Date;
  }>(
    `SELECT a.id, a.employee_id, e.full_name, a.review_reason, a.device_time FROM attendance_event a JOIN employee e ON e.id = a.employee_id
     WHERE a.company_id = $1 AND a.status = 'needs_review' AND a.voided_by_adjustment_id IS NULL
       AND a.device_time > ($2::date - 30)::timestamp AT TIME ZONE $3 ORDER BY a.device_time`,
    [actor.companyId, today, BUSINESS_TZ],
  );
  const scopeCache = new Map<string, boolean>();
  const inScope = async (employeeId: string) => {
    if (!scopeCache.has(employeeId))
      scopeCache.set(
        employeeId,
        employeeId !== actor.employeeId &&
          can(actor, "attendance.approve", await employeeResource(db, actor.companyId, employeeId)),
      );
    return scopeCache.get(employeeId)!;
  };
  for (const r of reviews.rows)
    if (await inScope(r.employee_id))
      alerts.push({
        code: "ATTENDANCE_NEEDS_REVIEW",
        objectType: "attendance_event",
        objectId: r.id,
        title: tr("msg.dashboard.attendanceReview", { name: r.full_name, reason: r.review_reason }),
        ownerEmployeeId: actor.employeeId,
        nextAction: tr("msg.dashboard.attendanceNext"),
        since: r.device_time.toISOString(),
      });
  const lines = await computeLines(db, actor.companyId, addDays(today, -7), addDays(today, -1));
  for (const l of lines)
    if (l.status === "incomplete" && (await inScope(l.employeeId)))
      alerts.push({
        code: "MISSING_CHECKOUT",
        objectType: "employee",
        objectId: l.employeeId,
        title: tr("msg.dashboard.missingCheckout", { date: l.businessDate }),
        ownerEmployeeId: l.employeeId,
        nextAction: tr("msg.dashboard.missingCheckoutNext"),
        since: l.businessDate,
      });

  return { alerts, milestones };
}
