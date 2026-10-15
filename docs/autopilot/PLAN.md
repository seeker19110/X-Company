# PLAN.md — Khung X-Templates · xác minh lại bằng chứng blueprint sau #41

> Lập ngày 2026-10-15. Người dùng gọi `/autopilot` sau đề xuất "xác minh lại 31 mục bằng chứng + cập nhật PROGRESS"
> (sau merge #41) — coi là duyệt. Kế hoạch trước (T-501…T-503) xong ở #41.

## Mục tiêu của kế hoạch này
- 31 mục `[x]`/`[~]` mà `audit plan` cờ (trích `scripts/xs.py`, `tests/test_xs.py`, `CHANGELOG.md` đổi ở #41) được mở và
  xác minh lại từng mục: số dòng lệch thì sửa theo độ lệch đo bằng diff (xs.py ≥ 937: +10; test_xs.py ≥ 771: +34;
  CHANGELOG ≥ 55: +2) và đối chiếu nội dung dòng; khẳng định sai → phát hiện mới trong sổ audit, không tick lại.
- PROGRESS phản ánh #41 đã merge.

## Ngân sách (4 con số)
- Số vòng tối đa: 10 (`--max-iterations 10`)
- Chi phí: 0 đồng ngoài phiên (không phụ thuộc mới)
- Timeout mỗi lệnh Gate: 300 giây (`XS_RECORD_TIMEOUT`)
- Ngày hết hạn: 2 giờ sau `loop init` (`--hours 2`)

## Điểm dừng bắt buộc (dừng và hỏi người — `xs.py loop block --reason "..."`)
- Mục blueprint có khẳng định sai mà sửa cần đổi mã/cấu hình cổng
- Force-push, merge PR, xoá nhánh, đổi quyền repo

## Task

- [x] `T-601` Xác minh lại 31 bằng chứng blueprint trỏ file đổi ở #41; sửa số dòng lệch, ghi "(xác minh lại 2026-10-15, sau #41)" — Gate: `python3 scripts/xs.py blueprint-status BLUEPRINT.md --strict && python3 scripts/check-links.py`
- [ ] `T-602` PROGRESS + sổ audit cập nhật sau #41, cổng đầy đủ — Gate: `scripts/dev-task.sh gate`
