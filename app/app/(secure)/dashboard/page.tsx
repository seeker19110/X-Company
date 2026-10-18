import type { Metadata } from "next";
import { requireSession } from "@/app/server/session";
import { getPool } from "@/lib/db";
import { dashboard } from "@/lib/dashboard";
import { localDate } from "@/lib/nen/time";

export const metadata: Metadata = { title: "Bảng điều hành" };
const CODE: Record<string, string> = {
  TASK_OVERDUE: "Quá hạn",
  TASK_BLOCKED_LONG: "Bị chặn lâu",
  MILESTONE_AT_RISK: "Mốc nguy cơ trễ",
  ATTENDANCE_NEEDS_REVIEW: "Công cần xác minh",
  MISSING_CHECKOUT: "Thiếu giờ ra",
};

export default async function DashboardPage() {
  const { actor } = await requireSession();
  const d = await dashboard(getPool(), actor, localDate(new Date()));
  return (
    <>
      <h1>Bảng điều hành</h1>
      <section className="card" aria-labelledby="mocs">
        <h2 id="mocs">Mốc bàn giao</h2>
        {d.milestones.length === 0 ? (
          <p className="muted">Không có mốc trong các dự án bạn xem được.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Dự án</th>
                <th scope="col">Mốc</th>
                <th scope="col">Hạn</th>
                <th scope="col">Trượt so với baseline</th>
                <th scope="col">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {d.milestones.map((m) => (
                <tr key={m.id}>
                  <td>{m.projectName}</td>
                  <td>{m.name}</td>
                  <td>{m.dueDate}</td>
                  <td>{m.slipDays === null ? "—" : `${m.slipDays} ngày`}</td>
                  <td>{m.achieved ? "Đã đạt" : "Chưa đạt"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="card" aria-labelledby="cb">
        <h2 id="cb">Cần xử lý ({d.alerts.length})</h2>
        {d.alerts.length === 0 ? (
          <p className="muted">Không có ngoại lệ.</p>
        ) : (
          <ul className="list">
            {d.alerts.map((a) => (
              <li key={`${a.code}:${a.objectId}`}>
                <span className="badge warn">{CODE[a.code] ?? a.code}</span> {a.title}
                <br />
                <span className="muted">Việc tiếp theo: {a.nextAction}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
