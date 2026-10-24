"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { t } from "@/lib/i18n/client-app";

/** Điều hướng chính (SPEC-pwa): Hôm nay, Công việc, Chấm công, Cá nhân (+ Phê duyệt cho người duyệt). */
export function AppNav({ approver, unread = 0 }: { approver: boolean; unread?: number }) {
  const path = usePathname();
  const items: { href: string; label: string; unread?: number }[] = [
    { href: "/app/today", label: t("nav.today") },
    { href: "/app/tasks", label: t("nav.tasks") },
    { href: "/app/attendance", label: t("nav.attendance") },
    ...(approver ? [{ href: "/app/approvals", label: t("nav.approvals") }] : []),
    { href: "/app/thong-bao", label: t("nav.notifications"), unread },
    { href: "/app/me", label: t("nav.me") },
  ];
  return (
    <nav className="app-nav" aria-label={t("nav.label")}>
      <ul>
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} aria-current={path?.startsWith(i.href) ? "page" : undefined}>
              {i.unread !== undefined && i.unread > 0 ? (
                <>
                  {/* Tên đọc đủ "Thông báo, N chưa đọc"; số hiển thị là chữ (không chỉ màu), ẩn khỏi cây truy cập để khỏi đọc hai lần. */}
                  <span className="visually-hidden">{t("nav.notificationsUnread", { count: i.unread })}</span>
                  <span aria-hidden="true">{i.label}</span>
                  <span className="nav-count" aria-hidden="true">
                    {i.unread > 99 ? "99+" : i.unread}
                  </span>
                </>
              ) : (
                i.label
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
