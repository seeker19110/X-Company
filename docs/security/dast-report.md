---
title: Báo cáo DAST cục bộ — X-Company
updated: 2026-10-19
status: PASS — faithful-fixture, máy dev (sinh bằng `npm run -s dast:probes`; không sửa tay)
---

# Báo cáo DAST cục bộ (T-047, SEC-WEB-004)

> **Nhãn bằng chứng: faithful-fixture.** Bộ probe tự viết (Node thuần + Chromium của Playwright) tấn công bản build production
> (`next start`) trên máy dev với Postgres tạm và dữ liệu seed. **Không phải** quét hạ tầng production/staging thật, **không phải** ZAP,
> và không thay pentest. Sinh lại: `npm run -s dast:probes`.

| Mục | Giá trị |
|---|---|
| Ngày (UTC) | 2026-10-19 |
| Commit | `e9c178b9965f3d51cbe54f1c3a999ab16fb6c421+dirty` |
| Môi trường | máy dev: Linux 6.18.44-fc-v139 x64; 4 x Intel(R) Xeon(R) Processor @ 2.10GHz; 16 GiB RAM; Node v22.22.0; Next 16.4.2; psql (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) |
| Đích | `next start` bản build production, 127.0.0.1:3200 (http) + instance thứ hai 3201 với `APP_ORIGIN=https://…` để kiểm HSTS/Secure/__Host- (TLS không chấm dứt ở Node — mô phỏng proxy TLS) |
| Cấu hình đặc biệt | `TRUST_PROXY_HOPS=1` (mỗi nhóm probe dùng X-Forwarded-For riêng để không giành bộ đếm giới hạn); `METRICS_TOKEN` ngẫu nhiên đặt để kiểm 401 |
| Trình duyệt | Chromium 156.0.8078.4 (Playwright, headless) |
| Tổng | 9 nhóm: 9 PASS, 0 FAIL; 155 kiểm tra, 630 request |

