---
title: SPEC-website-cms
features: [F-003]
status: approved
approved_by: "autopilot D-006"
approved_at: 2026-10-18
updated: 2026-10-18
---

# SPEC — Website công ty, CMS, liên hệ & tuyển dụng (F-003)

Trạng thái: Approved for implementation (D-006)

> Nguồn: kế hoạch §3 (Website), §8. Nghiệm thu: AT01. Cập nhật 2026-10-18.

## Trang công khai
Trang chủ, Giới thiệu, Dịch vụ (danh sách + chi tiết), Dự án tiêu biểu, Năng lực & chứng nhận, Tin tức, Tuyển dụng
(danh sách + chi tiết + nộp hồ sơ), Liên hệ. Nội dung lấy từ CMS (`cms_page` theo `slug` + `type`); chỉ phiên bản
`published` và `publish_at ≤ now` được render. Tiếng Việt (`lang="vi"`); cấu trúc sẵn `locale` cho P1 tiếng Anh.

## CMS
- `cms_page(id, company_id, type, slug, locale)` + `cms_revision(page_id, version, title, summary, body_markdown, seo_title, seo_description, og_image_file_id, canonical_url, status, author, reviewer, publish_at, created_at)`.
- Luồng: `draft → in_review → approved → published`; `archived`. Người duyệt ≠ tác giả (R5). Hoàn tác = xuất bản lại phiên bản cũ thành phiên bản mới (không sửa lịch sử).
- Xem trước bản nháp chỉ qua route nội bộ có xác thực; bản chưa duyệt **không** xuất hiện ở route công khai, sitemap, tìm kiếm (AT01).
- Markdown render an toàn: không cho HTML thô (escape), liên kết `javascript:` bị loại; ảnh phải có `alt` (cảnh báo khi duyệt nếu thiếu).
- SEO: `<title>`, mô tả, canonical, Open Graph, `sitemap.xml` (chỉ trang published), `robots.txt` (chặn `/app`, `/api`), redirect 301 khi đổi slug (`cms_redirect`).

## Liên hệ & tuyển dụng
- Form liên hệ: họ tên (bắt buộc, ≤ 120), phương thức liên hệ (email hoặc điện thoại hợp lệ — ít nhất một), nhu cầu (≤ 4.000), dịch vụ quan tâm (tuỳ chọn), đồng ý xử lý dữ liệu (bắt buộc, lưu phiên bản thông báo quyền riêng tư đã hiển thị), tệp tuỳ chọn (≤ 10 MB⚙, pdf/png/jpg/docx dò theo nội dung) — hoãn sang P1 cùng hàng cách ly + quét tệp (D-013); P0 chỉ nhận tệp từ người dùng nội bộ.
- Gửi thành công → **đúng một** `inquiry` có mã `YC-YYYYMMDD-NNNN`, `source` (trang/UTM), `assignee` theo quy tắc định tuyến (dịch vụ → người phụ trách; mặc định hàng chung kinh doanh), `due_at` = +1 ngày làm việc⚙, lịch sử trạng thái `new → assigned → in_progress → qualified|closed`.
- Chống gửi trùng: client gửi `submission_id` (UUID sinh khi mở form); cùng id → trả cùng mã hồ sơ (không tạo thêm).
- Chống spam nhiều lớp: trường bẫy ẩn (honeypot) có giá trị → trả 200 giả nhưng không lưu; thời gian điền < 3 s → đánh dấu `suspected_spam`; giới hạn 5 lần/10 phút/IP → 429. Thử thách bổ sung (captcha) chỉ khi bật cấu hình.
- Hồ sơ ứng viên (`job_application`) tách quyền: chỉ vai trò `hr` (và grant tuyển dụng) đọc; `sales`/`editor` không thấy.
- Phản hồi cho khách không lộ thông tin nội bộ (chỉ mã hồ sơ + thông điệp).

## Kịch bản
- S-WEB-01 (AT01): gửi liên hệ hợp lệ → 201 + mã hồ sơ; DB có 1 `inquiry` `assigned` có `due_at`; gửi lại cùng `submission_id` → cùng mã, vẫn 1 hồ sơ.
- S-WEB-02 (AT01): trang ở trạng thái `in_review` → GET công khai 404; không có trong sitemap.
- S-WEB-03: tác giả tự duyệt bản của mình → 409 `SELF_APPROVAL`.
- S-WEB-04: honeypot có giá trị → 200, không có bản ghi.
- S-WEB-05: `sales` mở hồ sơ ứng viên → 403.
- S-WEB-06: body markdown chứa `<script>` → hiển thị dạng chữ, không thực thi.
- Ca biên: `publish_at` tương lai → chưa hiện; đổi slug → slug cũ 301 sang mới; thiếu cả email lẫn điện thoại → 422.

