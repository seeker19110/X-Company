// Gọi API nội bộ từ client: gắn CSRF, Idempotency-Key khi cần; lỗi trả thông điệp tiếng Việt từ server.
import { t } from "@/lib/i18n/client";
import { API_FETCH_TIMEOUT_MS, isTimeoutError } from "@/lib/nen/timeouts";
import { minutesToMs } from "@/lib/nen/units";

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  /** Lỗi theo trường từ problem+json (`fields`), khi server trả 400 VALIDATION (FE-FORM-001). */
  fields?: { path: string; message: string }[];
  /** Mã lỗi máy đọc của problem+json (`code`), vd INVALID_MFA_CODE — để giao diện rẽ nhánh, không so chuỗi thông điệp. */
  code?: string;
  /** Giây phải chờ (header Retry-After của 429). */
  retryAfter?: number;
}

/** Khoá đang dùng cho một thao tác chưa có kết quả chắc chắn: gửi lại cùng route + cùng nội dung → cùng khoá. */
const pendingKeys = new Map<string, { key: string; at: number }>();
const PENDING_KEY_TTL_MS = minutesToMs(10);

export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Mỗi lần submit POST (trừ đăng nhập/đăng xuất) tự sinh Idempotency-Key (ARC-INT-001). Lỗi mạng/timeout/5xx/409 (không
 * biết server đã xử lý chưa) → giữ khoá để bấm lại hoặc thử lại trong cùng thao tác dùng lại đúng khoá (server trả
 * phản hồi cũ, không ghi lần hai); thành công hoặc bị từ chối rõ ràng (4xx khác) → bỏ khoá, lần submit sau là thao tác mới.
 */
export async function api<T = unknown>(
  method: "GET" | "POST",
  path: string,
  opts: { csrf?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  const bodyText = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  const auto = method === "POST" && !opts.idempotencyKey && !path.startsWith("/api/app/auth/");
  const sig = `${path}\n${bodyText ?? ""}`;
  let key = opts.idempotencyKey;
  if (auto) {
    const now = Date.now();
    for (const [k, v] of pendingKeys) if (now - v.at > PENDING_KEY_TTL_MS) pendingKeys.delete(k);
    key = pendingKeys.get(sig)?.key ?? newIdempotencyKey();
    pendingKeys.set(sig, { key, at: now });
  }
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.csrf) headers["x-csrf-token"] = opts.csrf;
  if (key) headers["idempotency-key"] = key;
  try {
    const res = await fetch(path, {
      method,
      headers,
      body: bodyText,
      credentials: "same-origin",
      signal: AbortSignal.timeout(API_FETCH_TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => ({}))) as {
      code?: string;
      error?: { message?: string };
      fields?: { path: string; message: string }[];
    } & T;
    // Phản hồi chắc chắn (thành công hoặc 4xx ngoài 409/429): thao tác kết thúc, bỏ khoá.
    if (auto && (res.ok || (res.status < 500 && res.status !== 409 && res.status !== 429)))
      pendingKeys.delete(sig);
    if (!res.ok) {
      const retry = Number(res.headers.get("retry-after"));
      return {
        ok: false,
        status: res.status,
        error: json.error?.message ?? t("api.status", { status: res.status }),
        ...(Array.isArray(json.fields) ? { fields: json.fields } : {}),
        ...(typeof json.code === "string" ? { code: json.code } : {}),
        ...(retry > 0 ? { retryAfter: retry } : {}),
      };
    }
    return { ok: true, status: res.status, data: json };
  } catch (err) {
    const error = isTimeoutError(err) ? t("api.timeout") : t("api.offline");
    return { ok: false, status: 0, error };
  }
}
