# PROGRESS.md — X-Company

> Giai đoạn hiện tại: G7 Release (autopilot) · Cập nhật: 2026-10-18 08:10 UTC · Nhánh: claude/focused-cannon-3iu4lk

## Đang làm
- Audit BLUEPRINT.md (469 MUST): tick `[x]` kèm `— Kiểm:` chạy lại được, `[~]` kèm lý do — trạng thái: đang gộp kết quả audit — chỗ dừng: BASE-CFG-001
- PR #8 (T-002 sửa, T-007…T-024 + bản sửa review) — trạng thái: chờ chủ dự án merge (ngoại lệ cứng: auth/dữ liệu người dùng)

## Tiếp theo
1. Áp kết quả audit vào BLUEPRINT.md → `xt.py blueprint-status BLUEPRINT.md --strict --run`
2. Mục áp dụng được nhưng cần người/hạ tầng → `loop defer` kèm cách làm
3. `xt.py loop verify` → `loop stats` → `feedback collect` → GO-NO-GO.md

## Quyết định
- 2026-10-18 D-001…D-013 tự duyệt — `docs/autopilot/DECISIONS.md` (stack, Argon2id, tự host, mật khẩu NCSC 100k, I3 thu hẹp, C2 cắt phút + trừ nghỉ cố định, đính kèm form công khai hoãn P1)
- PLAN T-001…T-024 xong, Gate xanh; coverage dòng 98,2 %, nhánh 89,8 %; E2E + axe WCAG 2.2 AA xanh
- Rủi ro vận hành: production phải đặt `TRUST_PROXY_HOPS`; quy tắc ca/OT là cấu hình (D-007) chờ HR chốt F02

## Bàn giao phiên
- Commit cuối trên nhánh: `c891dd2` (T-024) · CI: theo dõi trên PR #8
- Lệnh kiểm nhanh: `.xtemplates/scripts/dev-task.sh gate`
- Đang chặn: không
- Việc dở chưa commit: không (ngoài PROGRESS.md này)
- Câu hỏi cần người: merge PR #8 (ngoại lệ cứng), import ruleset, DPIA + HR chốt F02, hạ tầng production
