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

/** Đường dẫn tĩnh proxy.ts không chạy qua (khớp phần loại trừ của matcher, trừ `api` đã có khối riêng). */
export const STATIC_SOURCES = [
  "/_next/static/:path*",
  "/_next/image",
  "/favicon.ico",
  "/icons/:path*",
  "/sw.js",
  "/manifest.webmanifest",
];

/** Mẫu đường dẫn source map của tệp tĩnh (khớp `/_next/static/<…>.map`). */
export const SOURCE_MAP_SOURCE = "/_next/static/:path(.*\\.map)";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Source map trình duyệt (T-122, PRF-WEB-008): SINH lúc build để giải stack của kho lỗi tự host, nhưng KHÔNG phục vụ —
  // `npm run build` chạy scripts/sourcemaps-stash.mjs chuyển *.map ra .data/sourcemaps/<release>/ và bỏ `sourceMappingURL`
  // (còn sót → build đỏ); rewrite dưới đây chặn *.map lần nữa. DAST (`npm run -s dast:probes`) kiểm 404 + không tham chiếu.
  productionBrowserSourceMaps: true,
  reactStrictMode: true,
  typedRoutes: false,
  // proxy.ts bỏ qua /api (JSON, header riêng ở lib/http; tránh đệm thân request tải tệp 20 MB) nên header cho API đặt ở đây:
  // CSP chặt cho cả 404 của /api (ZAP 10038), nosniff + HSTS (DAST). `:path*` khớp cả chính `/api`.
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Strict-Transport-Security", value: API_HSTS },
        ],
      },
      // Tệp tĩnh mà proxy.ts cũng bỏ qua (matcher) không nhận header của proxy → thiếu nosniff + HSTS (ZAP 10021/10035 khi
      // quét qua https thật: staging:drill). Giữ khớp danh sách loại trừ trong `config.matcher` của proxy.ts.
      ...STATIC_SOURCES.map((source) => ({
        source,
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Strict-Transport-Security", value: API_HSTS },
        ],
      })),
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [
        { source: `/:malformed(${MALFORMED_PATH_RE})`, destination: "/khong-hop-le" },
        // Lớp thứ hai cho source map (T-122): kể cả khi bước `sourcemaps-stash` bị bỏ qua (chạy `next build` trần), *.map dưới
        // /_next/static không bao giờ được phục vụ — rewrite beforeFiles chạy TRƯỚC tệp tĩnh, trỏ tới trang không tồn tại → 404.
        { source: SOURCE_MAP_SOURCE, destination: "/khong-hop-le" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
