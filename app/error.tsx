"use client";

import { useEffect } from "react";
import { reportClientError } from "./components/client-log";
import { ErrorView } from "./components/error-view";
import { t } from "@/lib/i18n/client";

/** Ranh giới lỗi gốc (website công khai): lỗi chi tiết chỉ ghi DevTools, người dùng thấy thông báo chung + Thử lại. */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(`lỗi hiển thị trang (digest ${error.digest ?? "-"})`, error);
  }, [error]);
  return (
    <main className="wrap">
      <ErrorView reset={reset} homeHref="/" homeLabel={t("errorView.homePublic")} />
    </main>
  );
}
