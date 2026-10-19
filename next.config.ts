import type { NextConfig } from "next";

// Đường dẫn có chuỗi %-mã hoá KHÔNG phải UTF-8 hợp lệ (vd `/%E0%A4%A`, `/%C0%80`): Next 16 tự lưu trữ trả 500 (bộ định tuyến
// ném DecodeError rồi không tìm thấy trang `/400` ở dự án chỉ có App Router; thêm `pages/400` làm JS tĩnh tăng ~110 KB gzip nên
// không dùng). Rewrite chạy TRƯỚC bước giải mã → trả trang 404 thay vì 500 (phát hiện bởi DAST: scripts/dast-baseline.mjs).
// Biểu thức dưới đây phải khớp CHÍNH XÁC những chuỗi mà `decodeURIComponent` ném lỗi — tests/unit/next-config.test.ts kiểm bằng
// thuộc tính trên dữ liệu ngẫu nhiên (đường dẫn hợp lệ, vd slug tiếng Việt, tuyệt đối không bị chuyển hướng).
const HEX = "[0-9A-Fa-f]";
const CONT = `%[89ABab]${HEX}`; // byte tiếp nối 80–BF
const VALID_UTF8_UNIT = [
  "[^%]",
  `%[0-7]${HEX}`, // ASCII
  `%(?:[Cc][2-9A-Fa-f]|[Dd]${HEX})${CONT}`, // 2 byte (C2–DF)
  `%[Ee]0%[ABab]${HEX}${CONT}`, // 3 byte: E0 A0–BF (loại overlong)
  `%[Ee](?:[1-9A-Ca-c]|[EeFf])${CONT}${CONT}`, // 3 byte: E1–EC, EE–EF
  `%[Ee][Dd]%[89]${HEX}${CONT}`, // 3 byte: ED 80–9F (loại cặp thay thế)
  `%[Ff]0%[9ABab]${HEX}${CONT}${CONT}`, // 4 byte: F0 90–BF
  `%[Ff][1-3]${CONT}${CONT}${CONT}`, // 4 byte: F1–F3
  `%[Ff]4%8${HEX}${CONT}${CONT}`, // 4 byte: F4 80–8F
].join("|");
/** Phần sau dấu `/` đầu tiên của đường dẫn thô khi KHÔNG phải chuỗi UTF-8 %-mã hoá hợp lệ. */
export const MALFORMED_PATH_RE = `(?!(?:${VALID_UTF8_UNIT})*$).*`;

/** Giá trị HSTS — PHẢI trùng `securityHeaders()` ở proxy.ts (tests/unit/next-config.test.ts khoá). Trình duyệt bỏ qua HSTS nhận qua http. */
export const API_HSTS = "max-age=31536000; includeSubDomains";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: false,
  // Proxy (proxy.ts) không chạy cho /api (tránh đệm thân request tải tệp 20 MB) nên header tối thiểu cho API đặt ở đây
  // (DAST: JSON thiếu nosniff + HSTS). CSP/X-Frame-Options không cần cho JSON.
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Strict-Transport-Security", value: API_HSTS },
        ],
      },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [{ source: `/:malformed(${MALFORMED_PATH_RE})`, destination: "/khong-hop-le" }],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
