# PLAN.md — Khung X-Templates · trả nợ C901 (AUD-CODE-001)

> Lập ngày 2026-10-14. Người dùng yêu cầu: "trả nợ C901 luôn đi".
> 11 hàm có độ phức tạp vòng (mccabe) > 10 — đo bằng
> `ruff check --select C901 --config 'lint.mccabe.max-complexity=10' scripts .claude/hooks`.
> Sau khi trả: bật luật C901 (`max-complexity = 10`) trong `ruff.toml` để cổng `lint` chặn nợ quay lại.

## Mục tiêu của kế hoạch này
- 0 hàm vượt độ phức tạp 10 trong `scripts/*.py` + `.claude/hooks/guard.py`; `ruff.toml` bật C901.
- Hành vi không đổi: test có sẵn giữ nguyên assert và xanh; coverage dòng + nhánh vẫn 100%; `mypy --strict` 0 lỗi.
- Tách theo trách nhiệm có nghĩa (một hàm một việc, tên nói rõ việc), không băm cơ học cho lọt ngưỡng.

## Ngân sách (4 con số)
- Số vòng tối đa: 30 (`--max-iterations 30`)
- Chi phí: 0 đồng ngoài phiên (không phụ thuộc mới)
- Timeout mỗi lệnh Gate: 300 giây (`XS_RECORD_TIMEOUT`)
- Ngày hết hạn: 6 giờ sau `loop init` (`--hours 6`)

## Điểm dừng bắt buộc (dừng và hỏi người — `xs.py loop block --reason "..."`)
- Refactor buộc đổi hành vi người dùng thấy (output CLI, quyết định hook, exit code)
- Muốn nới ngưỡng (> 10), thêm `noqa: C901`, hoặc loại file khỏi luật

## Task

- [x] `T-301` Tách `guard.py` (`normalize`, `git_rules`, `bash_decision`) và `install.py` (`install`) về ≤ 10 — Gate: `python3 -m ruff check --select C901 --config lint.mccabe.max-complexity=10 .claude/hooks scripts/install.py`
- [x] `T-302` Tách `xs.py` (`validate`, `audit_check`, `ci_check_text`, `loop_verdict`, `compose`, `cmd_loop`, `blueprint_stale_evidence`) về ≤ 10 — Gate: `python3 -m ruff check --select C901 --config lint.mccabe.max-complexity=10 scripts/xs.py`
- [x] `T-303` `ruff.toml` bật C901 (max-complexity 10); sổ audit AUD-CODE-001 đã sửa, CHANGELOG, PROGRESS — Gate: `scripts/dev-task.sh gate`
