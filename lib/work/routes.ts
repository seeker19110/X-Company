// Route công việc: GET /api/app/tasks (việc của tôi), POST /api/app/tasks/:id/:action (chuyển trạng thái, kèm version).
import { z } from "zod";
import { getPool, withTx, type Queryable } from "../db/index.ts";
import { json, readJson, withActor } from "../http/index.ts";
import { AppError } from "../nen/app-error.ts";
import { fetchLimit, MAX_PAGE, parsePage, toPage, type Page, type PageRequest } from "../nen/pagination.ts";
import { transitionTask, type TaskAction } from "./tasks.ts";
import { t } from "../i18n/index.ts";

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
     ORDER BY t.priority, t.due_date NULLS LAST, t.created_at, t.id LIMIT $3 OFFSET $4`;

export interface MyTaskRow {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  priority: number;
  version: number;
  project_name: string;
  role: "responsible" | "reviewer";
}

/** Một trang việc của tôi (XC-PERF-006); mặc định trang lớn nhất cho màn hình server-render. */
export async function myTasksPage(
  db: Queryable,
  companyId: string,
  employeeId: string | null,
  page: PageRequest = MAX_PAGE,
): Promise<Page<MyTaskRow>> {
  if (!employeeId) return toPage([], page);
  const { rows } = await db.query<MyTaskRow>(MY_TASKS_SQL, [
    companyId,
    employeeId,
    fetchLimit(page),
    page.offset,
  ]);
  return toPage(rows, page);
}

export async function myTasks(db: Queryable, companyId: string, employeeId: string | null) {
  return (await myTasksPage(db, companyId, employeeId)).items;
}

export const getTasks = withActor(async (ctx) =>
  json(
    await myTasksPage(
      getPool(),
      ctx.actor.companyId,
      ctx.actor.employeeId,
      parsePage(new URL(ctx.req.url).searchParams),
    ),
  ),
);

/** Thân POST /api/app/tasks/:id/:action — xuất ra cho hợp đồng OpenAPI. */
export const Body = z.object({
  version: z.number().int().positive(),
  reason: z.string().max(1000).nullish(),
});

export const postTaskAction = withActor(
  async (ctx) => {
    const parts = new URL(ctx.req.url).pathname.split("/");
    const action = parts.pop() as TaskAction;
    const id = parts.pop() ?? "";
    if (!ACTIONS.includes(action) || !z.uuid().safeParse(id).success)
      throw new AppError("NOT_FOUND", 404, t("err.shared.khongTimThay"));
    const b = Body.parse(await readJson(ctx.req));
    const version = await withTx((tx) =>
      transitionTask(tx, ctx.actor, id, action, { expectedVersion: b.version, reason: b.reason }),
    );
    return json({ id, version });
  },
  { idempotent: true },
); // ARC-INT-001, BE-API-008
