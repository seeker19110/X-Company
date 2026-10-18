// Truy cập cấu hình theo ngữ nghĩa nghiệp vụ. Đọc biến môi trường chỉ qua lib/nen/env.ts (BASE-CFG-002).
import { env } from "./env.ts";

export function sessionSecret(): Buffer {
  return Buffer.from(env("SESSION_SECRET"));
}

/** Origin công khai của ứng dụng (vd https://x-company.vn) — dùng kiểm Origin chống CSRF và cờ Secure của cookie. */
export function appOrigin(): string {
  return env("APP_ORIGIN");
}

export function isSecureOrigin(): boolean {
  return appOrigin().startsWith("https://");
}
