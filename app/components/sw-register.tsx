"use client";

import { useEffect, useSyncExternalStore } from "react";
import { t } from "@/lib/i18n/client-app";
import { reportClientError } from "./client-log";

const subscribe = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};

/** Đăng ký service worker cho phạm vi /app/ (chỉ HTTPS hoặc localhost — trình duyệt tự chặn ngoài ra), và hiện dải
 *  "Đang ngoại tuyến" khi mất mạng (AUD-A11Y-008). Tải lại khi mất mạng: SW trả `/offline.html` (trang /app/** là
 *  `private, no-store` nên không có bản lưu để hiển thị dữ liệu cũ). */
export function ServiceWorkerRegister() {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/app/" })
        .catch((e: unknown) => reportClientError("đăng ký service worker thất bại", e));
    }
  }, []);
  // Vùng role=status luôn có mặt (rỗng khi online) để trình đọc màn hình thông báo khi nội dung đổi.
  return (
    <p role="status" className="net-banner">
      {online ? "" : t("netStatus.offline")}
    </p>
  );
}