## Tiêu chí chấp nhận

Mỗi tiêu chí `AC-<MIỀN>-NN` ánh xạ 1-1 tới một kịch bản `S-*` ở mục Kịch bản; test mang mã `S-*` trong `tests/` hoặc `e2e/` (script `npm run -s check:docs` đối chiếu AC → S-ID → test, WF-SDD-003). Loại: chuẩn · lỗi (ca lỗi) · biên.

| ID | Loại | Tiêu chí (Given/When/Then) | Kịch bản (S-ID) |
|---|---|---|---|
| AC-WEB-01 | chuẩn | Given liên hệ hợp lệ, When gửi, Then 201 + mã hồ sơ; DB có 1 `inquiry` `assigned` có `due_at`; gửi lại cùng `submission_id` Then cùng mã, vẫn 1 hồ sơ | S-WEB-01 |
| AC-WEB-02 | lỗi | Given trang ở `in_review`, When GET công khai, Then 404 và không có trong sitemap | S-WEB-02 |
| AC-WEB-03 | lỗi | Given tác giả tự duyệt bản của mình, Then 409 `SELF_APPROVAL` | S-WEB-03 |
| AC-WEB-04 | lỗi | Given honeypot có giá trị, Then phản hồi thành công giả (hiện thực trả 201; spec gốc ghi 200), không có bản ghi | S-WEB-04 |
| AC-WEB-05 | lỗi | Given `sales` mở hồ sơ ứng viên, Then 403 | S-WEB-05 |
| AC-WEB-06 | lỗi | Given body markdown chứa `<script>`, Then hiển thị dạng chữ, không thực thi | S-WEB-06 |

## Ca biên

Nhóm theo PM-SPEC-003 (8 nhóm). "Phủ bởi" nêu test đã có; "chưa có test" là nợ ghi rõ, không phải đã phủ.

| Nhóm | Ca biên | Hành vi mong đợi | Phủ bởi |
|---|---|---|---|
| Rỗng/null | thiếu cả email lẫn điện thoại; không đồng ý xử lý dữ liệu; email sai | 400/422 có chi tiết, không tạo hồ sơ | `tests/http/inquiry.test.ts` |
| Cực đại | tệp tải lên vượt giới hạn; nhu cầu > 4.000 ký tự, họ tên > 120 | tệp: 413; văn bản: bị zod từ chối | `tests/http/files.test.ts` (tệp); giới hạn độ dài form: chưa có test riêng |
| Trùng lặp/idempotency | `submission_id` lặp | cùng mã hồ sơ, không tạo thêm | S-WEB-01 |
| Song song | cùng `submission_id` gửi đồng thời; vượt 5 lần/10 phút bằng request song song | vẫn một hồ sơ; vẫn bị 429 | `tests/http/inquiry.test.ts`, `tests/db/review-pr8.test.ts` |
| Mất mạng giữa chừng | khách mất phản hồi rồi gửi lại | `submission_id` cũ trả cùng mã | S-WEB-01 |
| Thời gian/múi giờ | `publish_at` tương lai; đổi slug; hạn xử lý +1 ngày làm việc (bỏ T7/CN, giờ VN) | chưa hiện; slug cũ 301; `due_at` đúng | `tests/db/cms.test.ts`, `tests/http/public-site.test.ts`, `tests/http/inquiry.test.ts` |
| Quyền | `sales`/`editor` đọc hồ sơ ứng viên; tác giả tự duyệt | 403; 409 | S-WEB-05, S-WEB-03 |
| Tiền/đơn vị | không áp dụng: website P0 không xử lý tiền; đơn vị duy nhất là kích thước tệp (byte) đã nêu ở giới hạn | — | — |

## Câu hỏi mở

- Đính kèm tệp ở form liên hệ công khai — Đã quyết: D-013 (hoãn sang P1 cùng hàng cách ly + quét tệp; P0 chỉ nhận tệp từ người dùng nội bộ).
- Thời hạn lưu hồ sơ liên hệ/ứng viên khi pháp chế chưa chốt — Đã quyết: D-016 (cấu hình mặc định thận trọng: liên hệ 24 tháng, ứng viên 12 tháng; pháp chế chốt ở F02).
- Dịch vụ ngoài (S3, email, push) — Đã quyết: D-005 (tự host, adapter có contract test).
