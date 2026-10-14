# PLAN.md — Khung X-stored · sửa audit 2026-10-14 (5 đợt)

> Lập ngày 2026-10-14 từ `docs/ops/AUDIT-REPORT-2026-10-14.md` §5. Người dùng duyệt cả 5 đợt ("duyệt cả 5 đợt, làm tự động đi"),
> gồm cả đợt đổi hook (2) và CI/ruleset (4). PR xanh thì tự merge; CI đỏ/xung đột thì tự sửa.
> AUD-DOC-004: chọn đề xuất của báo cáo (bỏ điều kiện "nhánh còn trên remote" khỏi WF-DOC-004, ghi lý do).

## Mục tiêu của kế hoạch này
`python3 scripts/xs.py audit check docs/ops/AUDIT-STATUS.md --strict` exit 0: không còn 🔴/🟠 mở; nợ 🟢 còn lại có chủ + hạn.

## Ngân sách (4 con số)
- Số vòng tối đa: 40 (`--max-iterations 40`)
- Chi phí: 0 đồng ngoài phiên (chỉ thư viện chuẩn + công cụ đã ghim)
- Timeout mỗi lệnh Gate: 300 giây (`XS_RECORD_TIMEOUT`)
- Ngày hết hạn: 6 giờ sau `loop init` (`--hours 6`)

## Điểm dừng bắt buộc (dừng và hỏi người — `xs.py loop block --reason "..."`)
- Ruleset/quyền repo/tag phát hành trên GitHub (chỉ sửa file ruleset trong repo, không import)
- Phát hiện mới mức 🔴 trong lúc sửa
- Hạ ngưỡng, skip test, sửa ADR cũ

## Task

- [x] `T-101` Đợt 1: AUD-HAR-001 (gốc dự án của dev-task + no-op không báo xanh), HAR-002 (argv/`--`), CFG-001 (che bí mật + `cmd`), HAR-007, HAR-008 (task phải có Gate), HAR-009 (write_atomic) — Gate: `scripts/dev-task.sh gate`
- [x] `T-102` Đợt 2: hook tách lệnh bằng shlex (AUD-SEC-001…010), session-start cắt UTF-8 an toàn (HAR-011) — Gate: `python3 -m unittest discover -s tests -k guard`
- [x] `T-103` Đợt 3: install đăng ký hook vào settings có sẵn (HAR-003), manifest hash cập nhật hook chưa sửa (HAR-004), bỏ qua symlink (HAR-010), cảnh báo ruleset cần workflow (CI-003) — Gate: `python3 -m unittest discover -s tests -k install`
- [x] `T-104` Đợt 4: requirements-dev có hash + Dependabot pip (DEP-001), nâng action (DEP-002), ruleset strict (CI-002), lychee nhận 202 (CI-004) — Gate: `scripts/dev-task.sh gate`
- [ ] `T-105` Đợt 5: thống nhất tài liệu AUD-DOC-001…019, CI-001, CI-005, HAR-005; xác minh lại 45 bằng chứng blueprint (HAR-006) — Gate: `python3 scripts/xs.py validate`
- [ ] `T-106` Sổ audit: cập nhật trạng thái, quét lại nhóm bị chạm, `--strict` xanh — Gate: `python3 scripts/xs.py audit check docs/ops/AUDIT-STATUS.md --strict`
