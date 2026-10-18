import type { Metadata } from "next";
import { requireSession } from "@/app/server/session";
import { t } from "@/lib/i18n";
import { EMPTY } from "@/lib/i18n/format";
import { LogoutButton } from "@/app/components/logout-button";
import { SyncStatus } from "@/app/components/sync-status";

export const metadata: Metadata = { title: t("me.title") };
const ROLE: Record<string, string> = {
  employee: t("me.role.employee"),
  team_lead: t("me.role.team_lead"),
  project_manager: t("me.role.project_manager"),
  hr: t("me.role.hr"),
  accountant: t("me.role.accountant"),
  editor: t("me.role.editor"),
  sales: t("me.role.sales"),
  executive: t("me.role.executive"),
  sysadmin: t("me.role.sysadmin"),
  sensitive_exporter: t("me.role.sensitive_exporter"),
};

export default async function MePage() {
  const s = await requireSession();
  const roles = s.actor.grants.map((g) => ROLE[g.role] ?? g.role).join(", ");
  return (
    <>
      <h1>{t("me.title")}</h1>
      <section className="card">
        <p>
          <strong>{s.displayName}</strong>
        </p>
        <p>{t("me.roles", { roles: roles === "" ? EMPTY : roles })}</p>
      </section>
      <SyncStatus />
      <LogoutButton />
    </>
  );
}
