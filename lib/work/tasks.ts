// Công việc (SPEC-work W1–W5): quyền theo QUAN HỆ với dự án/việc (quản lý dự án, người chịu trách nhiệm, người
// nghiệm thu) cộng grant `project.*`; mọi thay đổi có lịch sử + thông báo người bị ảnh hưởng; khoá lạc quan `version`.
import { appendAudit } from "../audit/index.ts";
import { can, type ActorContext } from "../authz/index.ts";
import type { Queryable } from "../db/index.ts";
import { AppError } from "../nen/app-error.ts";
import { enqueue } from "../outbox/index.ts";

export type TaskStatus = "todo" | "in_progress" | "blocked" | "awaiting_acceptance" | "done" | "cancelled";
export type TaskAction = "start" | "submit" | "block" | "unblock" | "accept" | "return" | "reopen" | "cancel";

const forbidden = (action: string, type: string, id: string) =>
  new AppError("FORBIDDEN", 403, "Bạn không có quyền thực hiện thao tác này", {
    action,
    object: { type, id },
  });

export interface ProjectAccess {
  projectId: string;
  managerEmployeeId: string;
  isManager: boolean;
  isMember: boolean;
  canManage: boolean;
  canRead: boolean;
}

export async function projectAccess(
  db: Queryable,
  actor: ActorContext,
  projectId: string,
): Promise<ProjectAccess> {
  const { rows } = await db.query<{ manager_employee_id: string; member: boolean }>(
    `SELECT p.manager_employee_id,
            EXISTS (SELECT 1 FROM project_member m WHERE m.project_id = p.id AND m.employee_id = $3) AS member
     FROM project p WHERE p.company_id = $1 AND p.id = $2`,
    [actor.companyId, projectId, actor.employeeId],
  );
  const p = rows[0];
  if (!p) throw new AppError("NOT_FOUND", 404, "Không tìm thấy dự án");
  const res = { companyId: actor.companyId, projectId };
  const isManager = !!actor.employeeId && p.manager_employee_id === actor.employeeId;
  const canManage = isManager || can(actor, "project.manage", res);
  return {
    projectId,
    managerEmployeeId: p.manager_employee_id,
    isManager,
    isMember: p.member,
    canManage,
    // Thành viên thấy dự án của mình; grant đọc theo phạm vi (vd lãnh đạo) cũng thấy.
    canRead: canManage || p.member || can(actor, "project.read", res),
  };
}

export async function requireProjectRead(
  db: Queryable,
  actor: ActorContext,
  projectId: string,
): Promise<ProjectAccess> {
  const a = await projectAccess(db, actor, projectId);
  // Không lộ dự án tồn tại hay không với người ngoài (API-CONTRACT: 404 khi không có quyền đọc).
  if (!a.canRead) throw new AppError("NOT_FOUND", 404, "Không tìm thấy dự án");
  return a;
}

function audit(
  tx: Queryable,
  actor: ActorContext,
  action: string,
  type: string,
  id: string,
  extra: { after?: unknown; reason?: string | null } = {},
) {
  return appendAudit(tx, {
    actorUserId: actor.userId,
    companyId: actor.companyId,
    action,
    objectType: type,
    objectId: id,
    after: extra.after,
    reason: extra.reason ?? null,
  });
}

export async function createProject(
  tx: Queryable,
  actor: ActorContext,
  p: {
    code: string;
    name: string;
    managerEmployeeId: string;
    startDate?: string | null;
    dueDate?: string | null;
  },
): Promise<string> {
  if (!can(actor, "project.create", { companyId: actor.companyId }))
    throw forbidden("project.create", "project", p.code);
  let id: string;
  try {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO project (company_id, code, name, manager_employee_id, start_date, due_date)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [actor.companyId, p.code, p.name, p.managerEmployeeId, p.startDate ?? null, p.dueDate ?? null],
    );
    id = rows[0]!.id;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "23505") throw new AppError("DUPLICATE", 409, "Mã dự án đã tồn tại");
    if (code === "23503") throw new AppError("INVALID_REFERENCE", 422, "Quản lý dự án không hợp lệ");
    if (code === "23514") throw new AppError("VALIDATION", 422, "Ngày dự án không hợp lệ");
    throw err;
  }
  await tx.query("INSERT INTO project_member (company_id, project_id, employee_id) VALUES ($1, $2, $3)", [
    actor.companyId,
    id,
    p.managerEmployeeId,
  ]);
  await audit(tx, actor, "project.create", "project", id, { after: p });
  return id;
}

