import type { Metadata } from "next";
import { requireSession } from "@/app/server/session";
import { LogoutButton } from "@/app/components/logout-button";
import { SyncStatus } from "@/app/components/sync-status";

export const metadata: Metadata = { title: "Cá nhân" };
const ROLE: Record<string, string> = {
  employee: "Nhân viên",
  team_lead: "Trưởng nhóm",
  project_manager: "Quản lý dự án",
  hr: "Nhân sự",
  accountant: "Kế toán",
  editor: "Biên tập",
  sales: "Kinh doanh",
  executive: "Lãnh đạo",
  sysadmin: "Quản trị",
  sensitive_exporter: "Xuất dữ liệu nhạy cảm",
};

export default async function MePage() {
  const s = await requireSession();
  return (
    <>
      <h1>Cá nhân</h1>
      <section className="card">
        <p>
          <strong>{s.displayName}</strong>
        </p>
        <p>Vai trò: {s.actor.grants.map((g) => ROLE[g.role] ?? g.role).join(", ") || "—"}</p>
      </section>
      <SyncStatus />
      <LogoutButton />
    </>
  );
}
