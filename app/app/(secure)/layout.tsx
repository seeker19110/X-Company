import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireSession } from "@/app/server/session";
import { SessionProvider } from "@/app/components/session-context";
import { AppNav } from "@/app/components/app-nav";
import { ServiceWorkerRegister } from "@/app/components/sw-register";
import { can } from "@/lib/authz";
import { t } from "@/lib/i18n";
import "../app.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: { default: t("brand.internalTitle"), template: t("brand.titleTemplate") },
  robots: { index: false },
  appleWebApp: { capable: true, title: t("brand.name"), statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export default async function SecureLayout({ children }: { children: ReactNode }) {
  const s = await requireSession();
  const approver =
    s.actor.grants.some((g) => ["team_lead", "hr"].includes(g.role)) ||
    can(s.actor, "period.manage", { companyId: s.actor.companyId });
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
        <AppNav approver={approver} />
        <ServiceWorkerRegister />
      </div>
    </SessionProvider>
  );
}
