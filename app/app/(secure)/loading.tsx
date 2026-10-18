import { t } from "@/lib/i18n";

/** Trạng thái đang tải cho mọi màn dữ liệu của khu nội bộ (today, tasks, approvals, attendance, dashboard, me). */
export default function SecureLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <p className="muted">{t("common.loading")}</p>
      <div className="skeleton" />
      <div className="skeleton" />
    </div>
  );
}
