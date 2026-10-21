# PROGRESS.md — X-Company
## Đang làm
- 2026-10-21: khung 3.12.0 (CI/ruleset tối thiểu, song song tối đa): `quality` nối tiếp 8m02s tách thành typecheck · lint · build · checks · test · coverage chạy cùng lúc, `quality` thành job tổng hợp mọi job (kể cả `dast-probes`, `dep-audit`); ruleset 13 → 4 check (`quality`, `gitleaks`, `merge-gate`, `pr-policy`), không strict — chủ dự án import lại ruleset.
- Audit 2026-10-19 (`docs/ops/AUDIT-STATUS.md`): đợt 1–4 đã merge (#40 #41 #44 #49 #50), #53 sửa hồi quy focus của #50; đợt 5 (CI/harness) ở PR #54; còn đợt 6 (tài liệu). 🟠 còn mở: SEC-002, DOC-001, DOC-002 (chờ người quyết), CFG-001 (chờ người thêm khoá).
- `GO-NO-GO.md` = NO-GO production; MUST đạt 309 · miễn 73 · chưa 91 (chờ người/hạ tầng thật). Chưa có pháp nhân: hệ thống chỉ chạy dữ liệu mẫu (DPIA mục 0b, D-043).

## Tiếp theo
1. Agent: đợt 6 (`docs/ops/AUDIT-REPORT-2026-10-19.md` §5); AUD-A11Y-009 (cần giảm JS trước, ngân sách 230 KB còn ~0,4)
2. Chủ dự án: thêm 14 khoá ở `PENDING_EXAMPLE_KEYS` (`scripts/check-env.ts`) vào `.env.example` rồi xoá khỏi danh sách (hook chặn agent đọc/ghi tệp này, D-050); import lại `.github/rulesets/main.json` (thêm `codeql`, `osv-scanner`); bật Private Vulnerability Reporting; LICENSE; quyết SEC-002 (TOTP trước pilot), DOC-001 (form ứng tuyển hay hoãn), DOC-002 (kênh thông báo thật); thành lập pháp nhân trước khi xử lý dữ liệu thật; DPIA trong 60 ngày từ ngày xử lý thật
3. Luật sư: đối chiếu Luật 91/2025, NĐ 356/2025, BLLĐ 2019, NĐ 145/2020 (mức B); HR chốt nội quy ca/OT
4. Hạ tầng thật: KMS/HSM, đích off-site, giám sát production + kênh trực, tên miền + ACME (mẫu `ops/caddy/Caddyfile`) rồi `loop resume`

## Quyết định
- D-014…D-050 ở `docs/autopilot/DECISIONS.md`; D-046 mốc release-please; D-047/D-049 allowlist ZAP 10202/20012 theo đường dẫn; D-048 duyệt kế hoạch sửa audit 6 đợt; D-050 độ lệch đã biết chờ người nằm trong danh sách có tên
- Bằng chứng lát 9–10 mang nhãn faithful-fixture (máy dev), không phải production
- Công cụ vận hành ghim hash ở `scripts/tools/install-tool.mjs` (OpenBao, restic, Prometheus, Alertmanager, Caddy, ZAP)

## Bàn giao phiên
- Commit cuối trên nhánh chính: `66880aa` (#50) · PR mở: #53, #54, Release 0.2.1 #52
- Lệnh kiểm nhanh: `.xtemplates/scripts/dev-task.sh gate` · `npm run -s ops:stack:drill` · `npm run -s staging:drill` · e2e cần `PW_CHROMIUM_PATH` khi máy chưa có Chromium đúng bản Playwright
- Đang chặn: không · Câu hỏi cần người: `.env.example` (14 khoá); import lại ruleset; SEC-002/DOC-001/DOC-002; pháp nhân + xác nhận pháp chế; hạ tầng production
