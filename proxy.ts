// Proxy (Next 16, thay middleware): header bảo mật + CSP có nonce cho mọi trang; chuyển chưa đăng nhập ở /app về
// /app/login (chỉ xét có cookie phiên — KIỂM QUYỀN THẬT nằm ở server: withActor / requireSession).
import { NextResponse, type NextRequest } from "next/server";
import { env } from "./lib/nen/env.ts";

export function securityHeaders(
  nonce: string,
  opts: { dev: boolean; https: boolean },
): Record<string, string> {
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
  const h: Record<string, string> = {
    "content-security-policy": csp,
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(self), geolocation=(self), microphone=(), payment=(), usb=()",
    "cross-origin-opener-policy": "same-origin",
  };
  if (opts.https) h["strict-transport-security"] = "max-age=31536000; includeSubDomains";
  return h;
}

const SESSION_COOKIES = ["__Host-xc_session", "xc_session"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/app") &&
    pathname !== "/app/login" &&
    !SESSION_COOKIES.some((c) => request.cookies.has(c))
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/app/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const headers = securityHeaders(nonce, {
    dev: env("NODE_ENV") === "development",
    https: env("APP_ORIGIN").startsWith("https://"),
  });
  // Next đọc CSP ở request header để gắn nonce cho script của nó.
  const reqHeaders = new Headers(request.headers);
  reqHeaders.set("x-nonce", nonce);
  reqHeaders.set("content-security-policy", headers["content-security-policy"]!);
  const res = NextResponse.next({ request: { headers: reqHeaders } });
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}

export const config = {
  // Bỏ qua tài nguyên tĩnh và API (API trả JSON, header riêng ở lib/http).
  matcher: [
    { source: "/((?!api|_next/static|_next/image|favicon.ico|icons/|sw.js|manifest.webmanifest).*)" },
  ],
};
