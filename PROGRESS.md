# PROGRESS.md — X-Company
## Đang làm
- Lát 10 đã merge hết (#32 #33 #35 #36). Audit 2026-10-19 (`docs/ops/AUDIT-STATUS.md`): đợt 1–3 đã merge (#40 #41 #44), sót SEC-003 (`APP_ORIGIN` http ở production) và CODE-009 (phạm vi duyệt OT lệch ngày) → làm cùng đợt kế. Còn đợt 4 (sync log + a11y), 5 (CI/harness), 6 (tài liệu) — mỗi đợt một PR.
- `GO-NO-GO.md` = NO-GO production; MUST đạt 309 · miễn 73 · chưa 91 (chờ người/hạ tầng thật). Chưa có pháp nhân: hệ thống chỉ chạy dữ liệu mẫu (DPIA mục 0b, D-043).

## Tiếp theo
1. Agent: PR SEC-003 + CODE-009 → đợt 4 → đợt 5 → đợt 6 (`docs/ops/AUDIT-REPORT-2026-10-19.md` §5)
2. Chủ dự án: thêm `RUM_ENABLED=false` và `RETENTION_RUM_DAYS=30` vào `.env.example` (hook chặn agent đọc/ghi tệp này); import `.github/rulesets/main.json`; bật Private Vulnerability Reporting; LICENSE; quyết SEC-002 (TOTP trước pilot), DOC-001 (form ứng tuyển hay hoãn), DOC-002 (kênh thông báo thật); thành lập pháp nhân trước khi xử lý dữ liệu thật; DPIA trong 60 ngày từ ngày xử lý thật
3. Luật sư: đối chiếu Luật 91/2025, NĐ 356/2025, BLLĐ 2019, NĐ 145/2020 (mức B); HR chốt nội quy ca/OT
4. Hạ tầng thật: KMS/HSM, đích off-site, giám sát production + kênh trực, tên miền + ACME (mẫu `ops/caddy/Caddyfile`) rồi `loop resume`

## Quyết định
- D-014…D-049 ở `docs/autopilot/DECISIONS.md`; D-046 mốc release-please; D-047/D-049 allowlist ZAP 10202/20012 theo đường dẫn; D-048 duyệt kế hoạch sửa audit 6 đợt
- Bằng chứng lát 9–10 mang nhãn faithful-fixture (máy dev), không phải production
- Công cụ vận hành ghim hash ở `scripts/tools/install-tool.mjs` (OpenBao, restic, Prometheus, Alertmanager, Caddy, ZAP)

## Bàn giao phiên
- Commit cuối trên nhánh chính: `b534e35` (release 0.2.0, #25) · PR mở: không
- Lệnh kiểm nhanh: `.xtemplates/scripts/dev-task.sh gate` · `npm run -s ops:stack:drill` · `npm run -s staging:drill` · e2e cần `PW_CHROMIUM_PATH` khi máy chưa có Chromium đúng bản Playwright
- Đang chặn: không · Câu hỏi cần người: `.env.example`; ruleset; SEC-002/DOC-001/DOC-002; pháp nhân + xác nhận pháp chế; hạ tầng production
