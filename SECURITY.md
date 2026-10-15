# Chính sách bảo mật

## Báo lỗ hổng

Repo này chứa tài liệu khung và công cụ dòng lệnh (`scripts/xt.py`, `scripts/install.py`, hook bash trong `.claude/hooks/`).
Nếu phát hiện lỗ hổng (ví dụ hook có thể bị né bằng cách nối lệnh, `install.py` ghi đè file ngoài thư mục đích,
`xt.py loop record` thực thi lệnh ngoài ý muốn), **không mở issue công khai**. Dùng tính năng
*Report a vulnerability* (GitHub Private Vulnerability Reporting) của repo, hoặc liên hệ chủ repo qua địa chỉ trên trang GitHub.

Thời hạn phản hồi mục tiêu: 7 ngày xác nhận, 30 ngày khắc phục cho mức cao.

## Phạm vi

- Trong phạm vi: mã trong `scripts/`, `.claude/hooks/`, workflow trong `.github/`, nội dung hướng dẫn gây hành vi không an toàn khi làm theo.
- Ngoài phạm vi: lỗ hổng của các công cụ bên thứ ba được khung *khuyến nghị* (báo cho dự án đó); cấu hình riêng của dự án đích.

## Nguyên tắc an toàn của chính khung

- Hook **fail-open về luồng** (không kẹt phiên) nhưng **fail-closed về quyết định nguy hiểm** (`deny` lệnh phá huỷ, `ask` hành động đối ngoại).
- `xt.py loop record` chạy lệnh Gate do PLAN khai báo qua shell — PLAN là file trong repo, đi qua review như code.
- Action trong workflow ghim theo SHA đầy đủ, `permissions` tối thiểu, gitleaks quét toàn bộ lịch sử.
