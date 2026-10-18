---
title: Chính sách dữ liệu test
updated: 2026-10-18
---

# Chính sách dữ liệu test (QA-DATA-001, QA-DATA-002)

1. **Cấm** dump/export dữ liệu production (hoặc bản sao đã "che sơ sài") trong repo, CI, staging và máy dev. Dữ liệu test do mã sinh (`tests/helpers/fixtures.ts`, `scripts/seed-*.ts`).
2. Không dán dữ liệu thật vào issue, PR, log, ảnh chụp; nghi ngờ có lọt → coi là sự cố ([../ops/INCIDENT-RESPONSE.md](../ops/INCIDENT-RESPONSE.md)).
3. **Email** trong fixture/seed: chỉ domain dành riêng — `example.com`, `example.org`, `example.net`, mọi tên miền kết thúc `.test`, `.example`, `.invalid`, `.localhost` — hoặc dạng `+tag` trên các domain đó.
4. **Số điện thoại** Việt Nam dạng thật (`0[35789]xxxxxxxx`, `+84…`) bị cấm trừ số mẫu ghi dưới đây.
5. Không dùng tên, CCCD, địa chỉ của người thật; dùng chuỗi giả rõ ràng.
6. Tệp `.sql/.csv/.json` > 1 MB hoặc có cột PII (email, phone) ngoài kiểm kê là vi phạm.

Kiểm bằng máy: `npm run -s check:docs` quét `tests/`, `e2e/`, `scripts/` và kích thước/cột của tệp dữ liệu.

## Số mẫu được phép
- `0900000000`
- `+84900000000`

## Ngoại lệ đã biết (nợ — cần sửa fixture, không thêm dòng mới)
Các email dưới đây nằm trong test hiện có và dùng domain không phải domain dành riêng. Chúng giả (không phải người thật) nhưng chưa đạt quy tắc 3; cần đổi sang `@example.test` trong PR sửa test. Script cảnh báo khi dòng ngoại lệ không còn khớp để xoá khỏi bảng.

| Tệp | Email |
|---|---|
| tests/http/auth.test.ts | nguyenvana@x.vn |
| tests/http/inquiry.test.ts | khach@example.vn |
| tests/http/inquiry.test.ts | uv@x.vn |
| tests/db/audit.test.ts | a@x.vn |
| tests/db/audit.test.ts | b@x.vn |
| tests/db/authz-scope.test.ts | tl@a.vn |
