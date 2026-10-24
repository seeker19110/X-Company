import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireSession } from "@/app/server/session";
import { SessionProvider } from "@/app/components/session-context";
import { AppNav } from "@/app/components/app-nav";
import { RumIfEnabled } from "@/app/server/rum";
import { ServiceWorkerRegister } from "@/app/components/sw-register";
import { getPool } from "@/lib/db";
import { unreadCount } from "@/lib/notify";
import { can, PERMISSIONS, type Role } from "@/lib/authz";
import { t } from "@/lib/i18n";
import "../app.css";

export const dynamic = "force-dynamic";
const APPROVER_ROLES: readonly Role[] = PERMISSIONS["attendance.approve"].roles;
export const metadata: Metadata = {
  title: { default: t("brand.internalTitle"), template: t("brand.titleTemplate") },
  robots: { index: false },
  appleWebApp: { capable: true, title: t("brand.name"), statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export default async function SecureLayout({ children }: { children: ReactNode }) {
  const s = await requireSession();
  const approver =
    // Menu Phê duyệt theo danh mục quyền (AUD-XFEAT-006), không danh sách vai trò viết cứng; phạm vi kiểm ở server.
    s.actor.grants.some((g) => APPROVER_ROLES.includes(g.role)) ||
    can(s.actor, "period.manage", { companyId: s.actor.companyId });
  const unread = await unreadCount(getPool(), s.actor.companyId, s.actor.userId);
  return (
    <SessionProvider csrf={s.csrf} userId={s.actor.userId}>
      <div className="app-shell">
        <header className="app-top">
          <strong>{t("brand.name")}</strong>
          <span className="muted">{s.displayName}</span>
        </header>
        <main className="app-main" id="noi-dung">
          {children}
        </main>
        <AppNav approver={approver} unread={unread} />
        <ServiceWorkerRegister />
        <RumIfEnabled />
      </div>
    </SessionProvider>
  );
}
