// Timeout tường minh cho lời gọi ra ngoài phía client (ARC-RES-001, BE-REL-001) — không dùng mặc định vô hạn của fetch.
/** Lời gọi API thường (đọc/ghi một bản ghi). */
export const API_FETCH_TIMEOUT_MS = 15_000;
/** Đồng bộ lô ngoại tuyến (tối đa 50 bản ghi) — rộng hơn; hết hạn thì bản ghi vẫn pending và được thử lại. */
export const SYNC_FETCH_TIMEOUT_MS = 30_000;

/** Lỗi do hết thời gian chờ (AbortSignal.timeout ném TimeoutError) — để hiển thị thông điệp riêng. */
export function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}
