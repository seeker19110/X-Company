# PROGRESS.md — X-Company

> Giai đoạn hiện tại: G7 cứng hoá (autopilot, lát 8) · Cập nhật: 2026-10-18 11:05 UTC · Nhánh: claude/focused-cannon-3iu4lk

## Đang làm
- Lát 8 cứng hoá theo blueprint (D-014) — xong T-025…T-030, T-034…T-036, T-039; đang chạy T-032, T-037, T-038, T-040 (executor, worktree)
- PR #11 (lát 8) — trạng thái: CI đang chạy; ngoại lệ cứng (auth/audit/dữ liệu người dùng) → chủ dự án merge

## Tiếp theo
1. Gộp T-032/T-037/T-038/T-040 → cổng + E2E + check:* xanh → tick blueprint kèm `— Kiểm:`
2. T-031 (NFC, i18n messages/vi.json, Intl, đơn vị, phân trang) rồi T-033 (E2E mở rộng: axe mọi route, bàn phím, 320 px, mobile)
3. `xt.py loop verify` → `loop stats` → `feedback collect` → GO-NO-GO.md

## Quyết định
- D-014…D-017 (2026-10-18): lát 8; RLS không áp dụng khi một tenant; thời hạn lưu là cấu hình; lỗi RFC 9457 giữ trường cũ
- typescript về 6.0.3 (Dependabot #6 làm `npm ci` ERESOLVE); hàng rào: `lint` chạy `npm ls`
- PR #8 squash-merge → nhánh nối lại bằng merge `-s ours` (không force-push)
- Chưa xác minh: lighthouse/k6/RUM trên môi trường thật; ruleset GitHub chưa import

## Bàn giao phiên
- Commit cuối trên nhánh chính: `43525f3` (main sau #6) · nhánh làm việc trên PR #11
- Lệnh kiểm nhanh: `.xtemplates/scripts/dev-task.sh gate` (414 test xanh) · `npm run -s e2e` 10/10
- Đang chặn: không · Việc dở chưa commit: không
- Câu hỏi cần người: merge PR #11; import ruleset; bật Private Vulnerability Reporting; LICENSE chủ sở hữu; DPIA + thời hạn lưu; hạ tầng production; `merge-check` lỗi phân trang qua proxy (chờ quyết sửa ở khung)
