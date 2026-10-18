"use client";

import { useEffect } from "react";
import { reportClientError } from "@/app/components/client-log";
import { ErrorView } from "@/app/components/error-view";

/** Ranh giới lỗi khu nội bộ: giữ khung (menu, phiên), chỉ thay phần nội dung; không lộ e.message. */
export default function SecureError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(`lỗi hiển thị màn hình nội bộ (digest ${error.digest ?? "-"})`, error);
  }, [error]);
  return <ErrorView reset={reset} homeHref="/app/today" homeLabel="Về màn hình Hôm nay" />;
}
