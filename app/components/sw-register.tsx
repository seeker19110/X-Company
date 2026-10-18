"use client";

import { useEffect } from "react";

/** Đăng ký service worker cho phạm vi /app/ (chỉ HTTPS hoặc localhost — trình duyệt tự chặn ngoài ra). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/app/" }).catch(() => undefined);
    }
  }, []);
  return null;
}
