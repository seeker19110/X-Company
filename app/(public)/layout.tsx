import Link from "next/link";
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";
import "./site.css";

const NAV = [
  { href: "/gioi-thieu", label: t("site.nav.about") },
  { href: "/dich-vu", label: t("site.nav.services") },
  { href: "/du-an", label: t("site.nav.projects") },
  { href: "/nang-luc", label: t("site.nav.capability") },
  { href: "/tin-tuc", label: t("site.nav.news") },
  { href: "/tuyen-dung", label: t("site.nav.jobs") },
  { href: "/lien-he", label: t("site.nav.contact") },
];

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <a className="skip" href="#noi-dung">
        {t("site.skip")}
      </a>
      <header className="site-header">
        <div className="wrap">
          <Link href="/" className="brand">
            {t("brand.name")}
          </Link>
          <nav aria-label={t("site.navLabel")}>
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
          <p>{t("site.footer.copyright")}</p>
          <p>
            <Link href="/lien-he">{t("site.footer.sendRequest")}</Link> ·{" "}
            <Link href="/chinh-sach-du-lieu">{t("site.footer.privacy")}</Link>
          </p>
        </div>
      </footer>
    </>
  );
}
