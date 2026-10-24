import type { ReactNode } from "react";
import Link from "next/link";
import { formatDateTime } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/client-app";

/** Thông báo như API trả (chỉ chủ đề + tham chiếu + mã; ngày giờ là Date hoặc chuỗi ISO). */
export interface NotificationRow {
  id: string;
  topic: string;
  ref_type: string;
  ref_id: string;
  code: string | null;
  created_at: Date | string;
  read_at: Date | string | null;
}

/** Câu mô tả theo chủ đề (không PII: chỉ mã tra cứu). */
export function notificationText(topic: string, code: string | null): string {
  if (topic === "inquiry.assigned")
    return code
      ? t("notifications.text.inquiryAssigned", { code })
      : t("notifications.text.inquiryAssignedNoCode");
  if (topic === "application.received")
    return code ? t("notifications.text.applicationReceived", { code }) : t("notifications.text.other");
  if (topic === "task.assigned") return t("notifications.text.taskAssigned");
  if (topic.startsWith("task.")) return t("notifications.text.taskUpdated");
  return t("notifications.text.other");
}

/** Trang đích của đối tượng; chỉ việc có trang tương ứng (liên hệ/hồ sơ ứng viên chưa có màn hình nội bộ → không liên kết). */
export function notificationHref(refType: string): string | null {
  return refType === "task" ? "/app/tasks" : null;
}

export interface NotificationsViewProps {
  items: readonly NotificationRow[];
  unread: number;
  /** Nút "đánh dấu tất cả" (client) — chỉ hiện khi còn chưa đọc. */
  markAll?: ReactNode;
  /** Nút đánh dấu một thông báo (client). */
  markOne?: (n: NotificationRow, text: string) => ReactNode;
  prevHref?: string | null;
  nextHref?: string | null;
}

export function NotificationsView({
  items,
  unread,
  markAll,
  markOne,
  prevHref,
  nextHref,
}: NotificationsViewProps) {
  return (
    <>
      <h1>{t("notifications.title")}</h1>
      <p className="muted">
        {unread > 0 ? t("notifications.unreadSummary", { count: unread }) : t("notifications.allRead")}
      </p>
      {unread > 0 && markAll}
      {items.length === 0 ? (
        <p className="muted">{t("notifications.empty")}</p>
      ) : (
        <ul className="list" aria-label={t("notifications.listLabel")}>
          {items.map((n) => {
            const text = notificationText(n.topic, n.code);
            const href = notificationHref(n.ref_type);
            const isUnread = n.read_at === null;
            return (
              <li key={n.id} className={isUnread ? "notif notif-unread" : "notif"}>
                {isUnread ? (
                  <span className="badge">{t("notifications.unreadLabel")}</span>
                ) : (
                  <span className="visually-hidden">{t("notifications.readLabel")}</span>
                )}{" "}
                <strong>{text}</strong>
                <br />
                <span className="muted">{formatDateTime(n.created_at)}</span>
                {(href !== null || (isUnread && markOne !== undefined)) && (
                  <div className="row row-actions">
                    {href !== null && (
                      <Link className="btn" href={href}>
                        {t("notifications.openTask")}
                      </Link>
                    )}
                    {isUnread ? markOne?.(n, text) : null}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {(prevHref != null || nextHref != null) && (
        <nav aria-label={t("notifications.pagerLabel")} className="row row-actions">
          {prevHref != null && (
            <Link className="btn" href={prevHref}>
              {t("notifications.prev")}
            </Link>
          )}
          {nextHref != null && (
            <Link className="btn" href={nextHref}>
              {t("notifications.next")}
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
