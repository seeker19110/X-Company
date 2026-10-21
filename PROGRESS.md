# PROGRESS.md — X-Company
## Đang làm
- Lát 10 xong về phía agent: T-052 KMS, T-053 off-site, T-054 Prometheus/Alertmanager (#32), T-055 staging TLS + ZAP qua https (PR #33), T-056 RUM tự host (PR #35), T-057 chốt (PR này). #33 và #35 là ngoại lệ cứng (form đăng nhập, migration) — chờ người merge.
- `GO-NO-GO.md` = NO-GO production; MUST đạt 309 · miễn 73 · chưa 91 (chờ người/hạ tầng thật). Chưa có pháp nhân: hệ thống chỉ chạy dữ liệu mẫu (DPIA mục 0b, D-043).

## Tiếp theo
1. Chủ dự án: merge PR #33 và #35 (ngoại lệ cứng); thêm `RUM_ENABLED=false` và `RETENTION_RUM_DAYS=30` vào `.env.example` (hook chặn agent đọc/ghi tệp này); xem lại Release PR #25 (nay là 0.2.0, D-046); thành lập pháp nhân trước khi xử lý dữ liệu thật; import `.github/rulesets/main.json` (thêm `ops-stack`, `staging-tls`); bật Private Vulnerability Reporting; LICENSE; DPIA trong 60 ngày từ ngày xử lý thật
2. Luật sư: đối chiếu Luật 91/2025, NĐ 356/2025, BLLĐ 2019, NĐ 145/2020 (mức B); HR chốt nội quy ca/OT
3. Hạ tầng thật: KMS/HSM, đích off-site, giám sát production + kênh trực, tên miền + ACME (mẫu `ops/caddy/Caddyfile`) rồi `loop resume`

## Quyết định
- D-014…D-047 ở `docs/autopilot/DECISIONS.md`; D-046 mốc release-please; D-047 allowlist ZAP 10202 theo đường dẫn (sau khi form chuyển POST)
- Bằng chứng lát 9–10 mang nhãn faithful-fixture (máy dev), không phải production
- Công cụ vận hành ghim hash ở `scripts/tools/install-tool.mjs` (OpenBao, restic, Prometheus, Alertmanager, Caddy, ZAP)

## Bàn giao phiên
- Commit cuối trên nhánh chính: `5ad442d` (#34) · các PR lát 10 còn lại: #33, #35, #36 (T-057)
- Lệnh kiểm nhanh: `.xtemplates/scripts/dev-task.sh gate` · `npm run -s ops:stack:drill` · `npm run -s staging:drill` · e2e cần `PW_CHROMIUM_PATH` khi máy chưa có Chromium đúng bản Playwright
- Đang chặn: không · Câu hỏi cần người: merge #33/#35; `.env.example`; pháp nhân + xác nhận pháp chế; hạ tầng production
