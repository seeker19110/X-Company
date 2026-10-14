# PLAN.md — Khung X-Templates · chốt việc còn treo sau đổi tên

> Lập ngày 2026-10-14. Người dùng yêu cầu: "tự quyết hết các việc còn lại đi" (mục Tiếp theo của PROGRESS + hệ quả đổi tên).
> Việc ngoài tầm agent giữ cho người: import ruleset, bật PVR/Dependabot security updates, tạo tag (đổi quyền/cấu hình repo
> = điểm dừng bắt buộc, phiên không có quyền admin); thử khung trên dự án sản phẩm thật (cần người chọn dự án).

## Mục tiêu của kế hoạch này
- `LOOP-HARNESS-012` có quyết định: không biến tắt riêng trong hook (giữ hàng rào ADR-0002), tắt có chủ đích qua `disableAllHooks`
  của harness; mọi hook fail-open với stdin rỗng/rác, có test.
- Phạm vi đổi tên được chốt bằng ADR: giữ định danh kỹ thuật `.xstored/`, `xs.py`, `xs.yaml`, `XS_*`.
- PROGRESS phản ánh trạng thái mới.

## Ngân sách (4 con số)
- Số vòng tối đa: 15 (`--max-iterations 15`)
- Chi phí: 0 đồng ngoài phiên (không phụ thuộc mới)
- Timeout mỗi lệnh Gate: 300 giây (`XS_RECORD_TIMEOUT`)
- Ngày hết hạn: 3 giờ sau `loop init` (`--hours 3`)

## Điểm dừng bắt buộc (dừng và hỏi người — `xs.py loop block --reason "..."`)
- Thêm biến môi trường làm hook guard cho qua lệnh nguy hiểm
- Đổi ruleset/quyền repo, xoá nhánh, merge khi CI đỏ

## Task

- [x] `T-401` `LOOP-HARNESS-012` viết lại (giữ ID, SHOULD) + test mọi hook fail-open với stdin rỗng/rác + tick BLUEPRINT có bằng chứng — Gate: `python3 -m unittest tests.test_hooks`
- [x] `T-402` ADR-0006 phạm vi đổi tên (giữ `.xstored`/`xs`) + CHANGELOG — Gate: `python3 scripts/xs.py validate`
- [x] `T-403` PROGRESS cập nhật + cổng đầy đủ — Gate: `scripts/dev-task.sh gate`
