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

## Ngoại lệ đã biết
Không có. Fixture dùng `@example.test`/`.example`; không thêm ngoại lệ mới — sửa fixture thay vì thêm dòng.
