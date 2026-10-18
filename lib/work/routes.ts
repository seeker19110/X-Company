// Route công việc: GET /api/app/tasks (việc của tôi), POST /api/app/tasks/:id/:action (chuyển trạng thái, kèm version).
import { z } from "zod";
import { getPool, withTx, type Queryable } from "../db/index.ts";
import { json, readJson, withActor } from "../http/index.ts";
import { AppError } from "../nen/app-error.ts";
import { transitionTask, type TaskAction } from "./tasks.ts";

export const ACTIONS: readonly TaskAction[] = [
  "start",
  "submit",
  "block",
  "unblock",
  "accept",
  "return",
  "reopen",
  "cancel",
];

/** Truy vấn lõi "việc của tôi" — xuất ra để test EXPLAIN (DB-PERF-001, docs/db/explain). */
export const MY_TASKS_SQL = `SELECT t.id, t.title, t.status, t.due_date, t.priority, t.version, p.name AS project_name,
            CASE WHEN t.responsible_employee_id = $2 THEN 'responsible' ELSE 'reviewer' END AS role
     FROM task t JOIN project p ON p.id = t.project_id
     WHERE t.company_id = $1 AND t.status NOT IN ('done', 'cancelled')
       AND (t.responsible_employee_id = $2 OR (t.reviewer_employee_id = $2 AND t.status = 'awaiting_acceptance'))
     ORDER BY t.priority, t.due_date NULLS LAST, t.created_at LIMIT 200`;

export async function myTasks(db: Queryable, companyId: string, employeeId: string | null) {
  if (!employeeId) return [];
  const { rows } = await db.query<{
    id: string;
    title: string;
    status: string;
    due_date: string | null;
    priority: number;
    version: number;
    project_name: string;
    role: "responsible" | "reviewer";
  }>(MY_TASKS_SQL, [companyId, employeeId]);
  return rows;
}

export const getTasks = withActor(async (ctx) =>
  json({ items: await myTasks(getPool(), ctx.actor.companyId, ctx.actor.employeeId) }),
);

const Body = z.object({ version: z.number().int().positive(), reason: z.string().max(1000).nullish() });

export const postTaskAction = withActor(
  async (ctx) => {
    const parts = new URL(ctx.req.url).pathname.split("/");
    const action = parts.pop() as TaskAction;
    const id = parts.pop() ?? "";
    if (!ACTIONS.includes(action) || !z.uuid().safeParse(id).success)
      throw new AppError("NOT_FOUND", 404, "Không tìm thấy");
    const b = Body.parse(await readJson(ctx.req));
    const version = await withTx((tx) =>
      transitionTask(tx, ctx.actor, id, action, { expectedVersion: b.version, reason: b.reason }),
    );
    return json({ id, version });
  },
  { idempotent: true },
); // ARC-INT-001, BE-API-008
