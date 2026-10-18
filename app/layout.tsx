import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";
import { THEME_COLOR } from "@/lib/web/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: t("brand.name"), template: t("brand.titleTemplate") },
  description: t("brand.siteDescription"),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: THEME_COLOR,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
