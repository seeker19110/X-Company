# PROGRESS.md — X-Company

> Giai đoạn hiện tại: G7 cứng hoá xong phần trong repo (autopilot, lát 8) · Cập nhật: 2026-10-18 · Nhánh: claude/focused-cannon-3iu4lk

## Đang làm
- PR #11 đã merge (c533be5). Việc sau đó (T-043 OpenAPI, GO-NO-GO, sửa lệnh kiểm) chờ PR mới. CI xanh trên head đã kiểm.
- Không còn task PLAN chưa tick. 106 mục blueprint đã `loop defer` chờ người/hạ tầng; `GO-NO-GO.md` = NO-GO production.

## Tiếp theo
1. Chủ dự án: merge PR #11; import `.github/rulesets/main.json`; bật Private Vulnerability Reporting; LICENSE chủ sở hữu; mô tả/topic repo
2. HR + pháp chế: thời hạn lưu, danh mục giữ lại, DSAR_DAYS, DPIA (D-016, D-020); HR chốt quy tắc ca/OT (RK-001)
3. Hạ tầng production (backup, giám sát, DAST, mã hoá at-rest) rồi `loop resume`

## Quyết định
- D-014…D-028 ở `docs/autopilot/DECISIONS.md` (RLS không áp dụng một tenant; lỗi RFC 9457; i18n tách tệp; phân trang offset có trần; OpenAPI JSON; review=0 một maintainer…)
- typescript giữ 6.0.3 (typescript-eslint peer <6.1); `lint` chạy `npm ls`
- Chưa xác minh: lighthouse/k6/RUM trên môi trường thật; ruleset GitHub chưa import
- 6 lệnh `— Kiểm:` lỗi thời/tự khớp cần người cho phép chỉnh (BASE-SEC-002, ARC-STYLE-003, UX-CONTENT-005, BASE-CFG-006, WF-CI-004, SEC-SUPPLY-009)

## Bàn giao phiên
- Commit cuối trên nhánh chính: `c533be5` (main sau #11 squash-merge) · việc sau #11 (OpenAPI, GO-NO-GO, sửa lệnh kiểm) ở nhánh làm việc, chờ PR mới
- Lệnh kiểm nhanh: `.xtemplates/scripts/dev-task.sh gate` (592 test xanh) · `npm run -s e2e` 31/31 · `check:arch` xanh
- Đang chặn: không · Việc dở chưa commit: không
- Câu hỏi cần người: merge PR #11; sửa lỗi phân trang `merge-check` ở xt.py trong repo này hay ở repo khung (FB-001)
