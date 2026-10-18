import type { Metadata } from "next";
import { requireSession } from "@/app/server/session";
import { getPool } from "@/lib/db";
import { myTasks } from "@/lib/work/routes";
import { TASK_STATUS } from "@/app/components/labels";
import { TaskActions } from "@/app/components/task-actions";
import { formatDate } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("tasks.title") };

export default async function TasksPage() {
  const { actor } = await requireSession();
  const tasks = await myTasks(getPool(), actor.companyId, actor.employeeId);
  return (
    <>
      <h1>{t("tasks.title")}</h1>
      {tasks.length === 0 ? (
        <p className="muted">{t("tasks.empty")}</p>
      ) : (
        <ul className="list">
          {tasks.map((task) => (
            <li key={task.id}>
              <strong>{task.title}</strong>
              <br />
              <span className="muted">
                {task.project_name} · {TASK_STATUS[task.status] ?? task.status}
                {task.due_date && <> · {t("tasks.due", { date: formatDate(task.due_date) })}</>}
                {task.role === "reviewer" && <> · {t("tasks.youReview")}</>}
              </span>
              <TaskActions
                id={task.id}
                title={task.title}
                status={task.status}
                version={task.version}
                role={task.role}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
