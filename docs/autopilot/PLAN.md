# PLAN.md — Khung X-Templates · sửa audit delta `b32e2a6`

> Lập ngày 2026-10-15. Người dùng gọi `/autopilot` sau khi audit delta trình kế hoạch 1 đợt (báo cáo
> `docs/ops/AUDIT-REPORT-2026-10-15.md` §8) — coi là duyệt kế hoạch đó. Kế hoạch trước (T-401…T-403) đã xong, xem lịch sử git.

## Mục tiêu của kế hoạch này
- AUD-HAR-019: bằng chứng `LOOP-HARNESS-004` trích máy kiểm chạy trên mọi PR, không trích file trạng thái đổi mỗi phiên.
- AUD-DOC-022: ghi chú các dòng nhóm trong sổ audit khớp SHA của chúng, có số đo của lần quét lại.
- Không sửa mã; `audit check --strict` exit 0 với 0 phát hiện mở.

## Ngân sách (4 con số)
- Số vòng tối đa: 10 (`--max-iterations 10`)
- Chi phí: 0 đồng ngoài phiên (không phụ thuộc mới)
- Timeout mỗi lệnh Gate: 300 giây (`XS_RECORD_TIMEOUT`)
- Ngày hết hạn: 2 giờ sau `loop init` (`--hours 2`)

## Điểm dừng bắt buộc (dừng và hỏi người — `xs.py loop block --reason "..."`)
- Đổi cấu hình cổng (`xs.yaml`, workflow, ruleset, hook) hoặc mã `scripts/xs.py` — ngoài phạm vi đợt này
- Merge PR, xoá nhánh, đổi quyền repo

## Task

- [x] `T-501` AUD-HAR-019: bằng chứng `LOOP-HARNESS-004` (BLUEPRINT.md) trích `progress-check` trong cổng `lint` + `ProgressCheckTest`, không trích `PROGRESS.md`; mục khác trích `CHANGELOG.md` (BASE-REPO-006/007) giữ vì nội dung khẳng định thật sự phụ thuộc file đó — Gate: `python3 scripts/xs.py blueprint-status BLUEPRINT.md --strict && ! grep -nE '^- \[x\] .LOOP-HARNESS-004.*Bằng chứng:.*PROGRESS\.md' BLUEPRINT.md`
- [ ] `T-502` AUD-DOC-022: đo lại SEC/CODE/TEST/CI/XFEAT trên mã `05ec95d` (= HEAD, chỉ tài liệu đổi sau đó) bằng bandit/vulture/pip-audit/ci-check/gate, viết lại ghi chú 5 dòng; đánh dấu 2 phát hiện `đã sửa` — Gate: `python3 scripts/xs.py audit check docs/ops/AUDIT-STATUS.md --strict && ! grep -nE '295 test|124 commit' docs/ops/AUDIT-STATUS.md`
- [ ] `T-503` PROGRESS cập nhật + cổng đầy đủ — Gate: `scripts/dev-task.sh gate`
