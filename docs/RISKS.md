---
title: Sổ rủi ro và phụ thuộc — X-Company
updated: 2026-10-18
owner: seeker19110
---

# Sổ rủi ro (PM-RISK-001) và thẩm định phụ thuộc (PM-RISK-006)

> Xác suất/ảnh hưởng: Thấp · TB · Cao. Ứng xử: mitigate · avoid · transfer · accept. Rà lại mỗi lát hoặc khi trigger nổ; cột "Ngày rà" cập nhật mỗi lần rà.
> Rủi ro xếp đầu (xác suất × ảnh hưởng cao nhất) cần spike hoặc biện pháp bắt đầu trong lát dọc đầu tiên (PM-RISK-003) — xem cuối tài liệu.

## Rủi ro
| ID | Mô tả | Xác suất | Ảnh hưởng | Chủ | Cách ứng xử | Biện pháp | Trigger | Trạng thái | Ngày rà |
|---|---|---|---|---|---|---|---|---|---|
| RK-001 | Quy tắc ca/OT/nghỉ của công ty chưa được HR chốt (F02): giá trị ⚙ mặc định có thể lệch quy định nội bộ hoặc Bộ luật Lao động | Cao | Cao | seeker19110 (HR chốt giá trị: chưa chỉ định) | mitigate | giá trị ⚙ là cấu hình có ngày hiệu lực (D-007), kỳ đã khoá giữ `policy_version_id` cũ; bộ ví dụ vào/ra của HR thành test; pháp chế xác nhận hạn mức OT | HR cung cấp ví dụ cho kết quả khác `computeShift`; HR đổi quy tắc khi kỳ đã khoá | mở — chờ HR | 2026-10-18 |
| RK-002 | GPS/QR kém tin cậy ở hiện trường (vị trí giả, QR chụp lại, tín hiệu yếu công trường) | TB | Cao | seeker19110 | mitigate | QR ký HMAC TTL 60 s + ca + địa điểm là chính; GPS chỉ là tín hiệu đối soát và tắt mặc định tới khi có DPIA; thử tại địa điểm thật (Q02); ngoại lệ vào `needs_review` | tỷ lệ `needs_review` trong pilot vượt `<chủ dự án điền ngưỡng>`; nhân viên báo không quét được | mở — chờ thử hiện trường | 2026-10-18 |
| RK-003 | Nợ mang theo khi chép có chọn lọc hạ tầng từ XBOSS (auth, DB, audit, CI) | TB | TB | seeker19110 | mitigate | mỗi phần chép có test riêng và ghi nguồn `xboss@<commit>:<file>` trong commit (D-001, ADR-0001); review từng phần | lỗi/lỗ hổng truy về phần chép; XBOSS sửa lỗi phần đã chép | đang theo dõi | 2026-10-18 |
| RK-004 | Khối lượng P0 lớn hơn thời gian/ngân sách một phiên tự động (hạn mong muốn 2026-10-20) | Cao | TB | seeker19110 | mitigate | lát xếp theo rủi ro (nền → quyền/audit → nghiệp vụ); phần chưa xong ghi rõ ở báo cáo/`loop defer`; cắt lát cuối về backlog, không hạ cổng | còn task chưa xong khi gần ngân sách token hoặc hạn | mở | 2026-10-18 |

## Phụ thuộc quan trọng (thẩm định)
EOL tra <https://endoflife.date/api/> ngày 2026-10-18; license lấy từ `package.json` của gói đã cài. OSI = giấy phép được Open Source Initiative duyệt.
Telemetry: mặc định của sản phẩm; "không" nghĩa là không thấy cơ chế gửi dữ liệu dùng ra ngoài trong tài liệu/mã đã đọc (chưa kiểm bằng bắt gói mạng).

| Phụ thuộc | Phiên bản | License (OSI?) | EOL / hỗ trợ | Telemetry mặc định | Cách thoát / xuất dữ liệu |
|---|---|---|---|---|---|
| Next.js | 16.4.2 | MIT (OSI) | chu kỳ 16: chưa công bố EOL (LTS, phát hành 2025-10-22) | **Có** — gửi dữ liệu sử dụng ẩn danh; tắt bằng `NEXT_TELEMETRY_DISABLED=1` (CI đã đặt; máy dev/production phải đặt) hoặc `npx next telemetry disable` | `lib/` không import `next/*` (luật ESLint) nên nghiệp vụ mang đi được; viết lại `app/` và `proxy.ts` sang framework khác — chi phí cao |
| React / React DOM | 19.3.1 | MIT (OSI) | chu kỳ 19: chưa công bố EOL | không | gắn chặt với giao diện; thoát = viết lại giao diện (chấp nhận rủi ro) |
| pg (node-postgres) | 8.23.1 | MIT (OSI) | không có lịch EOL trên endoflife.date; theo dõi bản mới qua Dependabot | không | chỉ `lib/db` chạm trực tiếp; thay driver cùng giao diện truy vấn |
| PostgreSQL | 17 | PostgreSQL License (OSI) | 2029-11-08 (endoflife.date) | không | `pg_dump`/`pg_restore` chuẩn; mã chỉ dùng tính năng có từ bản 16 nên chạy được 16–18 |
| @node-rs/argon2 | 2.2.2 | MIT (OSI) | không có lịch EOL; binary dựng sẵn theo nền tảng | không | mật khẩu lưu chuỗi PHC → đổi thuật toán/thư viện, nâng cấp dần khi đăng nhập (D-003) |
| markdown-it | 14.3.3 | MIT (OSI) | không có lịch EOL; theo dõi bản mới | không | nội dung CMS lưu Markdown thuần → thay bộ render ở `lib/cms/markdown.ts`, giữ quy tắc không HTML thô |
| zod | 4.6.7 | MIT (OSI) | không có lịch EOL; theo dõi bản mới | không | schema ở biên API; thay bằng thư viện khác phải viết lại schema (đã gom ở `lib/`) |
| Playwright (`@playwright/test`) | 1.64.1 | Apache-2.0 (OSI) | không có lịch EOL; theo dõi bản mới | không cơ chế gửi dữ liệu dùng ra ngoài được nêu (chưa xác minh bằng bắt gói) | chỉ dùng cho E2E; thay công cụ E2E không ảnh hưởng sản phẩm |

Bảng cập nhật khi thêm/nâng phụ thuộc lõi (đã có Dependabot hằng tuần và `dep-audit`; xem `docs/ops/VULN-SLA.md`). Danh sách license đầy đủ cho mọi phụ thuộc gián tiếp: `<chưa có — thuộc task chuỗi cung ứng T-037>`.

## Phụ lục — rủi ro xếp đầu và spike (PM-RISK-003)
Rủi ro xếp đầu: **RK-001** (xác suất Cao × ảnh hưởng Cao). Biện pháp bắt đầu từ lát nghiệp vụ đầu tiên: giá trị ⚙ thành cấu hình có hiệu lực (D-007) và bộ test `computeShift` theo ví dụ spec. Việc còn thiếu: ghi `RK-001` vào task đầu của PLAN (đề xuất câu ở báo cáo giao việc).
