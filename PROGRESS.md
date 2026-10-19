# PROGRESS.md — X-Company
## Đang làm
- Lát 10: T-052 KMS, T-053 off-site, T-054 Prometheus/Alertmanager (#32 đã merge), T-055 staging TLS + ZAP qua https (PR #33 — ngoại lệ cứng, chờ người merge), T-056 RUM tự host (đang làm), T-057 chốt.
- T-050 chốt lát 9 xong (GO-NO-GO cập nhật). `GO-NO-GO.md` = NO-GO production; MUST đạt 309 · miễn 73 · chưa 91 (chờ người/hạ tầng thật).

## Tiếp theo
1. Chủ dự án: merge PR #33 (chạm form đăng nhập); xem lại Release PR #25 (nay là 0.2.0, D-046); import `.github/rulesets/main.json` (thêm `ops-stack`, `staging-tls`); bật Private Vulnerability Reporting; LICENSE; DPIA trong 60 ngày từ ngày xử lý thật
2. Luật sư: đối chiếu Luật 91/2025, NĐ 356/2025, BLLĐ 2019, NĐ 145/2020 (mức B); HR chốt nội quy ca/OT
3. Hạ tầng thật: KMS/HSM, đích off-site, giám sát production + kênh trực, tên miền + ACME (mẫu `ops/caddy/Caddyfile`) rồi `loop resume`

## Quyết định
- D-014…D-047 ở `docs/autopilot/DECISIONS.md`; D-046 mốc release-please; D-047 allowlist ZAP 10202 theo đường dẫn (sau khi form chuyển POST)
- Bằng chứng lát 9–10 mang nhãn faithful-fixture (máy dev), không phải production
- Công cụ vận hành ghim hash ở `scripts/tools/install-tool.mjs` (OpenBao, restic, Prometheus, Alertmanager, Caddy, ZAP)

## Bàn giao phiên
- Nhánh làm việc `claude/amazing-bohr-8fw50g`: `main` `5f01b0f` + PR #33 (`a0d24c2`) + commit docs T-050 (chưa push để không lẫn vào PR ngoại lệ cứng)
- Lệnh kiểm nhanh: `.xtemplates/scripts/dev-task.sh gate` · `npm run -s ops:stack:drill` · `npm run -s staging:drill` · e2e cần `PW_CHROMIUM_PATH` khi máy chưa có Chromium đúng bản Playwright
- Đang chặn: không · Câu hỏi cần người: merge #33; xác nhận pháp chế; hạ tầng production
