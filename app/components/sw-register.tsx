"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
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
 *  "Đang ngoại tuyến" khi mất mạng hoặc khi trang được SW lấy từ bộ đệm (dữ liệu có thể cũ — AUD-A11Y-008). */
export function ServiceWorkerRegister() {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const sw = navigator.serviceWorker;
    const onMsg = (e: MessageEvent<{ type?: string; stale?: boolean }>) => {
      if (e.data?.type === "stale") setStale(e.data.stale === true);
    };
    sw.addEventListener("message", onMsg);
    sw.register("/sw.js", { scope: "/app/" })
      .then(() => sw.ready)
      .then((r) => r.active?.postMessage({ type: "stale?", url: location.href }))
      .catch((e: unknown) => reportClientError("đăng ký service worker thất bại", e));
    return () => sw.removeEventListener("message", onMsg);
  }, []);
  // Vùng role=status luôn có mặt (rỗng khi online) để trình đọc màn hình thông báo khi nội dung đổi.
  return (
    <p role="status" className="net-banner">
      {!online ? t("netStatus.offline") : stale ? t("netStatus.stale") : ""}
    </p>
  );
}
