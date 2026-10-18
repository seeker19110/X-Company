import Link from "next/link";
import type { ReactNode } from "react";
import "./site.css";

const NAV = [
  { href: "/gioi-thieu", label: "Giới thiệu" },
  { href: "/dich-vu", label: "Dịch vụ" },
  { href: "/du-an", label: "Dự án" },
  { href: "/nang-luc", label: "Năng lực" },
  { href: "/tin-tuc", label: "Tin tức" },
  { href: "/tuyen-dung", label: "Tuyển dụng" },
  { href: "/lien-he", label: "Liên hệ" },
];

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <a className="skip" href="#noi-dung">
        Bỏ qua tới nội dung
      </a>
      <header className="site-header">
        <div className="wrap">
          <Link href="/" className="brand">
            X-Company
          </Link>
          <nav aria-label="Điều hướng chính">
            <ul>
              {NAV.map((n) => (
                <li key={n.href}>
                  <Link href={n.href}>{n.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>
      <main id="noi-dung" className="wrap">
        {children}
      </main>
      <footer className="site-footer">
        <div className="wrap">
          <p>© X-Company</p>
          <p>
            <Link href="/lien-he">Gửi yêu cầu</Link> ·{" "}
            <Link href="/chinh-sach-du-lieu">Chính sách dữ liệu cá nhân</Link>
          </p>
        </div>
      </footer>
    </>
  );
}
