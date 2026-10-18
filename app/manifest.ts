import type { MetadataRoute } from "next";

/** Manifest PWA (SPEC-pwa): cài đặt ứng dụng nội bộ; phạm vi /app/, mở thẳng màn hình Hôm nay. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app/",
    name: "X-Company — làm việc",
    short_name: "X-Company",
    description: "Chấm công, công việc và phê duyệt của X-Company.",
    lang: "vi",
    start_url: "/app/today",
    scope: "/app/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#0f3d5e",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
