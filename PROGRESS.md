# PROGRESS.md — X-Company
## Đang làm
- 2026-10-22: lát 12–13 (`docs/autopilot/PLAN-lat-12.md`, D-055…D-057) — T-065…T-077 xong, có bằng chứng `loop record`; ở PR #68 (ngoại lệ cứng: quyền, migration 0029 → người merge). T-078 (`release-check` + GO-NO-GO) chạy được nhưng NO-GO vì MUST chờ người/hạ tầng thật → `loop defer`.
  - Lát 12: SEC-005 grant tự kiểm `access.manage` + `SYSTEM_ACTOR`; DATA-003 xoá toạ độ GPS có kiểm soát (0029, `RETENTION_GEO_DAYS` 90 giả định); PERF-001 kịch bản chốt kỳ 200×31 (4,2–6,4 s, 25 SQL); PERF-003 báo cáo tải chỉ từ cây sạch; JS tĩnh 229,7 → 225,6 KB; A11Y-007/008/009; TEST-001 50/50 lượt dưới tải.
  - Lát 13 (harden): `delivery_phase: harden`; audit delta 3 reviewer (D-057) — 0 🔴, 4 🟠 (A11Y-010 nhánh SW chết, DOC-008 tài liệu lệch ruleset, SEC-006 hạ 🟢, DATA-005 cô lập lỗi retention) đã sửa; 🟢 mới ghi sổ.
- Ruleset thật (`.github/rulesets/main.json`): required check chỉ `quality` (job tổng hợp mọi job ci.yml) + `gitleaks`, không strict; `pr-policy`, `codeql`, `merge-gate` là advisory theo ADR-0039 của khung (AUD-CI-004).
- `GO-NO-GO.md` = NO-GO production (số máy sinh ở đó). Chưa có pháp nhân: chỉ dữ liệu mẫu (DPIA mục 0b, D-043).

## Tiếp theo
1. Chủ dự án: rà và merge PR #68 (ngoại lệ cứng); quyết D-056 (90 ngày lưu toạ độ GPS — pháp chế); thêm 15 khoá ở `PENDING_EXAMPLE_KEYS` (`scripts/check-env.ts`, gồm `TRUST_PROXY`, `RETENTION_GEO_DAYS`) vào `.env.example` rồi xoá khỏi danh sách (hook chặn agent, D-050); import `.github/rulesets/main.json` (`quality`, `gitleaks`); bật Private Vulnerability Reporting; LICENSE; quyết SEC-002 (TOTP trước pilot), DOC-001, DOC-002; các đề xuất "Khi chạy thật" trong DECISIONS.
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