export async function addMember(
  tx: Queryable,
  actor: ActorContext,
  projectId: string,
  employeeId: string,
): Promise<void> {
  const a = await projectAccess(tx, actor, projectId);
  if (!a.canManage) throw forbidden("project.manage", "project", projectId);
  try {
    await tx.query(
      "INSERT INTO project_member (company_id, project_id, employee_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [actor.companyId, projectId, employeeId],
    );
  } catch (err) {
    if ((err as { code?: string }).code === "23503")
      throw new AppError("INVALID_REFERENCE", 422, "Nhân viên không hợp lệ");
    throw err;
  }
  await audit(tx, actor, "project.add_member", "project", projectId, { after: { employeeId } });
}

export async function createWorkPackage(
  tx: Queryable,
  actor: ActorContext,
  projectId: string,
  w: { code: string; name: string; parentId?: string | null },
): Promise<string> {
  const a = await projectAccess(tx, actor, projectId);
  if (!a.canManage) throw forbidden("project.manage", "project", projectId);
  if (w.parentId) {
    const p = await tx.query("SELECT 1 FROM work_package WHERE id = $1 AND project_id = $2", [
      w.parentId,
      projectId,
    ]);
    if (!p.rowCount) throw new AppError("INVALID_REFERENCE", 422, "Hạng mục cha không thuộc dự án");
  }
  const { rows } = await tx.query<{ id: string }>(
    "INSERT INTO work_package (company_id, project_id, parent_id, code, name) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [actor.companyId, projectId, w.parentId ?? null, w.code, w.name],
  );
  await audit(tx, actor, "work_package.create", "work_package", rows[0]!.id, { after: w });
  return rows[0]!.id;
}

async function requireMembers(tx: Queryable, projectId: string, ids: (string | null | undefined)[]) {
  for (const id of ids) {
    if (!id) continue;
    const m = await tx.query("SELECT 1 FROM project_member WHERE project_id = $1 AND employee_id = $2", [
      projectId,
      id,
    ]);
    if (!m.rowCount)
      throw new AppError("NOT_MEMBER", 422, "Người được giao phải là thành viên dự án", { employeeId: id });
  }
}

export interface TaskInput {
  projectId: string;
  workPackageId?: string | null;
  title: string;
  description?: string | null;
  responsibleEmployeeId: string;
  reviewerEmployeeId?: string | null;
  collaborators?: string[];
  dueDate?: string | null;
  priority?: number;
  estimateMinutes?: number | null;
  requiresAcceptance?: boolean;
  acceptanceCriteria?: string | null;
  evidenceRequired?: boolean;
}

