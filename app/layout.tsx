import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { THEME_COLOR } from "@/lib/web/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "X-Company", template: "%s · X-Company" },
  description: "X-Company — giới thiệu năng lực, dịch vụ và tiếp nhận yêu cầu khách hàng.",
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
