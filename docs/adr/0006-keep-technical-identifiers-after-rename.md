# ADR-0006: Đổi tên repo thành X-Templates, giữ định danh kỹ thuật `.xstored` / `xs`

- **Trạng thái:** Đã chấp nhận
- **Trạng thái triển khai:** Đã triển khai (PR #30: tên hiển thị, URL clone, harness, mẫu; định danh kỹ thuật không đổi)
- **Ngày:** 2026-10-14

## Bối cảnh

Chủ repo đổi tên `seeker19110/X-stored` → `seeker19110/X-Templates` (GitHub trả 301 từ tên cũ, kiểm 2026-10-14). Tên cũ
xuất hiện ở hai lớp khác nhau:
- **Tên hiển thị**: tiêu đề tài liệu, docstring/`--help`, URL clone, chú thích harness — người đọc thấy, không máy nào phụ thuộc.
- **Định danh kỹ thuật**: thư mục cài `.xstored/` trong dự án đích, `xs.py`, `xs.yaml`, biến `XS_*`, đuôi `.xstored-new`,
  manifest `.xstored/harness.sha256.json`. Hook, `dev-task.sh`, `AGENTS.md`/`CLAUDE.md` của dự án đích, CI và PLAN đều trỏ tới chúng.

## Quyết định

1. Đổi toàn bộ **tên hiển thị** sang X-Templates (PR #30); tài liệu lịch sử (`research/`, ADR cũ, báo cáo audit đã ký,
   trích dẫn "khung cũ X-stored commit `1b80fe4`") giữ tên cũ vì đó là sự kiện đã xảy ra.
2. **Giữ nguyên định danh kỹ thuật**: `.xstored/`, `xs.py`, `xs.yaml`, `XS_*`, `.xstored-new`, manifest hash.

## Lý do

- Đổi `.xstored/` phá mọi dự án đã cài: hook đang chạy trỏ `.xstored/scripts/`, `install.py` bản mới sẽ cài song song thư mục
  thứ hai, manifest hash không còn so được — mất đường cập nhật tại chỗ (ADR-0002, CHANGELOG 2.0.0).
- Lớp tương thích (đọc cả hai tên, di chuyển tự động) thêm mã + test + nhánh coverage cho lợi ích chỉ là thẩm mỹ.
- Tên repo có thể còn đổi; định danh kỹ thuật ổn định giống ID checklist (P: "ID ổn định, không tái sử dụng").

## Các phương án đã cân nhắc

- **Đổi hết sang `.xtemplates/` + `xt.py` kèm lớp tương thích một phiên bản lớn:** đúng tên nhưng là thay đổi phá vỡ
  (SemVer 3.0.0) cho dự án đã cài, chi phí di chuyển trên mỗi dự án. Loại.
- **Không đổi gì, chỉ để GitHub chuyển hướng:** URL cũ có thể bị chiếm nếu ai tạo repo trùng tên cũ; tài liệu sai tên. Loại.

## Hệ quả

- Dự án đã cài chạy lại `install.py` từ bản mới chỉ nhận chuỗi hiển thị mới; file người dùng đã sửa vẫn sinh `.xstored-new`.
- Muốn đổi định danh kỹ thuật về sau: ADR mới thay thế ADR này, kèm công cụ di chuyển và phiên bản lớn.