export async function createTask(tx: Queryable, actor: ActorContext, t: TaskInput): Promise<string> {
  const a = await projectAccess(tx, actor, t.projectId);
  if (!a.canManage) throw forbidden("project.manage", "project", t.projectId);
  await requireMembers(tx, t.projectId, [
    t.responsibleEmployeeId,
    t.reviewerEmployeeId,
    ...(t.collaborators ?? []),
  ]);
  if (t.workPackageId) {
    const w = await tx.query("SELECT 1 FROM work_package WHERE id = $1 AND project_id = $2", [
      t.workPackageId,
      t.projectId,
    ]);
    if (!w.rowCount) throw new AppError("INVALID_REFERENCE", 422, "Hạng mục không thuộc dự án");
  }
  const requires = t.requiresAcceptance ?? true;
  if (requires && !t.reviewerEmployeeId)
    throw new AppError("VALIDATION", 422, "Việc cần nghiệm thu phải có người nghiệm thu");
  if (requires && !t.acceptanceCriteria?.trim())
    throw new AppError("VALIDATION", 422, "Cần tiêu chí hoàn thành");
  if (t.reviewerEmployeeId && t.reviewerEmployeeId === t.responsibleEmployeeId)
    throw new AppError("SELF_APPROVAL", 409, "Người nghiệm thu phải khác người thực hiện");
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO task (company_id, project_id, work_package_id, title, description, responsible_employee_id,
       reviewer_employee_id, due_date, priority, estimate_minutes, requires_acceptance, acceptance_criteria,
       evidence_required, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [
      actor.companyId,
      t.projectId,
      t.workPackageId ?? null,
      t.title.trim(),
      t.description ?? null,
      t.responsibleEmployeeId,
      t.reviewerEmployeeId ?? null,
      t.dueDate ?? null,
      t.priority ?? 2,
      t.estimateMinutes ?? null,
      requires,
      t.acceptanceCriteria ?? null,
      t.evidenceRequired ?? false,
      actor.userId,
    ],
  );
  const id = rows[0]!.id;
  for (const c of t.collaborators ?? []) {
    await tx.query(
      "INSERT INTO task_collaborator (task_id, employee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [id, c],
    );
  }
  await history(
    tx,
    actor,
    id,
    "create",
    null,
    "todo",
    { title: t.title, responsible: t.responsibleEmployeeId },
    null,
  );
  await notify(
    tx,
    actor,
    id,
    [t.responsibleEmployeeId, t.reviewerEmployeeId, ...(t.collaborators ?? [])],
    "task.assigned",
  );
  return id;
}

