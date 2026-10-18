"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { t } from "@/lib/i18n/client-app";

/** Điều hướng chính (SPEC-pwa): Hôm nay, Công việc, Chấm công, Cá nhân (+ Phê duyệt cho người duyệt). */
export function AppNav({ approver }: { approver: boolean }) {
  const path = usePathname();
  const items = [
    { href: "/app/today", label: t("nav.today") },
    { href: "/app/tasks", label: t("nav.tasks") },
    { href: "/app/attendance", label: t("nav.attendance") },
    ...(approver ? [{ href: "/app/approvals", label: t("nav.approvals") }] : []),
    { href: "/app/me", label: t("nav.me") },
  ];
  return (
    <nav className="app-nav" aria-label={t("nav.label")}>
      <ul>
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} aria-current={path?.startsWith(i.href) ? "page" : undefined}>
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
