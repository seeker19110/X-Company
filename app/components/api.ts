// Gọi API nội bộ từ client: gắn CSRF, Idempotency-Key khi cần; lỗi trả thông điệp tiếng Việt từ server.
import { API_FETCH_TIMEOUT_MS, isTimeoutError } from "@/lib/nen/timeouts";

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

export async function api<T = unknown>(
  method: "GET" | "POST",
  path: string,
  opts: { csrf?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.csrf) headers["x-csrf-token"] = opts.csrf;
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  try {
    const res = await fetch(path, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: "same-origin",
      signal: AbortSignal.timeout(API_FETCH_TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
    if (!res.ok) return { ok: false, status: res.status, error: json.error?.message ?? `Lỗi ${res.status}` };
    return { ok: true, status: res.status, data: json };
  } catch (err) {
    const error = isTimeoutError(err)
      ? "Máy chủ phản hồi quá lâu, vui lòng thử lại"
      : "Không kết nối được máy chủ";
    return { ok: false, status: 0, error };
  }
}
