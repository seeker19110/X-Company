// Thông báo thân thiện cho người dùng; không bao giờ đưa nguyên `e.message` của thư viện/trình duyệt lên giao diện
// (UX-STATE-005, OWASP: không lộ chi tiết nội bộ). Chi tiết kỹ thuật đi qua reportClientError (DevTools), không lên UI.

/** Lỗi đọc/ghi IndexedDB (hàng chờ ngoại tuyến) → câu tiếng Việt, theo tên lỗi DOMException khi nhận ra được. */
export function syncErrorMessage(e: unknown): string {
  const name = e instanceof Error ? e.name : "";
  switch (name) {
    case "QuotaExceededError":
      return "Bộ nhớ thiết bị đã đầy nên chưa lưu được dữ liệu. Hãy giải phóng dung lượng rồi bấm Đồng bộ.";
    case "InvalidStateError":
    case "SecurityError":
    case "NotAllowedError":
      return "Trình duyệt đang chặn lưu dữ liệu trên thiết bị (chế độ riêng tư hoặc bị tắt). Hãy mở lại ứng dụng ở cửa sổ thường.";
    case "VersionError":
      return "Dữ liệu trên thiết bị thuộc phiên bản khác. Hãy tải lại trang rồi bấm Đồng bộ.";
    default:
      return "Không đọc được dữ liệu trên thiết bị. Hãy thử Đồng bộ lại; nếu vẫn lỗi, tải lại trang.";
  }
}

export const ERROR_VIEW_TEXT = {
  title: "Đã xảy ra lỗi",
  body: "Chưa tải được nội dung này. Dữ liệu của bạn không bị mất. Hãy thử lại; nếu lỗi lặp lại, vui lòng liên hệ quản trị.",
  retry: "Thử lại",
} as const;
