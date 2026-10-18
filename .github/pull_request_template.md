<!-- Tích thật, có bằng chứng; mục không áp dụng ghi N/A + lý do. CI `pr-policy` kiểm các mục ## và các dòng "Nhãn:". -->
<!-- Tiêu đề PR = subject commit sau squash: Conventional Commits, ≤ 72 ký tự (vd `feat(attendance): khoá kỳ có phiên bản`). -->

## Mô tả

<!-- Vấn đề · hành vi mới · task PLAN (T-NNN) · spec/kịch bản (S-…/AC-…) · quyết định D-NNN/ADR liên quan. -->

## Bằng chứng

- [ ] Gate của task chạy xanh (`python3 .xtemplates/scripts/xt.py loop record …`) — lệnh:
- [ ] CI `quality`, `e2e`, `pr-policy` xanh (gate + coverage baseline + E2E/axe)
- [ ] Mục blueprint đã tick kèm `— Kiểm:` chạy lại được (liệt kê ID) hoặc ghi "không có"
- [ ] PR `fix:` — có test tái hiện lỗi đỏ trước khi sửa (FE-TEST-006): <tên test>
- [ ] PR `refactor:`/`perf:` — bảng trước/sau, không trộn tính năng, số test không đổi (XC-GREEN-005):

| Chỉ số | Trước | Sau |
| ------ | ----- | --- |

## Definition of Done

- [ ] Tiêu chí chấp nhận (AC) trong spec đạt — có test tham chiếu ID
- [ ] Trạng thái lỗi / rỗng / đang tải đã xử lý ở UI (nếu có UI)
- [ ] Tài liệu cập nhật (mục Tài liệu bên dưới)
- [ ] Chạy thử bản build (`npm run build && npm start`) hoặc E2E phủ luồng đổi

## Rủi ro

- [ ] Chạm auth / mật mã / dữ liệu người dùng / bí mật / tiền? (có → ngoại lệ cứng, người merge)
- [ ] Route mới: kiểm quyền ở server + test 401/403 (BOLA/BFLA)
- [ ] Không bí mật, không dữ liệu cá nhân thật trong mã/test/log

Phụ thuộc mới: <!-- tên · phiên bản ghim · license · lý do — hoặc "không có" -->
Lý do sửa cấu hình cổng/migration: <!-- bắt buộc khi đổi .github/, .claude/, xt.yaml, eslint/tsconfig, .c8rc, migrations/ — hoặc "không có" -->
Backup trước migrate: <!-- link/lệnh backup + kế hoạch lùi khi có migration — hoặc "không có migration" / "chưa có production" -->

## Rollback

<!-- Cách lùi: revert PR · migration lùi (expand/contract) · cờ tắt tính năng · dữ liệu cần khôi phục. -->

## Tài liệu

<!-- Đã cập nhật: docs/… — hoặc "không cần" + lý do (đổi API/cấu hình thì phải cập nhật). -->
