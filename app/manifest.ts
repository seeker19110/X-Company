import type { MetadataRoute } from "next";
import { t } from "@/lib/i18n";
import { BACKGROUND_COLOR, THEME_COLOR } from "@/lib/web/theme";

/** Manifest PWA (SPEC-pwa): cài đặt ứng dụng nội bộ; phạm vi /app/, mở thẳng màn hình Hôm nay. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app/",
    name: t("manifest.name"),
    short_name: t("brand.name"),
    description: t("manifest.description"),
    lang: "vi",
    start_url: "/app/today",
    scope: "/app/",
    display: "standalone",
    orientation: "portrait",
    background_color: BACKGROUND_COLOR,
    theme_color: THEME_COLOR,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
