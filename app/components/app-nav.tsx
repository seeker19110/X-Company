"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Điều hướng chính (SPEC-pwa): Hôm nay, Công việc, Chấm công, Cá nhân (+ Phê duyệt cho người duyệt). */
export function AppNav({ approver }: { approver: boolean }) {
  const path = usePathname();
  const items = [
    { href: "/app/today", label: "Hôm nay" },
    { href: "/app/tasks", label: "Công việc" },
    { href: "/app/attendance", label: "Chấm công" },
    ...(approver ? [{ href: "/app/approvals", label: "Duyệt" }] : []),
    { href: "/app/me", label: "Cá nhân" },
  ];
  return (
    <nav className="app-nav" aria-label="Điều hướng ứng dụng">
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
