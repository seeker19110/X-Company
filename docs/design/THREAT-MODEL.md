# THREAT-MODEL — X-Company (STRIDE, G4)

> Phạm vi: web Next.js, PostgreSQL, kho tệp, worker, PWA. Cập nhật 2026-10-18. Rà lại khi thêm tích hợp ngoài.

## Tài sản
Hồ sơ nhân sự, bảng công đã khoá, dữ liệu định vị (nhạy cảm — NĐ 356/2025), hồ sơ ứng viên, tệp nội bộ, phiên đăng
nhập, khoá ký QR/phiên, nhật ký kiểm toán.

## Ranh giới tin cậy
Internet ↔ web (website + API công khai không xác thực) · trình duyệt/PWA ↔ API nội bộ · web ↔ DB/kho tệp · worker ↔ SMTP/push.

| # | STRIDE | Mối đe doạ | Biện pháp | Kiểm |
|---|---|---|---|---|
| T1 | Spoofing | Đoán/nhồi mật khẩu | Argon2id, giới hạn 5 lần/15 phút, TOTP cho vai trò nhạy cảm | test rate limit S-ID-07 |
| T2 | Spoofing | Chấm công hộ / QR chụp lại | QR ký HMAC TTL 60 s, gắn ca + địa điểm, ngoại lệ cần xác minh; không cam kết tuyệt đối | S-AT-09 |
| T3 | Tampering | Sửa công/kỳ khoá trực tiếp | Sự kiện gốc chỉ thêm, adjustment có duyệt, kỳ khoá bất biến, audit chuỗi băm | S-AT-07, S-ID-08 |
| T4 | Tampering | Gửi lặp / phát lại hàng chờ | idempotency_key UNIQUE, so nội dung, khoá lạc quan `version` | S-AT-03/04, S-WK-06 |
| T5 | Repudiation | Chối thao tác duyệt | audit_event ghi actor/lý do/kết quả cùng giao dịch, cả `denied` | test audit |
| T6 | Info disclosure | IDOR công/tệp/xuất ngoài phạm vi | `can()` ở server mọi route + tải tệp qua route kiểm quyền; test "bị cấm" cho từng route ghi/đọc nhạy cảm | S-ID-01..06, S-WK-05 |
| T7 | Info disclosure | Dữ liệu người trước còn trên thiết bị chung | IndexedDB theo user, xoá khi đăng xuất, Clear-Site-Data, chế độ thiết bị dùng chung | S-PWA-02 |
| T8 | Info disclosure | XSS qua CMS/bình luận | Markdown không HTML thô, escape mặc định React, CSP nonce, chặn `javascript:` | S-WEB-06 |
| T9 | Info disclosure | Lộ PII trong log | logger che trường (email, phone, geo, token) | test logger |
| T10 | DoS | Spam form công khai | honeypot, rate limit IP, giới hạn kích thước | S-WEB-04 |
| T11 | Elevation | Tự duyệt / leo thang vai trò | R5 SoD ở lib, grant chỉ `sysadmin` cấp, audit | S-ID-04 |
| T12 | Elevation | Bỏ qua RLS/role DB | role ứng dụng không owner, không BYPASSRLS; migration chạy bằng role riêng | test kiểm `rolbypassrls=false` |
| T13 | CSRF | Thao tác ghi từ site lạ | token CSRF gắn phiên + kiểm Origin, cookie SameSite=Lax | S-ID-09 |

## Rủi ro chấp nhận (cần chủ dự án xác nhận)
- Vị trí GPS có thể giả mạo ở thiết bị (W3C) — chỉ là tín hiệu đối soát.
- Thu hồi quyền không xoá được dữ liệu trên thiết bị đang mất mạng hoàn toàn — giảm dữ liệu cache, kiểm lại khi kết nối (§10).
