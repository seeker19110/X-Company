// Thông báo thân thiện cho người dùng; không bao giờ đưa nguyên `e.message` của thư viện/trình duyệt lên giao diện
// (UX-STATE-005, OWASP: không lộ chi tiết nội bộ). Chi tiết kỹ thuật đi qua reportClientError (DevTools), không lên UI.

import { t } from "@/lib/i18n/client-app";

/** Lỗi đọc/ghi IndexedDB (hàng chờ ngoại tuyến) → câu tiếng Việt, theo tên lỗi DOMException khi nhận ra được. */
export function syncErrorMessage(e: unknown): string {
  const name = e instanceof Error ? e.name : "";
  switch (name) {
    case "QuotaExceededError":
      return t("sync.error.quota");
    case "InvalidStateError":
    case "SecurityError":
    case "NotAllowedError":
      return t("sync.error.blocked");
    case "VersionError":
      return t("sync.error.version");
    default:
      return t("sync.error.unknown");
  }
}

export { ERROR_VIEW_TEXT } from "./error-text";
