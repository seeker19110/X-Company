// Báo lỗi không chặn luồng ở phía trình duyệt (logger JSON của server dùng Node API nên không chạy ở client).
// Đây là NƠI DUY NHẤT ở app/ được gọi console — lỗi không bị nuốt (BASE-ERR-001) mà vẫn lộ ở DevTools.
// Chỉ ghi ngữ cảnh + tên/mô tả lỗi; không ghi dữ liệu người dùng.
export function reportClientError(context: string, err: unknown): void {
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  // eslint-disable-next-line no-console -- kênh báo lỗi duy nhất ở client (không có logger Node ở trình duyệt)
  console.warn(`[client] ${context}: ${detail}`);
}
