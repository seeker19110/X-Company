# PROGRESS.md — X-Company
## Đang làm
- 2026-10-24: lát 14–15 (`docs/autopilot/PLAN-lat-14.md`, D-058…D-060) — đóng 🟠 SEC-002/DOC-001/DOC-002 mà phiên trước để chờ người (quyết định chuyên môn, AGENTS.md §5).
  - Lát 14 (T-079…T-084 xong, bằng chứng `loop record`; PR làn chuẩn): form ứng tuyển (DOC-001); thông báo trong ứng dụng tự host — bảng `notification` (0030) ghi trong giao dịch worker, `/app/thong-bao` + số chưa đọc (DOC-002); sàn tuổi xoá GPS (0031, DATA-006); CODE-010, A11Y-011, TEST-002, PERF-004 một phần; hàng rào `test:file` đỏ khi tệp test không tồn tại.
  - Lát 15 (T-085…T-088; ngoại lệ cứng auth → người merge): SEC-007 chặn thu hồi sysadmin cuối; TOTP RFC 6238 hai bước cho sysadmin/hr/executive (0032, `/api/app/auth/mfa`, `mfa:reset`), hợp đồng login đổi (D-060); giao diện bước mã + đăng ký. Làm ở nhánh cục bộ, đẩy sau khi PR lát 14 merge.
- Trước đó: lát 12–13 (D-055…D-057) ở PR #68 đã merge (`5d5f480`).
- Ruleset thật (`.github/rulesets/main.json`): required check chỉ `quality` (job tổng hợp mọi job ci.yml) + `gitleaks`, không strict; `pr-policy`, `codeql`, `merge-gate` là advisory theo ADR-0039 của khung (AUD-CI-004).
- `GO-NO-GO.md` = NO-GO production (số máy sinh ở đó). Chưa có pháp nhân: chỉ dữ liệu mẫu (DPIA mục 0b, D-043).

## Tiếp theo
1. Chủ dự án: rà và merge PR lát 15 (TOTP, ngoại lệ cứng auth) khi mở; quyết D-056 (90 ngày lưu toạ độ GPS — pháp chế); thêm 15 khoá ở `PENDING_EXAMPLE_KEYS` (`scripts/check-env.ts`, gồm `TRUST_PROXY`, `RETENTION_GEO_DAYS`) vào `.env.example` rồi xoá khỏi danh sách (hook chặn agent, D-050); import `.github/rulesets/main.json` (`quality`, `gitleaks`); bật Private Vulnerability Reporting; LICENSE; các đề xuất "Khi chạy thật" trong DECISIONS.
2. Pháp lý/HR: thành lập pháp nhân trước dữ liệu thật; DPIA trong 60 ngày từ ngày xử lý thật; luật sư đối chiếu Luật 91/2025, NĐ 356/2025, BLLĐ 2019, NĐ 145/2020; HR chốt nội quy ca/OT, lịch lễ (H02).
3. Hạ tầng thật: KMS/HSM, đích off-site, giám sát production + kênh trực, tên miền + ACME (mẫu `ops/caddy/Caddyfile`), diễn tập rollback deploy; rồi `loop resume`.
4. Agent (khi mở lát mới): 🟢 mở trong `docs/ops/AUDIT-STATUS.md` (SEC-007 sysadmin cuối, DATA-006 sàn tuổi hàm xoá GPS, A11Y-011, TEST-002, PERF-004, CODE-010…); DEP-001 TypeScript 7 khi typescript-eslint hỗ trợ.

## Quyết định
- D-014…D-057 ở `docs/autopilot/DECISIONS.md`; D-055 PLAN lát 12–13; D-056 thiết kế xoá GPS; D-057 xử lý audit delta.
- Bằng chứng hạ tầng mang nhãn faithful-fixture (máy dev), không phải production.
- Công cụ vận hành ghim hash ở `scripts/tools/install-tool.mjs` → `.tools/bin` (gitleaks, OpenBao, restic, Prometheus, Alertmanager, Caddy, ZAP); lệnh Kiểm blueprint cần `PATH=$PWD/.tools/bin:$PATH`.

## Bàn giao phiên
- Nhánh `claude/intelligent-hamilton-d4jyet` · PR mở: #68 (lát 12–13), Release 0.2.1 #52 · nhánh chính: `779926a` (#67).
- Lệnh kiểm: `.xtemplates/scripts/dev-task.sh gate` · `PATH=$PWD/.tools/bin:$PATH python3 .xtemplates/scripts/xt.py loop verify --all` (~45 phút, chạy lại mọi Gate + 316 lệnh Kiểm) · e2e cần `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
- Đang chặn: không (agent) · 3 lệnh Kiểm LOOP-* bị guard chặn trong phiên (FB-088) · Câu hỏi cần người: như mục Tiếp theo 1–3.
