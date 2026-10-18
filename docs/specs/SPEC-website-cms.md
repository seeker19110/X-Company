# SPEC — Website công ty, CMS, liên hệ & tuyển dụng (F-003)

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
- Form liên hệ: họ tên (bắt buộc, ≤ 120), phương thức liên hệ (email hoặc điện thoại hợp lệ — ít nhất một), nhu cầu (≤ 4.000), dịch vụ quan tâm (tuỳ chọn), đồng ý xử lý dữ liệu (bắt buộc, lưu phiên bản thông báo quyền riêng tư đã hiển thị), tệp tuỳ chọn (≤ 10 MB⚙, pdf/png/jpg/docx dò theo nội dung).
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