| Nhóm | Kết quả | Mục blueprint/chuẩn |
|---|---|---|
| DAST-A Header bảo mật mọi trang/route chính | **PASS** | PRF-WEB-007, SEC-WEB-006, SEC-WEB-014 |
| DAST-B Cookie phiên (HttpOnly/SameSite/Secure/__Host-/vòng đời) | **PASS** | SEC-WEB-023, SEC-WEB-007, ASVS V7 |
| DAST-C XSS phản chiếu & lưu (HTML + Chromium thật) | **PASS** | SEC-WEB-004, FE-SEC-001, ASVS V1/V3, Top10:2025 A05 |
| DAST-D CSRF (token + Origin) và CORS | **PASS** | SEC-WEB-007, SEC-WEB-013, ASVS V3 |
| DAST-E Open redirect (next/redirect/returnTo…, đường dẫn dị dạng, Host) | **PASS** | SEC-WEB-017, ASVS V3 |
| DAST-F Rò thông tin lỗi (stack/SQL/đường dẫn; RFC 9457) | **PASS** | BASE-ERR-003, SEC-WEB-002, SEC-WEB-014, ASVS V16 |
| DAST-G Đường dẫn nhạy cảm không được phục vụ (.env, .git, source map, metrics, uploads) | **PASS** | PRF-WEB-008, SEC-WEB-014, SEC-WEB-019, OPS-OBS-003, ASVS V13 |
| DAST-I IDOR/BOLA và BFLA giữa các người dùng seed trên /api/app/* | **PASS** | STD-SEC-004, OWASP API1 (BOLA), OWASP API5 (BFLA), ASVS V8 |
| DAST-H Giới hạn tần suất (429 + Retry-After) và Idempotency-Key | **PASS** | SEC-WEB-012, BE-REL-006, BE-API-008, ARC-INT-001, ASVS V2 |

## DAST-A — Header bảo mật mọi trang/route chính: PASS

Tham chiếu: PRF-WEB-007, SEC-WEB-006, SEC-WEB-014

| Kiểm tra | Kết quả | Bằng chứng (rút gọn, đã che bí mật) |
|---|---|---|
| HTML / | PASS | GET / → 200 [content-security-policy: default-src 'self'; script-src 'self' '<đã-che>' 'strict-dynamic'; style-src 'self' '<đã-c…; x-frame-options: DENY; x-content-type-options: nosniff; referrer-policy: strict-origin-when-cross-origin; permissions-policy: camera=(self), geolocation=(self), microphone=(), payment=(), usb=()] |
| HTML /dich-vu | PASS | GET /dich-vu → 200 [content-security-policy: default-src 'self'; script-src 'self' '<đã-che>' 'strict-dynamic'; style-src 'self' '<đã-c…; x-frame-options: DENY; x-content-type-options: nosniff; referrer-policy: strict-origin-when-cross-origin; permissions-policy: camera=(self), geolocation=(self), microphone=(), payment=(), usb=()] |
| HTML /lien-he | PASS | GET /lien-he → 200 [content-security-policy: default-src 'self'; script-src 'self' '<đã-che>' 'strict-dynamic'; style-src 'self' '<đã-c…; x-frame-options: DENY; x-content-type-options: nosniff; referrer-policy: strict-origin-when-cross-origin; permissions-policy: camera=(self), geolocation=(self), microphone=(), payment=(), usb=()] |
| HTML /gioi-thieu | PASS | GET /gioi-thieu → 200 [content-security-policy: default-src 'self'; script-src 'self' '<đã-che>' 'strict-dynamic'; style-src 'self' '<đã-c…; x-frame-options: DENY; x-content-type-options: nosniff; referrer-policy: strict-origin-when-cross-origin; permissions-policy: camera=(self), geolocation=(self), microphone=(), payment=(), usb=()] |
| HTML /tin-tuc | PASS | GET /tin-tuc → 200 [content-security-policy: default-src 'self'; script-src 'self' '<đã-che>' 'strict-dynamic'; style-src 'self' '<đã-c…; x-frame-options: DENY; x-content-type-options: nosniff; referrer-policy: strict-origin-when-cross-origin; permissions-policy: camera=(self), geolocation=(self), microphone=(), payment=(), usb=()] |
| HTML /dich-vu/tu-van-thiet-ke | PASS | GET /dich-vu/tu-van-thiet-ke → 200 [content-security-policy: default-src 'self'; script-src 'self' '<đã-che>' 'strict-dynamic'; style-src 'self' '<đã-c…; x-frame-options: DENY; x-content-type-options: nosniff; referrer-policy: strict-origin-when-cross-origin; permissions-policy: camera=(self), geolocation=(self), microphone=(), payment=(), usb=()] |
| HTML /dich-vu/dast-markdown-doc | PASS | GET /dich-vu/dast-markdown-doc → 200 [content-security-policy: default-src 'self'; script-src 'self' '<đã-che>' 'strict-dynamic'; style-src 'self' '<đã-c…; x-frame-options: DENY; x-content-type-options: nosniff; referrer-policy: strict-origin-when-cross-origin; permissions-policy: camera=(self), geolocation=(self), microphone=(), payment=(), usb=()] |
| HTML /chinh-sach-du-lieu | PASS | GET /chinh-sach-du-lieu → 200 [content-security-policy: default-src 'self'; script-src 'self' '<đã-che>' 'strict-dynamic'; style-src 'self' '<đã-c…; x-frame-options: DENY; x-content-type-options: nosniff; referrer-policy: strict-origin-when-cross-origin; permissions-policy: camera=(self), geolocation=(self), microphone=(), payment=(), usb=()] |
| HTML /khong-co-trang-nay | PASS | GET /khong-co-trang-nay → 404 [content-security-policy: default-src 'self'; script-src 'self' '<đã-che>' 'strict-dynamic'; style-src 'self' '<đã-c…; x-frame-options: DENY; x-content-type-options: nosniff; referrer-policy: strict-origin-when-cross-origin; permissions-policy: camera=(self), geolocation=(self), microphone=(), payment=(), usb=()] <!DOCTYPE html><html id="__next_error__"><head><meta charSet="utf-8"/><meta name="viewport" content=… |
| HTML /app/login | PASS | GET /app/login → 200 [content-security-policy: default-src 'self'; script-src 'self' '<đã-che>' 'strict-dynamic'; style-src 'self' '<đã-c…; x-frame-options: DENY; x-content-type-options: nosniff; referrer-policy: strict-origin-when-cross-origin; permissions-policy: camera=(self), geolocation=(self), microphone=(), payment=(), usb=()] |
| nonce CSP đổi mỗi request | PASS | 10/10 nonce khác nhau |
| HTML nội bộ /app/today | PASS | GET /app/today (đã đăng nhập) → 200 [content-security-policy: default-src 'self'; script-src 'self' '<đã-che>' 'strict-dynamic'; style-src 'self' '<đã-c…; x-frame-options: DENY; x-content-type-options: nosniff; referrer-policy: strict-origin-when-cross-origin; permissions-policy: camera=(self), geolocation=(self), microphone=(), payment=(), usb=(); cache-control: private, no-store] |
| HTML nội bộ /app/tasks | PASS | GET /app/tasks (đã đăng nhập) → 200 [content-security-policy: default-src 'self'; script-src 'self' '<đã-che>' 'strict-dynamic'; style-src 'self' '<đã-c…; x-frame-options: DENY; x-content-type-options: nosniff; referrer-policy: strict-origin-when-cross-origin; permissions-policy: camera=(self), geolocation=(self), microphone=(), payment=(), usb=(); cache-control: private, no-store] |
| HTML nội bộ /app/attendance | PASS | GET /app/attendance (đã đăng nhập) → 200 [content-security-policy: default-src 'self'; script-src 'self' '<đã-che>' 'strict-dynamic'; style-src 'self' '<đã-c…; x-frame-options: DENY; x-content-type-options: nosniff; referrer-policy: strict-origin-when-cross-origin; permissions-policy: camera=(self), geolocation=(self), microphone=(), payment=(), usb=(); cache-control: private, no-store] |
| HTML nội bộ /app/approvals | PASS | GET /app/approvals (đã đăng nhập) → 200 [content-security-policy: default-src 'self'; script-src 'self' '<đã-che>' 'strict-dynamic'; style-src 'self' '<đã-c…; x-frame-options: DENY; x-content-type-options: nosniff; referrer-policy: strict-origin-when-cross-origin; permissions-policy: camera=(self), geolocation=(self), microphone=(), payment=(), usb=(); cache-control: private, no-store] |
| HTML nội bộ /app/dashboard | PASS | GET /app/dashboard (đã đăng nhập) → 200 [content-security-policy: default-src 'self'; script-src 'self' '<đã-che>' 'strict-dynamic'; style-src 'self' '<đã-c…; x-frame-options: DENY; x-content-type-options: nosniff; referrer-policy: strict-origin-when-cross-origin; permissions-policy: camera=(self), geolocation=(self), microphone=(), payment=(), usb=(); cache-control: private, no-store] |
| HTML nội bộ /app/me | PASS | GET /app/me (đã đăng nhập) → 200 [content-security-policy: default-src 'self'; script-src 'self' '<đã-che>' 'strict-dynamic'; style-src 'self' '<đã-c…; x-frame-options: DENY; x-content-type-options: nosniff; referrer-policy: strict-origin-when-cross-origin; permissions-policy: camera=(self), geolocation=(self), microphone=(), payment=(), usb=(); cache-control: private, no-store] |
| redirect chưa đăng nhập vẫn không cache | PASS | GET /app/today (không phiên) → 307 [location: /app/login; cache-control: private, no-store] |
| API /api/healthz | PASS | GET /api/healthz → 200 [content-type: application/json; charset=utf-8; x-content-type-options: nosniff; cache-control: no-store] |
| API /api/readyz | PASS | GET /api/readyz → 200 [content-type: application/json; charset=utf-8; x-content-type-options: nosniff; cache-control: no-store] |
| API /api/app/me | PASS | GET /api/app/me → 200 [content-type: application/json; charset=utf-8; x-content-type-options: nosniff; cache-control: no-store] |
| API /api/app/tasks | PASS | GET /api/app/tasks → 200 [content-type: application/json; charset=utf-8; x-content-type-options: nosniff; cache-control: no-store] |
| HTTPS: / có HSTS + CSP + còn lại | PASS | GET / (APP_ORIGIN https) → 200 [content-security-policy: default-src 'self'; script-src 'self' '<đã-che>' 'strict-dynamic'; style-src 'self' '<đã-c…; x-frame-options: DENY; x-content-type-options: nosniff; referrer-policy: strict-origin-when-cross-origin; permissions-policy: camera=(self), geolocation=(self), microphone=(), payment=(), usb=(); strict-transport-security: max-age=31536000; includeSubDomains] |
| HTTPS: /app/login có HSTS | PASS | GET /app/login (APP_ORIGIN https) → 200 [content-security-policy: default-src 'self'; script-src 'self' '<đã-che>' 'strict-dynamic'; style-src 'self' '<đã-c…; x-frame-options: DENY; x-content-type-options: nosniff; referrer-policy: strict-origin-when-cross-origin; permissions-policy: camera=(self), geolocation=(self), microphone=(), payment=(), usb=(); strict-transport-security: max-age=31536000; includeSubDomains] |
| HTTPS: API có HSTS | PASS | GET /api/app/me (APP_ORIGIN https) → 200 [strict-transport-security: max-age=31536000; includeSubDomains; x-content-type-options: nosniff] |
| TRACE bị từ chối | PASS | TRACE / → 500 Internal Server Error |

## DAST-B — Cookie phiên (HttpOnly/SameSite/Secure/__Host-/vòng đời): PASS

Tham chiếu: SEC-WEB-023, SEC-WEB-007, ASVS V7

| Kiểm tra | Kết quả | Bằng chứng (rút gọn, đã che bí mật) |
|---|---|---|
| HTTP: cookie phiên HttpOnly + SameSite + Path + hạn | PASS | Set-Cookie: xc_session=<đã-che>; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800 |
| HTTPS: cookie phiên Secure + __Host- + HttpOnly + SameSite | PASS | Set-Cookie: __Host-xc_session=<đã-che>; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure |
| CSRF token không trùng giá trị cookie phiên (không lộ phiên cho script) | PASS | csrf_token ≠ cookie phiên |
| đăng nhập sai: không cookie, cùng thông điệp cho email lạ và sai mật khẩu | PASS | POST /api/app/auth/login (sai) → 401 {"type":"/problems/invalid-credentials","title":"Chưa đăng nhập","status":401,"detail":"Email hoặc m… |
| fixation: token phiên mới do server cấp, khác cookie đã gài | PASS | POST login kèm cookie gài sẵn → 200 |
| mỗi lần đăng nhập một token phiên mới | PASS | 2 đăng nhập liên tiếp → 2 token khác nhau |
| cookie bị sửa 1 ký tự → 401 | PASS | GET /api/app/me (cookie sửa) → 401 {"type":"/problems/unauthenticated","title":"Chưa đăng nhập","status":401,"detail":"Vui lòng đăng nh… |
| cookie mã hoá sai → 401 (không 500) | PASS | GET /api/app/me (cookie %E0%A4%A) → 401 {"type":"/problems/unauthenticated","title":"Chưa đăng nhập","status":401,"detail":"Vui lòng đăng nh… |
| đăng xuất xoá cookie + Clear-Site-Data | PASS | POST /api/app/auth/logout → 200 [clear-site-data: "cache", "storage"] set-cookie: xc_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0 |
| token cũ bị từ chối sau đăng xuất (phiên bị huỷ ở server) | PASS | GET /api/app/me (token đã đăng xuất) → 401 {"type":"/problems/unauthenticated","title":"Chưa đăng nhập","status":401,"detail":"Vui lòng đăng nh… |

## DAST-C — XSS phản chiếu & lưu (HTML + Chromium thật): PASS

Tham chiếu: SEC-WEB-004, FE-SEC-001, ASVS V1/V3, Top10:2025 A05

| Kiểm tra | Kết quả | Bằng chứng (rút gọn, đã che bí mật) |
|---|---|---|
| phản chiếu /lien-he?service={payload}&source={payload}&q={payload} × 10 payload | PASS | GET /lien-he?service=<payload>&source=<payload>&q=<payload> → 200; 10 payload (script, img/onerror, javascript:, svg, template, markdown, </title>, mXSS, RLO) — HTML không có phần tử/thuộc tính bị chèn |
| phản chiếu /?q={payload}&utm_source={payload} × 10 payload | PASS | GET /?q=<payload>&utm_source=<payload> → 200; 10 payload (script, img/onerror, javascript:, svg, template, markdown, </title>, mXSS, RLO) — HTML không có phần tử/thuộc tính bị chèn |
| phản chiếu /app/login?next={payload}&error={payload}&email={payload} × 10 payload | PASS | GET /app/login?next=<payload>&error=<payload>&email=<payload> → 200; 10 payload (script, img/onerror, javascript:, svg, template, markdown, </title>, mXSS, RLO) — HTML không có phần tử/thuộc tính bị chèn |
| phản chiếu /tim-kiem?q={payload} × 10 payload | PASS | GET /tim-kiem?q=<payload> → 404 <!DOCTYPE html><html id="__next_error__"><head><meta charSet="utf-8"/><meta name="viewport" content=…; 10 payload (script, img/onerror, javascript:, svg, template, markdown, </title>, mXSS, RLO) — HTML không có phần tử/thuộc tính bị chèn |
| phản chiếu /dich-vu/{payload} × 10 payload | PASS | GET /dich-vu/<payload> → 404 <!DOCTYPE html><html id="__next_error__"><head><meta charSet="utf-8"/><meta name="viewport" content=…; 10 payload (script, img/onerror, javascript:, svg, template, markdown, </title>, mXSS, RLO) — HTML không có phần tử/thuộc tính bị chèn |
| phản chiếu /{payload} × 10 payload | PASS | GET /<payload> → 404 <!DOCTYPE html><html id="__next_error__"><head><meta charSet="utf-8"/><meta name="viewport" content=…; 10 payload (script, img/onerror, javascript:, svg, template, markdown, </title>, mXSS, RLO) — HTML không có phần tử/thuộc tính bị chèn |
| phản chiếu trong lỗi API chỉ ở dạng JSON (không HTML) | PASS | GET /api/app/tasks?limit=<payload> × 10 → application/problem+json |
| tiền điều kiện: trang CMS độc đã xuất bản và có nội dung render | PASS | GET /dich-vu/dast-markdown-doc → 200 — thân 17151 B |
| CMS markdown độc (script/img/svg/iframe/javascript:/data:/entity/tab/autolink/bảng/code) + tiêu đề/tóm tắt/SEO/canonical | PASS | GET /dich-vu/dast-markdown-doc → HTML không chứa phần tử/thuộc tính/URL nguy hiểm |
| danh sách /dich-vu (tiêu đề + tóm tắt độc) | PASS | GET /dich-vu → 200 |
| sitemap.xml an toàn (XML, không HTML chèn) | PASS | GET /sitemap.xml → 200 [content-type: application/xml] |
| gửi 10 payload qua form liên hệ + ứng tuyển công khai (chấp nhận hoặc từ chối có cấu trúc, không 5xx) | PASS | POST /api/public/inquiries\|applications × 10; mỗi request một IP giả riêng |
| đọc lại liên hệ đã lưu (sales): JSON đúng kiểu, nosniff, dữ liệu giữ nguyên dạng văn bản | PASS | GET /api/app/inquiries → 200 [content-type: application/json; charset=utf-8; x-content-type-options: nosniff] — 10 bản ghi payload |
| đọc lại hồ sơ ứng tuyển đã lưu (hr): JSON đúng kiểu + nosniff | PASS | GET /api/app/applications → 200 [content-type: application/json; charset=utf-8; x-content-type-options: nosniff] |
| bình luận 10 payload: lưu được, đọc lại ở JSON | PASS | GET /api/app/comments?object_type=task → 200 [content-type: application/json; charset=utf-8] |
| tệp: tên độc lưu an toàn, tải về attachment+nosniff; svg/html/đuôi kép/nội dung giả bị 415 | PASS | POST /api/app/files (tên chứa <img onerror>) → 201; svg/html/.pdf.html/.html.pdf/nội dung script → 415 |
| công cụ đo: payload canary CHẠY được trong Chromium thì probe bắt được | PASS | canary onerror → 1 lần báo |
| DOM thật: CMS markdown độc (công khai) | PASS | Chromium mở /dich-vu/dast-markdown-doc → 200; 0 dialog, 0 lần gán __dastHit, 0 [data-mk]; đã bấm 0 liên kết trong nội dung |
| DOM thật: danh sách dịch vụ (tiêu đề/tóm tắt độc) | PASS | Chromium mở /dich-vu → 200; 0 dialog, 0 lần gán __dastHit, 0 [data-mk]; đã bấm 2 liên kết trong nội dung |
| DOM thật: phản chiếu query ở /lien-he | PASS | Chromium mở /lien-he?… → 200; 0 dialog, 0 lần gán __dastHit, 0 [data-mk]; đã bấm 1 liên kết trong nội dung |
| DOM thật: 404 phản chiếu đường dẫn | PASS | Chromium mở /dich-vu/%22%3E%3Cimg%20data-mk%3D%22MK-… → 404; 0 dialog, 0 lần gán __dastHit, 0 [data-mk]; đã bấm 1 liên kết trong nội dung |
| DOM thật: phản chiếu ở /app/login | PASS | Chromium mở /app/login?… → 200; 0 dialog, 0 lần gán __dastHit, 0 [data-mk]; đã bấm 0 liên kết trong nội dung |
| DOM thật: việc của nv (tiêu đề + tiêu chí độc từ seed) | PASS | Chromium mở /app/tasks → 200; 0 dialog, 0 lần gán __dastHit, 0 [data-mk]; đã bấm 0 liên kết trong nội dung |
| DOM thật: hôm nay (nv) | PASS | Chromium mở /app/today → 200; 0 dialog, 0 lần gán __dastHit, 0 [data-mk]; đã bấm 2 liên kết trong nội dung |
| DOM thật: hồ sơ (nv) | PASS | Chromium mở /app/me → 200; 0 dialog, 0 lần gán __dastHit, 0 [data-mk]; đã bấm 0 liên kết trong nội dung |
| DOM thật: chấm công (nv) | PASS | Chromium mở /app/attendance → 200; 0 dialog, 0 lần gán __dastHit, 0 [data-mk]; đã bấm 0 liên kết trong nội dung |
| DOM thật: hộp duyệt (tl) — lý do OT do nv nhập | PASS | Chromium mở /app/approvals → 200; 0 dialog, 0 lần gán __dastHit, 0 [data-mk]; đã bấm 0 liên kết trong nội dung |
| DOM thật: bảng điều hành (exec) | PASS | Chromium mở /app/dashboard → 200; 0 dialog, 0 lần gán __dastHit, 0 [data-mk]; đã bấm 0 liên kết trong nội dung |

## DAST-D — CSRF (token + Origin) và CORS: PASS

Tham chiếu: SEC-WEB-007, SEC-WEB-013, ASVS V3

| Kiểm tra | Kết quả | Bằng chứng (rút gọn, đã che bí mật) |
|---|---|---|
| POST ghi: thiếu x-csrf-token → 403 CSRF | PASS | POST /api/app/comments → 403 {"type":"/problems/csrf","title":"Không có quyền","status":403,"detail":"Thiếu hoặc sai mã CSRF","in… |
| POST ghi: x-csrf-token sai → 403 CSRF | PASS | POST /api/app/comments → 403 {"type":"/problems/csrf","title":"Không có quyền","status":403,"detail":"Thiếu hoặc sai mã CSRF","in… |
| POST ghi: x-csrf-token của người khác (nv2) với cookie của nv → 403 CSRF | PASS | POST /api/app/comments → 403 {"type":"/problems/csrf","title":"Không có quyền","status":403,"detail":"Thiếu hoặc sai mã CSRF","in… |
| POST ghi: Origin lạ + token đúng → 403 CSRF | PASS | POST /api/app/comments → 403 {"type":"/problems/csrf","title":"Không có quyền","status":403,"detail":"Yêu cầu không cùng nguồn","… |
| POST ghi: không Origin, không Sec-Fetch-Site + token đúng → 403 CSRF | PASS | POST /api/app/comments → 403 {"type":"/problems/csrf","title":"Không có quyền","status":403,"detail":"Yêu cầu không cùng nguồn","… |
| POST ghi: Sec-Fetch-Site: cross-site, không Origin → 403 CSRF | PASS | POST /api/app/comments → 403 {"type":"/problems/csrf","title":"Không có quyền","status":403,"detail":"Yêu cầu không cùng nguồn","… |
| POST ghi: Origin: null (iframe sandbox) + token đúng → 403 CSRF | PASS | POST /api/app/comments → 403 {"type":"/problems/csrf","title":"Không có quyền","status":403,"detail":"Yêu cầu không cùng nguồn","… |
| POST ghi: Origin giả hậu tố (host hợp lệ + .evil.test) → 403 CSRF | PASS | POST /api/app/comments → 403 {"type":"/problems/csrf","title":"Không có quyền","status":403,"detail":"Yêu cầu không cùng nguồn","… |
| POST ghi: form chéo nguồn (text/plain, không token) → 403 CSRF | PASS | POST /api/app/comments → 403 {"type":"/problems/csrf","title":"Không có quyền","status":403,"detail":"Yêu cầu không cùng nguồn","… |
| đối chứng: cùng request hợp lệ (Origin + token đúng) → 201 (probe không đỏ/xanh vô nghĩa) | PASS | POST /api/app/comments (hợp lệ) → 201 |
| login CSRF: đăng nhập từ Origin lạ → 403 và không cookie | PASS | POST /api/app/auth/login (Origin lạ, mật khẩu đúng) → 403 {"type":"/problems/csrf","title":"Không có quyền","status":403,"detail":"Yêu cầu không cùng nguồn","… |
| logout CSRF: Origin lạ → 403 và phiên còn nguyên | PASS | POST /api/app/auth/logout (Origin lạ) → 403 {"type":"/problems/csrf","title":"Không có quyền","status":403,"detail":"Yêu cầu không cùng nguồn","… |
| GET không đổi trạng thái: GET /api/app/auth/logout → 405 | PASS | GET /api/app/auth/logout → 405 |
| CORS /api/app/me: preflight và GET với Origin lạ không được cấp quyền | PASS | OPTIONS /api/app/me (Origin lạ) → 204 \| GET → 200, ACAO: (không có) |
| CORS /api/public/inquiries: preflight và GET với Origin lạ không được cấp quyền | PASS | OPTIONS /api/public/inquiries (Origin lạ) → 204 \| GET → 405, ACAO: (không có) |
| CORS /api/app/tasks: preflight và GET với Origin lạ không được cấp quyền | PASS | OPTIONS /api/app/tasks (Origin lạ) → 204 \| GET → 200, ACAO: (không có) |
| CORS /api/readyz: preflight và GET với Origin lạ không được cấp quyền | PASS | OPTIONS /api/readyz (Origin lạ) → 204 \| GET → 200, ACAO: (không có) |

## DAST-E — Open redirect (next/redirect/returnTo…, đường dẫn dị dạng, Host): PASS

Tham chiếu: SEC-WEB-017, ASVS V3

| Kiểm tra | Kết quả | Bằng chứng (rút gọn, đã che bí mật) |
|---|---|---|
| /app/login với 9 tên tham số × 5 đích lạ (chưa đăng nhập) | PASS | GET /app/login?next=https://evil.test → 200; 90 request, không Location nào ra ngoài nguồn |
| /app/login với 9 tên tham số × 5 đích lạ (đã đăng nhập) | PASS | GET /app/login?next=https://evil.test → 307 [location: /app/today]; 90 request, không Location nào ra ngoài nguồn |
| đường dẫn dị dạng (// \\ %2F, thừa dấu /) × 12: chuẩn hoá/chuyển hướng không ra ngoài | PASS | GET //evil.test → 308 [location: /evil.test]; 12 đường dẫn |
| Host header lạ: chuyển hướng chưa đăng nhập không bị đầu độc bằng Host | PASS | GET /app/today (Host: evil.test) → 307 [location: /app/login] |
| X-Forwarded-Host lạ không đầu độc chuyển hướng | PASS | GET /app/today (X-Forwarded-Host: evil.test) → 307 [location: /app/login] |

## DAST-F — Rò thông tin lỗi (stack/SQL/đường dẫn; RFC 9457): PASS

Tham chiếu: BASE-ERR-003, SEC-WEB-002, SEC-WEB-014, ASVS V16

| Kiểm tra | Kết quả | Bằng chứng (rút gọn, đã che bí mật) |
|---|---|---|
| API: JSON hỏng | PASS | POST /api/app/comments → 400 [content-type: application/problem+json; charset=utf-8] {"type":"/problems/bad-json","title":"Yêu cầu không hợp lệ","status":400,"detail":"JSON không hợp lệ… |
| API: thiếu trường / sai kiểu | PASS | POST /api/app/comments → 400 [content-type: application/problem+json; charset=utf-8] {"type":"/problems/validation","title":"Yêu cầu không hợp lệ","status":400,"detail":"Dữ liệu gửi lên… |
| API: body vượt trần (Content-Length) | PASS | POST /api/app/comments → 413 [content-type: application/problem+json; charset=utf-8] {"type":"/problems/payload-too-large","title":"Dữ liệu quá lớn","status":413,"detail":"Dữ liệu quá l… |
| API: limit=abc | PASS | GET /api/app/tasks?limit=abc → 400 [content-type: application/problem+json; charset=utf-8] {"type":"/problems/validation","title":"Yêu cầu không hợp lệ","status":400,"detail":"limit phải là s… |
| API: limit nghịch (SQL-ish) | PASS | GET /api/app/tasks?limit=1'%20OR%20'1'%3D'1 → 400 [content-type: application/problem+json; charset=utf-8] {"type":"/problems/validation","title":"Yêu cầu không hợp lệ","status":400,"detail":"limit phải là s… |
| API: offset âm | PASS | GET /api/app/tasks?offset=-1 → 400 [content-type: application/problem+json; charset=utf-8] {"type":"/problems/validation","title":"Yêu cầu không hợp lệ","status":400,"detail":"offset phải là … |
| API: limit vượt trần | PASS | GET /api/app/tasks?limit=1000000 → 400 [content-type: application/problem+json; charset=utf-8] {"type":"/problems/validation","title":"Yêu cầu không hợp lệ","status":400,"detail":"limit phải là s… |
| API: id không phải UUID | PASS | GET /api/app/files/not-a-uuid → 404 [content-type: application/problem+json; charset=utf-8] {"type":"/problems/not-found","title":"Không tìm thấy","status":404,"detail":"Không tìm thấy tệp","i… |
| API: UUID không tồn tại | PASS | GET /api/app/files/7918347c-9f53-4b61-a287-be1526c5fdb8 → 404 [content-type: application/problem+json; charset=utf-8] {"type":"/problems/not-found","title":"Không tìm thấy","status":404,"detail":"Không tìm thấy tệp","i… |
| API: id kiểu SQL injection | PASS | GET /api/app/files/'%3B%20DROP%20TABLE%20app_user%3B-- → 404 [content-type: application/problem+json; charset=utf-8] {"type":"/problems/not-found","title":"Không tìm thấy","status":404,"detail":"Không tìm thấy tệp","i… |
| API: hành động việc không tồn tại | PASS | POST /api/app/tasks/d3dd419d-ba8b-4af8-a25b-bee9c19175b1/hack → 404 [content-type: application/problem+json; charset=utf-8] {"type":"/problems/not-found","title":"Không tìm thấy","status":404,"detail":"Không tìm thấy","insta… |
| API: chưa đăng nhập | PASS | GET /api/app/me → 401 [content-type: application/problem+json; charset=utf-8] {"type":"/problems/unauthenticated","title":"Chưa đăng nhập","status":401,"detail":"Vui lòng đăng nh… |
| API: cookie hỏng | PASS | GET /api/app/me → 401 [content-type: application/problem+json; charset=utf-8] {"type":"/problems/unauthenticated","title":"Chưa đăng nhập","status":401,"detail":"Vui lòng đăng nh… |
| API: phương thức không hỗ trợ (DELETE /api/app/me) | PASS | DELETE /api/app/me → 405 |
| API công khai: dữ liệu sai kiểu | PASS | POST /api/public/inquiries → 400 [content-type: application/problem+json; charset=utf-8] {"type":"/problems/validation","title":"Yêu cầu không hợp lệ","status":400,"detail":"Dữ liệu gửi lên… |
| API công khai: JSON hỏng | PASS | POST /api/public/inquiries → 400 [content-type: application/problem+json; charset=utf-8] {"type":"/problems/bad-json","title":"Yêu cầu không hợp lệ","status":400,"detail":"JSON không hợp lệ… |
| API công khai: body rất lớn | PASS | POST /api/public/inquiries → 413 [content-type: application/problem+json; charset=utf-8] {"type":"/problems/payload-too-large","title":"Dữ liệu quá lớn","status":413,"detail":"Dữ liệu quá l… |
| API: route không tồn tại | PASS | GET /api/app/khong-co → 404 [content-type: text/html; charset=utf-8] <!DOCTYPE html><html id="__next_error__"><head><meta charSet="utf-8"/><meta name="viewport" content=… |
| API: đăng nhập thiếu trường | PASS | POST /api/app/auth/login → 400 [content-type: application/problem+json; charset=utf-8] {"type":"/problems/validation","title":"Yêu cầu không hợp lệ","status":400,"detail":"Dữ liệu gửi lên… |
| web: trang 404 | PASS | GET /khong-co-trang-nay → 404 <!DOCTYPE html><html id="__next_error__"><head><meta charSet="utf-8"/><meta name="viewport" content=… |
| web: 404 với đường dẫn rất dài (6 000 ký tự) | PASS | GET /dich-vu/<đã-che> → 404 <!DOCTYPE html><html id="__next_error__"><head><meta charSet="utf-8"/><meta name="viewport" content=… |
| web: slug SQL injection | PASS | GET /dich-vu/'%20OR%201%3D1-- → 404 <!DOCTYPE html><html id="__next_error__"><head><meta charSet="utf-8"/><meta name="viewport" content=… |
| web: percent-encoding hỏng | PASS | GET /%E0%A4%A → 404 <!DOCTYPE html><html id="__next_error__"><head><meta charSet="utf-8"/><meta name="viewport" content=… |
| web: byte NUL | PASS | GET /%00 → 404 <!DOCTYPE html><html id="__next_error__"><head><meta charSet="utf-8"/><meta name="viewport" content=… |
| web: traversal thô | PASS | GET /dich-vu/..%2f..%2f..%2fetc%2fpasswd → 404 <!DOCTYPE html><html id="__next_error__"><head><meta charSet="utf-8"/><meta name="viewport" content=… |
| web: /app/<không có> | PASS | GET /app/khong-co-trang → 404 <!DOCTYPE html><html id="__next_error__"><head><meta charSet="utf-8"/><meta name="viewport" content=… |
| readyz chỉ trả trạng thái ngắn (không chuỗi kết nối/phiên bản) | PASS | GET /api/readyz → 200 |
| quét toàn phiên: mọi phản hồi lỗi/JSON không lộ stack/SQL/đường dẫn | PASS | 353 phản hồi (4xx/5xx/JSON) trong 630 request của cả phiên quét, không khớp mẫu rò |

## DAST-G — Đường dẫn nhạy cảm không được phục vụ (.env, .git, source map, metrics, uploads): PASS

Tham chiếu: PRF-WEB-008, SEC-WEB-014, SEC-WEB-019, OPS-OBS-003, ASVS V13

| Kiểm tra | Kết quả | Bằng chứng (rút gọn, đã che bí mật) |
|---|---|---|
| 38 đường dẫn nhạy cảm/mã nguồn/thư mục/debug không được phục vụ | PASS | GET × 38 (.env, .git, package.json, mã nguồn, migrations, seed, báo cáo, .next, uploads, debug…) → 404/401/403, không dấu hiệu bí mật |
| path traversal thô × 9 (.. %2e %2f %5c ;.. NUL) | PASS | GET × 9, đường dẫn gửi nguyên văn không chuẩn hoá phía khách |
| source map: 9 chunk JS không có sourceMappingURL và *.map trả 404 | PASS | GET /_next/static/chunks/1-nqmp1rl8kqt.js.map → 404 (… 9 chunk) |
| /api/metrics cần bearer (không token/sai/query-string → 401; đúng → 200 không PII) | PASS | GET /api/metrics (không token) → 401 Unauthorized \| sai → 401 \| ?token= → 401 \| đúng → 200 |
| /api/metrics khi METRICS_TOKEN chưa đặt → 404 (như không tồn tại) | PASS | GET /api/metrics (instance không đặt token) → 404 Not Found |
| /_next/image không nạp URL tuỳ ý (SSRF qua bộ tối ưu ảnh) | PASS | GET /_next/image?url=<nội bộ\|ngoài\|metadata\|file> → 4xx |
| tải tệp chưa đăng nhập → 401 | PASS | GET /api/app/files/<uuid> (không phiên) → 401 |
| sitemap/robots: không lộ bản nháp, /app bị chặn bot | PASS | GET /robots.txt → 200 User-Agent: * Allow: / Disallow: /app Disallow: /api Sitemap:… |

## DAST-I — IDOR/BOLA và BFLA giữa các người dùng seed trên /api/app/*: PASS

Tham chiếu: STD-SEC-004, OWASP API1 (BOLA), OWASP API5 (BFLA), ASVS V8

| Kiểm tra | Kết quả | Bằng chứng (rút gọn, đã che bí mật) |
|---|---|---|
| tiền điều kiện: nv sở hữu việc, tệp và bình luận | PASS | việc d3dd419d…, tệp 949c020a…, bình luận → 201 |
| đối chứng: chủ việc đọc được bình luận của mình | PASS | GET /api/app/comments (nv) → 200 |
| BOLA: nv2 tải tệp của nv | PASS | GET /api/app/files/949c020a-e1df-4d1d-a140-3eb1a488d071 → 404 {"type":"/problems/not-found","title":"Không tìm thấy","status":404,"detail":"Không tìm thấy đối tượ… |
| BOLA: nv2 đọc bình luận của việc nv | PASS | GET /api/app/comments?object_type=task&object_id=d3dd419d-ba8b-4… → 404 {"type":"/problems/not-found","title":"Không tìm thấy","status":404,"detail":"Không tìm thấy đối tượ… |
| BOLA: nv2 bình luận lên việc của nv | PASS | POST /api/app/comments → 404 {"type":"/problems/not-found","title":"Không tìm thấy","status":404,"detail":"Không tìm thấy đối tượ… |
| BOLA: nv2 đính kèm tệp vào việc của nv | PASS | POST /api/app/files → 404 {"type":"/problems/not-found","title":"Không tìm thấy","status":404,"detail":"Không tìm thấy đối tượ… |
| BOLA: nv2 start việc của nv | PASS | POST /api/app/tasks/d3dd419d-ba8b-4af8-a25b-bee9c19175b1/start → 404 {"type":"/problems/not-found","title":"Không tìm thấy","status":404,"detail":"Không tìm thấy công vi… |
| BOLA: nv2 submit việc của nv | PASS | POST /api/app/tasks/d3dd419d-ba8b-4af8-a25b-bee9c19175b1/submit → 404 {"type":"/problems/not-found","title":"Không tìm thấy","status":404,"detail":"Không tìm thấy công vi… |
| BOLA: nv2 accept việc của nv | PASS | POST /api/app/tasks/d3dd419d-ba8b-4af8-a25b-bee9c19175b1/accept → 404 {"type":"/problems/not-found","title":"Không tìm thấy","status":404,"detail":"Không tìm thấy công vi… |
| BOLA: nv2 cancel việc của nv | PASS | POST /api/app/tasks/d3dd419d-ba8b-4af8-a25b-bee9c19175b1/cancel → 404 {"type":"/problems/not-found","title":"Không tìm thấy","status":404,"detail":"Không tìm thấy công vi… |
| BOLA: danh sách việc của nv2 không chứa việc của nv | PASS | GET /api/app/tasks (nv2) → 0 mục, không có d3dd419d… |
| BOLA: tham số/header user_id không đổi danh tính (mass assignment danh tính) | PASS | GET /api/app/me?user_id=<nv> (phiên nv2) → user_id của nv2 |
| tenant: người dùng công ty khác tải tệp | PASS | GET /api/app/files/949c020a-e1df-4d1d-a140-3eb1a488d071 → 404 {"type":"/problems/not-found","title":"Không tìm thấy","status":404,"detail":"Không tìm thấy tệp","i… |
| tenant: đọc bình luận việc công ty khác | PASS | GET /api/app/comments?object_type=task&object_id=d3dd419d-ba8b-4… → 404 {"type":"/problems/not-found","title":"Không tìm thấy","status":404,"detail":"Không tìm thấy đối tượ… |
| tenant: đổi trạng thái việc công ty khác | PASS | POST /api/app/tasks/d3dd419d-ba8b-4af8-a25b-bee9c19175b1/start → 404 {"type":"/problems/not-found","title":"Không tìm thấy","status":404,"detail":"Không tìm thấy công vi… |
| BFLA/BOLA: nv2 (đồng cấp) duyệt đơn OT của nv → bị từ chối | PASS | POST /api/app/approvals/ot/<id>/approve → 403 {"type":"/problems/forbidden","title":"Không có quyền","status":403,"detail":"Bạn không có quyền thự… |
| BFLA/BOLA: nv (tự duyệt đơn của mình) duyệt đơn OT của nv → bị từ chối | PASS | POST /api/app/approvals/ot/<id>/approve → 403 {"type":"/problems/forbidden","title":"Không có quyền","status":403,"detail":"Bạn không có quyền thự… |
| BFLA: nv (nhân viên) đọc liên hệ khách → bị từ chối | PASS | GET /api/app/inquiries → 403 {"type":"/problems/forbidden","title":"Không có quyền","status":403,"detail":"Bạn không có quyền thự… |
| BFLA: nv đọc hồ sơ ứng tuyển → bị từ chối | PASS | GET /api/app/applications → 403 {"type":"/problems/forbidden","title":"Không có quyền","status":403,"detail":"Bạn không có quyền thự… |
| BFLA: nv đọc yêu cầu DSAR → bị từ chối | PASS | GET /api/app/privacy/requests → 403 {"type":"/problems/forbidden","title":"Không có quyền","status":403,"detail":"Bạn không có quyền thự… |
| BFLA: nv tạo yêu cầu DSAR → bị từ chối | PASS | POST /api/app/privacy/requests → 403 {"type":"/problems/forbidden","title":"Không có quyền","status":403,"detail":"Bạn không có quyền thự… |
| BFLA: sales đọc hồ sơ ứng tuyển (tách quyền ứng viên) → bị từ chối | PASS | GET /api/app/applications → 403 {"type":"/problems/forbidden","title":"Không có quyền","status":403,"detail":"Bạn không có quyền thự… |
| BFLA: hr đọc liên hệ khách → bị từ chối | PASS | GET /api/app/inquiries → 403 {"type":"/problems/forbidden","title":"Không có quyền","status":403,"detail":"Bạn không có quyền thự… |
| BFLA: nv hiển thị QR địa điểm → bị từ chối | PASS | GET /api/app/attendance/qr/1d5f5feb-4a52-47b4-a0e0-d9e… → 404 {"type":"/problems/not-found","title":"Không tìm thấy","status":404,"detail":"Không tìm thấy địa điể… |
| không phiên → 401 trên 18 route /api/app/* | PASS | GET×9 + POST×9 không cookie → 401 |

## DAST-H — Giới hạn tần suất (429 + Retry-After) và Idempotency-Key: PASS

Tham chiếu: SEC-WEB-012, BE-REL-006, BE-API-008, ARC-INT-001, ASVS V2

| Kiểm tra | Kết quả | Bằng chứng (rút gọn, đã che bí mật) |
|---|---|---|
| form liên hệ: > 5 lần/10 phút/IP → 429 + Retry-After | PASS | 201,201,201,201,201,429,429,429 ; lần bị chặn → 429 [retry-after: 600] {"type":"/problems/rate-limited","title":"Quá nhiều yêu cầu","status":429,"detail":"Bạn gửi quá nhiề… |
| giới hạn theo IP: IP khác không bị chặn lây | PASS | IP khác → 201 |
| form ứng tuyển: > 5 lần/10 phút/IP → 429 + Retry-After | PASS | 201,201,201,201,201,429,429,429 |
| đăng nhập sai: > 5 lần/15 phút/(email, IP) → 429 + Retry-After | PASS | 401,401,401,401,401,429,429,429 ; lần bị chặn → 429 [retry-after: 900] {"type":"/problems/rate-limited","title":"Quá nhiều yêu cầu","status":429,"detail":"Đăng nhập sai qu… |
| khoá đăng nhập giữ: mật khẩu ĐÚNG từ cùng (email, IP) vẫn 429 | PASS | POST login (đúng mật khẩu, đang bị khoá) → 429 [retry-after: 900] {"type":"/problems/rate-limited","title":"Quá nhiều yêu cầu","status":429,"detail":"Đăng nhập sai qu… |
| khoá theo (email, IP): chủ tài khoản từ IP khác không bị khoá lây | PASS | IP khác → 200 |
| API ghi theo người dùng: > 60/phút → 429 + Retry-After | PASS | 62 request song song; lần bị chặn → 429 [retry-after: 22] {"type":"/problems/rate-limited","title":"Quá nhiều yêu cầu","status":429,"detail":"Bạn thao tác quá… |
| Idempotency-Key: tạo → phát lại nguyên văn; tái dùng khoá khác thân → 422; thiếu khoá → 400; song song cùng khoá → 1 lần chạy thật | PASS | 201 / phát lại 201 (true) / khoá tái dùng 422 / thiếu khoá 400 / song song 409,409,201,409,409,409 |

## Không chứng minh

- Không phải ZAP/Burp: không có spider đầy đủ, không có active-scan theo chữ ký CVE; chỉ các nhóm probe liệt kê ở trên.
- Không có TLS thật: HSTS/Secure/`__Host-` kiểm trên instance chạy `APP_ORIGIN=https://…` (mô phỏng proxy chấm dứt TLS); cấu hình TLS, chứng chỉ, cipher, header của reverse proxy/CDN thật chưa được kiểm.
- Không chạy trên staging/production, không có WAF/CDN/proxy thật; X-Forwarded-For do probe tự đặt (`TRUST_PROXY_HOPS=1`).
- XSS: payload là tập hữu hạn (HTML thô, scheme nguy hiểm, SVG, template, markdown độc, tên tệp) trên các đầu vào hiện có; không chứng minh không còn biến thể nào. DOM kiểm bằng Chromium của Playwright, không phải mọi trình duyệt.
- BOLA/BFLA chỉ giữa các người dùng seed (hai nhân viên cùng công ty; vai trò khác nhau); không kiểm đa-tenant giữa hai công ty ở tầng HTTP (đã có test authz/RLS trong tests/).
- Không kiểm: DoS/tải lớn (xem perf:load), phụ thuộc có lỗ hổng (npm audit/OSV), cấu hình hạ tầng/IaC, bí mật trong lịch sử git (gitleaks), SSRF (chưa có tính năng gọi URL do người dùng cung cấp).
