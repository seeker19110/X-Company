"use client";

import { useEffect } from "react";
import { sendClientError, setErrorRelease } from "./client-log";

// Kho lỗi tự host (T-122, PRF-WEB-008): đặt release của trang cho reportClientError và bắt lỗi CHƯA xử lý của tài liệu
// (window `error`, `unhandledrejection`) gửi về /api/public/errors. Cài ở cấp module một lần cho mỗi tài liệu (như RumBeacon):
// điều hướng client đổi component, không đổi tài liệu.
let installed = false;

export function ErrorReporter({ release }: { release: string }) {
  useEffect(() => {
    setErrorRelease(release);
    if (installed) return;
    installed = true;
    addEventListener("error", (e: ErrorEvent) => {
      // Lỗi tải tài nguyên (img/script) không có `error` và message rỗng → bỏ; lỗi script khác nguồn ("Script error.") cũng vô ích.
      if (e.error === undefined && (e.message === "" || e.message === "Script error.")) return;
      sendClientError("window.onerror", e.error ?? e.message);
    });
    addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
      sendClientError("unhandledrejection", e.reason);
    });
  }, [release]);
  return null;
}
