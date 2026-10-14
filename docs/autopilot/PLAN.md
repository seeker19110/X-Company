# PLAN.md — Khung X-stored · nâng cấp audit

> Lập ngày 2026-10-14 theo yêu cầu người dùng ("nâng cấp audit lên mức tốt nhất … phù hợp với dự án khung và dự án đích").
> Người dùng đã cho phép: PR xanh thì tự merge, CI đỏ/xung đột thì tự sửa. Blueprint: BLUEPRINT.md.

## Mục tiêu của kế hoạch này
Audit thành quy trình có **máy đỡ** thay vì chỉ văn xuôi trong skill: phương pháp một nhà trong khung, mẫu
`AUDIT-STATUS.md` máy đọc được, `xs.py audit plan` (dò stack → nhóm áp dụng, công cụ có/thiếu, bằng chứng blueprint
có thể đã cũ, nhóm cần quét lại theo diff) và `xs.py audit check` (schema phát hiện + Definition of Complete).
Chỉ số: audit chính repo khung chạy hết bằng quy trình mới, `audit check` exit 0 trên `docs/ops/AUDIT-STATUS.md`.

## Ngân sách (4 con số)
- Số vòng tối đa: 20 (`--max-iterations 20`)
- Chi phí: 0 đồng ngoài phiên (chỉ thư viện chuẩn, không dịch vụ trả phí)
- Timeout mỗi lệnh Gate: 300 giây (`XS_RECORD_TIMEOUT`)
- Ngày hết hạn: 4 giờ sau `loop init` (`--hours 4`)

## Điểm dừng bắt buộc (dừng và hỏi người — `xs.py loop block --reason "..."`)
- Ruleset, quyền repo, tag/release (5 MUST chờ admin — không đụng)
- Sửa phát hiện audit trước khi người duyệt kế hoạch sửa (skill /audit bước 3)
- Hạ ngưỡng, skip test, sửa ADR cũ

## Task

- [x] `T-001` Phương pháp `framework/00-method/audit.md`: phạm vi, áp dụng theo tín hiệu repo, 13 nhóm (thêm Harness), lệnh dò theo stack, thang mức, loại bằng chứng, schema phát hiện, xác minh đối kháng, quét lại theo diff, Definition of Complete; chỉ mục 00-method + lifecycle trỏ tới — Gate: `python3 scripts/xs.py validate`
- [x] `T-002` Mẫu `framework/templates/AUDIT-STATUS.md` (máy đọc) và `AUDIT-REPORT.md`; chỉ mục templates — Gate: `python3 scripts/xs.py validate`
- [ ] `T-003` `xs.py audit plan`: tín hiệu stack, nhóm áp dụng/rút gọn/N/A kèm lý do, công cụ có/thiếu theo nhóm, bằng chứng blueprint trỏ file đã đổi sau khi tick, nhóm cần quét lại từ SHA trong STATUS; `--json` + test — Gate: `python3 -m unittest discover -s tests -k audit_plan`
- [ ] `T-004` `xs.py audit check STATUS [--strict]`: schema nhóm/phát hiện, SHA tổ tiên HEAD, chấp nhận rủi ro có hạn chưa quá, `--strict` đỏ khi còn 🔴/🟠 mở hoặc nhóm chưa quét + test — Gate: `python3 -m unittest discover -s tests -k audit_check`
- [ ] `T-005` Viết lại skill `/audit` dùng hai lệnh + fan-out subagent theo cụm nhóm + xác minh đối kháng; ADR-0005; README/AGENTS/CHANGELOG — Gate: `scripts/dev-task.sh gate`
- [ ] `T-006` Dogfood: audit repo khung theo quy trình mới → `docs/ops/AUDIT-STATUS.md` + `docs/ops/AUDIT-REPORT-2026-10-14.md`; dừng chờ duyệt kế hoạch sửa — Gate: `python3 scripts/xs.py audit check docs/ops/AUDIT-STATUS.md`
- [ ] `T-007` PR, CI xanh, tự merge theo uỷ quyền; PROGRESS — Gate: `python3 scripts/xs.py progress-check PROGRESS.md`
