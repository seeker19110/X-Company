import type { Metadata } from "next";
import { requireSession } from "@/app/server/session";
import { getPool } from "@/lib/db";
import { myTasks } from "@/lib/work/routes";
import { TASK_STATUS } from "@/app/components/labels";
import { TaskActions } from "@/app/components/task-actions";

export const metadata: Metadata = { title: "Công việc" };

export default async function TasksPage() {
  const { actor } = await requireSession();
  const tasks = await myTasks(getPool(), actor.companyId, actor.employeeId);
  return (
    <>
      <h1>Công việc</h1>
      {tasks.length === 0 ? (
        <p className="muted">Bạn không có việc đang mở.</p>
      ) : (
        <ul className="list">
          {tasks.map((t) => (
            <li key={t.id}>
              <strong>{t.title}</strong>
              <br />
              <span className="muted">
                {t.project_name} · {TASK_STATUS[t.status] ?? t.status}
                {t.due_date && <> · hạn {t.due_date}</>}
                {t.role === "reviewer" && <> · bạn nghiệm thu</>}
              </span>
              <TaskActions id={t.id} status={t.status} version={t.version} role={t.role} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
