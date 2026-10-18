// Cấu hình từ biến môi trường (mẫu ở .env.example). Đọc lười để test đặt biến trước khi dùng.
export function sessionSecret(): Buffer {
  const s = process.env.SESSION_SECRET ?? "";
  if (Buffer.byteLength(s) < 32) throw new Error("SESSION_SECRET thiếu hoặc ngắn hơn 32 byte");
  return Buffer.from(s);
}

/** Origin công khai của ứng dụng (vd https://x-company.vn) — dùng kiểm Origin chống CSRF và cờ Secure của cookie. */
export function appOrigin(): string {
  const o = process.env.APP_ORIGIN?.trim();
  if (!o) throw new Error("Thiếu APP_ORIGIN");
  return new URL(o).origin;
}

export function isSecureOrigin(): boolean {
  return appOrigin().startsWith("https://");
}
