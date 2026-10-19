---
title: Staging có TLS cục bộ (Caddy + ZAP)
updated: 2026-10-19
status: faithful-fixture — máy dev, CA nội bộ của Caddy; KHÔNG phải staging/production thật
---

# Staging có TLS cục bộ (T-055)

Sinh bởi `npm run -s staging:drill` lúc 2026-10-19T12:33:57.332Z trên commit `00a1e45ed0eae4263109e460f0013570876a2532+dirty`. Kết luận: **PASS**.

Caddy 2.11.7 (`tls internal`) chấm dứt TLS cho `https://staging.localhost` → `next start` (TRUST_PROXY_HOPS=1); OWASP ZAP 2.17.0 quét qua https. Công cụ ghim hash ở `scripts/tools/install-tool.mjs`. Node v22.22.0, Next 16.4.2.

| Nhóm | Kiểm | Kết quả | Chi tiết |
| --- | --- | --- | --- |
| cấu hình | Caddyfile mẫu cho tên miền thật hợp lệ | đạt | caddy validate: OK |
| TLS | chuỗi chứng chỉ hợp lệ với CA của Caddy, đúng tên | đạt | authorized=true, issuer=Caddy Local Authority - ECC Intermediate |
| TLS | giao thức TLS 1.3 | đạt | TLSv1.3 · TLS_AES_128_GCM_SHA256 |
| TLS | SAN chứa đúng tên staging | đạt | DNS:staging.localhost |
| TLS | tên lạ không được phục vụ chứng chỉ hợp lệ | đạt | từ chối: EPROTO |
| TLS | máy chủ từ chối TLS ≤ 1.1 | đạt | từ chối: EPROTO |
| TLS | TLS 1.2 (khách cũ) vẫn bắt tay với bộ mã ECDHE + AEAD | đạt | TLSv1.2 · ECDHE-ECDSA-AES128-GCM-SHA256 |
| HTTP | http chuyển hướng 308 sang https giữ nguyên đường dẫn | đạt | 308 → https://staging.localhost:42357/lien-he?x=1 |
| header | trang HTML: CSP, HSTS ≥ 180 ngày, XFO, nosniff, Referrer-Policy… | đạt | HSTS: max-age=31536000; includeSubDomains |
| header | API: nosniff, HSTS, JSON | đạt | HTTP 401 |
| cookie | đăng nhập qua https: cookie phiên __Host-, Secure, HttpOnly, SameSite | đạt | __Host-xc_session |
| ZAP | ZAP 2.17.0 quét baseline qua https (spider + passive) | đạt | site: https://staging.localhost:42357 · 8 loại cảnh báo · exit 0 |
| ZAP | zap-gate: không còn cảnh báo Medium+ ngoài allowlist | đạt | ZAP: 0 cảnh báo Medium trở lên trong 1 báo cáo |

Báo cáo ZAP đầy đủ: [staging-zap-baseline.json](staging-zap-baseline.json).

## Không chứng minh

- Chứng chỉ do CA nội bộ của Caddy cấp (`tls internal`), không phải ACME/Let's Encrypt công khai; trình duyệt người dùng thật không tin CA này. Tên miền thật + ACME: cấu hình mẫu ops/caddy/Caddyfile (chỉ kiểm cú pháp).
- Một máy dev: Caddy và app cùng máy qua 127.0.0.1; không có CDN/WAF/cân bằng tải, không đo độ trễ mạng thật.
- ZAP chỉ quét baseline (spider + passive, giới hạn thời gian); quét chủ động có ở job CI `dast` (http). Không phải pentest.
- TLS: kiểm phiên bản giao thức, chuỗi chứng chỉ, SAN; không chấm điểm bộ mã hoá kiểu SSL Labs, không kiểm OCSP stapling/CT.
