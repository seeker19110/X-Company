# PLAN.md — Khung X-stored · trả nợ mypy --strict và coverage 100%

> Lập ngày 2026-10-14. Người dùng yêu cầu: "trả nợ mypy --strict và coverage đi, coverage 100%".
> Trả nợ AUD-CODE-002 (mypy --strict 24 lỗi) và AUD-TEST-001 (không ratchet coverage, 77% in-process),
> đóng `BASE-GATE-004` và `BASE-GATE-013`. Cổng chỉ được **siết**, không nới.

## Mục tiêu của kế hoạch này
- `python3 -m mypy --strict` 0 lỗi trên `scripts/*.py` + `.claude/hooks/guard.py`; cổng `typecheck` chạy `--strict`.
- Coverage dòng + nhánh = 100% trên `scripts/*.py` + `.claude/hooks/guard.py`, tính cả code chạy trong subprocess;
  cổng `test` chặn dưới 100% (`coverage report --fail-under=100`).
- `# pragma: no cover` chỉ cho dòng không thể chạy tới trong test (ghi lý do ngay dòng đó); đếm và báo cáo.

## Ngân sách (4 con số)
- Số vòng tối đa: 40 (`--max-iterations 40`)
- Chi phí: 0 đồng ngoài phiên (thêm `coverage` ghim kèm hash, Apache-2.0)
- Timeout mỗi lệnh Gate: 300 giây (`XS_RECORD_TIMEOUT`)
- Ngày hết hạn: 6 giờ sau `loop init` (`--hours 6`)

## Điểm dừng bắt buộc (dừng và hỏi người — `xs.py loop block --reason "..."`)
- Muốn hạ ngưỡng dưới 100% hoặc loại file khỏi phạm vi đo
- Test lộ lỗi hành vi cần đổi giao diện CLI/hook (đổi hành vi người dùng thấy)
- Phụ thuộc mới ngoài `coverage`

## Task

- [x] `T-201` mypy --strict 0 lỗi; `typecheck` trong xs.yaml thêm `--strict` — Gate: `python3 -m mypy --strict --python-version 3.11 scripts/xs.py scripts/install.py scripts/check-links.py .claude/hooks/guard.py`
- [x] `T-202` Đo coverage cả subprocess (`.coveragerc`: branch, parallel, `patch = subprocess`); `coverage` vào requirements-dev.txt kèm hash — Gate: `python3 -m coverage run -m unittest discover -s tests`
- [ ] `T-203` Test tới 100% cho `guard.py`, `install.py`, `check-links.py` — Gate: `python3 -m unittest discover -s tests`
- [ ] `T-204` Test tới 100% cho `xs.py` — Gate: `python3 -m unittest discover -s tests`
- [ ] `T-205` Cổng `test` = coverage run + combine + `report --fail-under=100`; cập nhật sổ audit, BLUEPRINT, CHANGELOG, PROGRESS — Gate: `scripts/dev-task.sh gate`