async function history(
  tx: Queryable,
  actor: ActorContext,
  taskId: string,
  action: string,
  from: string | null,
  to: string | null,
  changes: unknown,
  reason: string | null,
) {
  await tx.query(
    `INSERT INTO task_history (company_id, task_id, actor_user_id, action, from_status, to_status, changes, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      actor.companyId,
      taskId,
      actor.userId,
      action,
      from,
      to,
      changes === null ? null : JSON.stringify(changes),
      reason,
    ],
  );
  await audit(tx, actor, `task.${action}`, "task", taskId, { after: { from, to, changes }, reason });
}

async function notify(
  tx: Queryable,
  actor: ActorContext,
  taskId: string,
  employees: (string | null | undefined)[],
  topic: string,
) {
  const to = [...new Set(employees.filter((e): e is string => !!e && e !== actor.employeeId))];
  if (to.length)
    await enqueue(tx, actor.companyId, topic, { taskId, employeeIds: to, byUserId: actor.userId });
}

interface TaskRow {
  id: string;
  project_id: string;
  status: TaskStatus;
  version: number;
  responsible_employee_id: string;
  reviewer_employee_id: string | null;
  requires_acceptance: boolean;
  evidence_required: boolean;
  due_date: string | null;
  title: string;
  priority: number;
  acceptance_criteria: string | null;
}

async function loadTask(tx: Queryable, actor: ActorContext, taskId: string): Promise<TaskRow> {
  const { rows } = await tx.query<TaskRow>(
    "SELECT * FROM task WHERE company_id = $1 AND id = $2 FOR UPDATE",
    [actor.companyId, taskId],
  );
  if (!rows[0]) throw new AppError("NOT_FOUND", 404, "Không tìm thấy công việc");
  return rows[0];
}

const TRANSITIONS: Record<TaskAction, { from: TaskStatus[]; to: TaskStatus; needsReason: boolean }> = {
  start: { from: ["todo"], to: "in_progress", needsReason: false },
  submit: { from: ["in_progress"], to: "awaiting_acceptance", needsReason: false },
  block: { from: ["todo", "in_progress"], to: "blocked", needsReason: true },
  unblock: { from: ["blocked"], to: "in_progress", needsReason: false },
  accept: { from: ["awaiting_acceptance"], to: "done", needsReason: false },
  return: { from: ["awaiting_acceptance"], to: "in_progress", needsReason: true },
  reopen: { from: ["done"], to: "in_progress", needsReason: true },
  cancel: {
    from: ["todo", "in_progress", "blocked", "awaiting_acceptance"],
    to: "cancelled",
    needsReason: true,
  },
};

/** Chuyển trạng thái (W1–W5). `expectedVersion` cũ → 409 VERSION_CONFLICT. Trả version mới. */
export async function transitionTask(
  tx: Queryable,
  actor: ActorContext,
  taskId: string,
  action: TaskAction,
  opts: { expectedVersion: number; reason?: string | null },
): Promise<number> {
  const t = await loadTask(tx, actor, taskId);
  const a = await projectAccess(tx, actor, t.project_id);
  const me = actor.employeeId;
  const isResponsible = !!me && me === t.responsible_employee_id;
  const isReviewer = !!me && me === t.reviewer_employee_id;
  const allowed: Record<TaskAction, boolean> = {
    start: isResponsible || a.canManage,
    submit: isResponsible,
    block: isResponsible || a.canManage,
    unblock: isResponsible || a.canManage,
    accept: isReviewer,
    return: isReviewer,
    reopen: isReviewer || a.canManage,
    cancel: a.canManage,
  };
  if (!allowed[action]) {
    // Người thực hiện tự nghiệm thu → lỗi riêng (R5), không chỉ 403.
    if ((action === "accept" || action === "return") && isResponsible)
      throw new AppError("SELF_APPROVAL", 409, "Người thực hiện không tự nghiệm thu");
    throw forbidden(`task.${action}`, "task", taskId);
  }
  if (t.version !== opts.expectedVersion)
    throw new AppError("VERSION_CONFLICT", 409, "Công việc đã được người khác cập nhật, vui lòng tải lại", {
      currentVersion: t.version,
    });
  const rule = TRANSITIONS[action];
  if (!rule.from.includes(t.status))
    throw new AppError(
      "INVALID_STATE",
      409,
      `Không thể "${action}" khi công việc đang ở trạng thái ${t.status}`,
    );
  const reason = opts.reason?.trim() || null;
  if (rule.needsReason && !reason) throw new AppError("VALIDATION", 422, "Cần lý do");
  let to = rule.to;
  if (action === "submit") {
    if (t.evidence_required) {
      const ev = await tx.query("SELECT 1 FROM task_evidence WHERE task_id = $1 LIMIT 1", [taskId]);
      if (!ev.rowCount)
        throw new AppError("EVIDENCE_REQUIRED", 422, "Cần bằng chứng trước khi gửi nghiệm thu");
    }
    // Hoàn thành giản lược (W2): việc không cần nghiệm thu → hoàn tất ngay, vẫn ghi lịch sử.
    if (!t.requires_acceptance) to = "done";
  }
  const u = await tx.query<{ version: number }>(
    `UPDATE task SET status = $3, version = version + 1, updated_at = now(),
       blocked_reason = CASE WHEN $3 = 'blocked' THEN $4 ELSE NULL END,
       blocked_at = CASE WHEN $3 = 'blocked' THEN now() ELSE NULL END,
       reported_pct = CASE WHEN $3 = 'done' THEN 100 ELSE reported_pct END
     WHERE id = $1 AND version = $2 RETURNING version`,
    [taskId, opts.expectedVersion, to, reason],
  );
  if (!u.rows[0])
    throw new AppError("VERSION_CONFLICT", 409, "Công việc đã được người khác cập nhật, vui lòng tải lại");
  await history(tx, actor, taskId, action, t.status, to, null, reason);
  await notify(
    tx,
    actor,
    taskId,
    [t.responsible_employee_id, t.reviewer_employee_id, a.managerEmployeeId],
    `task.${action}`,
  );
  return u.rows[0].version;
}

export interface TaskChanges {
  title?: string;
  dueDate?: string | null;
  responsibleEmployeeId?: string;
  reviewerEmployeeId?: string | null;
  priority?: number;
  acceptanceCriteria?: string | null;
  reportedPct?: number;
}

/**
 * Đổi thông tin việc (W3): quản lý dự án đổi hạn/người/phạm vi — cần lý do, lịch sử trước/sau, báo người bị ảnh hưởng.
 * Người thực hiện chỉ được báo `reportedPct`.
 */
export async function updateTask(
  tx: Queryable,
  actor: ActorContext,
  taskId: string,
  expectedVersion: number,
  changes: TaskChanges,
  reason?: string | null,
): Promise<number> {
  const t = await loadTask(tx, actor, taskId);
  const a = await projectAccess(tx, actor, t.project_id);
  const isResponsible = !!actor.employeeId && actor.employeeId === t.responsible_employee_id;
  const keys = Object.keys(changes) as (keyof TaskChanges)[];
  const onlyProgress = keys.length > 0 && keys.every((k) => k === "reportedPct");
  if (!(a.canManage || (onlyProgress && isResponsible))) throw forbidden("task.update", "task", taskId);
  if (t.version !== expectedVersion)
    throw new AppError("VERSION_CONFLICT", 409, "Công việc đã được người khác cập nhật, vui lòng tải lại", {
      currentVersion: t.version,
    });
  if (["done", "cancelled"].includes(t.status) && !onlyProgress)
    throw new AppError("INVALID_STATE", 409, "Không sửa việc đã hoàn tất/huỷ — mở lại trước");
  const significant = keys.some((k) =>
    ["dueDate", "responsibleEmployeeId", "reviewerEmployeeId", "acceptanceCriteria", "title"].includes(k),
  );
  if (significant && !reason?.trim())
    throw new AppError("VALIDATION", 422, "Đổi hạn/người/phạm vi cần lý do");
  const next = {
    title: changes.title ?? t.title,
    due_date: changes.dueDate === undefined ? t.due_date : changes.dueDate,
    responsible: changes.responsibleEmployeeId ?? t.responsible_employee_id,
    reviewer: changes.reviewerEmployeeId === undefined ? t.reviewer_employee_id : changes.reviewerEmployeeId,
    priority: changes.priority ?? t.priority,
    criteria: changes.acceptanceCriteria === undefined ? t.acceptance_criteria : changes.acceptanceCriteria,
  };
  await requireMembers(tx, t.project_id, [next.responsible, next.reviewer]);
  if (next.reviewer && next.reviewer === next.responsible)
    throw new AppError("SELF_APPROVAL", 409, "Người nghiệm thu phải khác người thực hiện");
  if (changes.reportedPct !== undefined && (changes.reportedPct < 0 || changes.reportedPct > 100))
    throw new AppError("VALIDATION", 422, "Tiến độ báo cáo từ 0 đến 100");
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const map: [keyof TaskChanges, unknown, unknown][] = [
    ["title", t.title, next.title],
    ["dueDate", t.due_date, next.due_date],
    ["responsibleEmployeeId", t.responsible_employee_id, next.responsible],
    ["reviewerEmployeeId", t.reviewer_employee_id, next.reviewer],
    ["priority", t.priority, next.priority],
    ["acceptanceCriteria", t.acceptance_criteria, next.criteria],
  ];
  for (const [k, b, n] of map)
    if (keys.includes(k) && b !== n) {
      before[k] = b;
      after[k] = n;
    }
  if (changes.reportedPct !== undefined) after.reportedPct = changes.reportedPct;
  let u;
  try {
    u = await tx.query<{ version: number }>(
      `UPDATE task SET title = $3, due_date = $4, responsible_employee_id = $5, reviewer_employee_id = $6, priority = $7,
         acceptance_criteria = $8, reported_pct = COALESCE($9, reported_pct), version = version + 1, updated_at = now()
       WHERE id = $1 AND version = $2 RETURNING version`,
      [
        taskId,
        expectedVersion,
        next.title,
        next.due_date,
        next.responsible,
        next.reviewer,
        next.priority,
        next.criteria,
        changes.reportedPct ?? null,
      ],
    );
  } catch (err) {
    if ((err as { code?: string }).code === "23514")
      throw new AppError("VALIDATION", 422, "Thay đổi vi phạm ràng buộc công việc");
    throw err;
  }
  if (!u.rows[0])
    throw new AppError("VERSION_CONFLICT", 409, "Công việc đã được người khác cập nhật, vui lòng tải lại");
  await history(tx, actor, taskId, "update", t.status, t.status, { before, after }, reason ?? null);
  await notify(
    tx,
    actor,
    taskId,
    [t.responsible_employee_id, next.responsible, t.reviewer_employee_id, next.reviewer, a.managerEmployeeId],
    "task.updated",
  );
  return u.rows[0].version;
}

export async function addEvidence(
  tx: Queryable,
  actor: ActorContext,
  taskId: string,
  e: { kind: "file" | "link" | "note"; ref: string },
): Promise<string> {
  const t = await loadTask(tx, actor, taskId);
  const collab = await tx.query("SELECT 1 FROM task_collaborator WHERE task_id = $1 AND employee_id = $2", [
    taskId,
    actor.employeeId,
  ]);
  const ok = (!!actor.employeeId && actor.employeeId === t.responsible_employee_id) || !!collab.rowCount;
  if (!ok) throw forbidden("task.evidence", "task", taskId);
  if (e.kind === "link" && !/^https?:\/\//.test(e.ref))
    throw new AppError("VALIDATION", 422, "Liên kết phải là http(s)");
  if (e.kind === "file") {
    // Bằng chứng tệp phải là tài liệu đã tải lên CHÍNH công việc này (không trỏ tệp của đối tượng khác).
    const d = await tx.query(
      "SELECT 1 FROM document WHERE company_id = $1 AND id::text = $2 AND object_type = 'task' AND object_id = $3",
      [actor.companyId, e.ref, taskId],
    );
    if (!d.rowCount)
      throw new AppError("VALIDATION", 422, "Bằng chứng tệp phải là tài liệu của công việc này");
  }
  const { rows } = await tx.query<{ id: string }>(
    "INSERT INTO task_evidence (company_id, task_id, kind, ref, added_by_user_id) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [actor.companyId, taskId, e.kind, e.ref, actor.userId],
  );
  await history(tx, actor, taskId, "evidence", t.status, t.status, e, null);
  return rows[0]!.id;
}

/** Phụ thuộc FS trong cùng dự án; chặn chu trình. */
export async function addDependency(
  tx: Queryable,
  actor: ActorContext,
  predecessorId: string,
  successorId: string,
) {
  const p = await loadTask(tx, actor, predecessorId);
  const s = await loadTask(tx, actor, successorId);
  if (p.project_id !== s.project_id) throw new AppError("VALIDATION", 422, "Phụ thuộc phải trong cùng dự án");
  const a = await projectAccess(tx, actor, p.project_id);
  if (!a.canManage) throw forbidden("project.manage", "project", p.project_id);
  if (predecessorId === successorId) throw new AppError("DEPENDENCY_CYCLE", 422, "Phụ thuộc tạo vòng lặp");
  const cyc = await tx.query(
    `WITH RECURSIVE down(id) AS (
       SELECT successor_id FROM task_dependency WHERE predecessor_id = $1
       UNION SELECT d.successor_id FROM task_dependency d JOIN down ON d.predecessor_id = down.id
     ) SELECT 1 FROM down WHERE id = $2`,
    [successorId, predecessorId],
  );
  if (cyc.rowCount) throw new AppError("DEPENDENCY_CYCLE", 422, "Phụ thuộc tạo vòng lặp");
  await tx.query(
    "INSERT INTO task_dependency (company_id, predecessor_id, successor_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
    [actor.companyId, predecessorId, successorId],
  );
  await history(tx, actor, successorId, "dependency", s.status, s.status, { predecessorId }, null);
}

/** Cảnh báo hạn không phù hợp: việc kế tiếp có hạn trước việc đi trước (P0 cảnh báo, không chặn). */
export async function dependencyWarnings(db: Queryable, projectId: string) {
  const { rows } = await db.query<{ predecessor_id: string; successor_id: string }>(
    `SELECT d.predecessor_id, d.successor_id FROM task_dependency d
     JOIN task p ON p.id = d.predecessor_id JOIN task s ON s.id = d.successor_id
     WHERE p.project_id = $1 AND p.due_date IS NOT NULL AND s.due_date IS NOT NULL AND s.due_date < p.due_date
       AND s.status NOT IN ('done', 'cancelled')`,
    [projectId],
  );
  return rows.map((r) => ({ code: "SUCCESSOR_DUE_BEFORE_PREDECESSOR" as const, ...r }));
}
