# PROGRESS.md — X-Company
## Đang làm
- 2026-11-05: pha harden sau khung 3.30.0 (`docs/autopilot/PLAN-harden-2026-11-05.md`, D-070).
  - ĐÃ MERGE #89 (vá OSV glob/minimatch bằng `overrides` theo gói cha + gộp bump dependabot #84/#86/#87, đã đóng) và #88 (nâng khung 3.15.1 → 3.30.0: guard/hook chặt hơn, skill `/complete`…); cả hai review sạch ở head (reviewer Opus + reviewer-alt Sonnet).
  - Lát 20 (T-107): audit delta 8655b06..a734990 — không nợ review, 0 🔴/🟠; HAR-004/HAR-005 🟢 đã sửa (lệnh Kiểm UX-VISUAL-001 đỏ oan vì chữ trong chú thích), CI-005/CI-006 🟢 mở. ĐÃ MERGE #90.
  - Lát 21 (T-108) OPS-DEPLOY-003: `scripts/test-prev-release.sh` chạy test DB+HTTP của tag phát hành trước trên schema HEAD, bước trong job CI `test`; OPS-DEPLOY-003 tick (kiểm chứng đỏ bằng migration đổi tên cột). ĐÃ MERGE #91 (sửa 🔴 review: chọn N−1 đúng trên Release PR/commit phát hành).
  - Lát 22 (T-109) UX-DS-006: e2e kiểm glyph chữ Việt — vế 1 so ảnh `"Họ", serif`/`"Họ", monospace` cho face của font chính (nạp an toàn, theo weight/style, 134 chữ), vế 2 so `.notdef` của noncharacter. ĐÃ MERGE #92, #95, #96 (3 vòng review opus-max: 0 🔴, 3 🟠 đã sửa — TEST-008/010; 🟢 TEST-011 mở).
  - Lát 23 (T-110…T-113) ĐÃ MERGE #99 (2026-11-06): `check:vendors`, data map + chuyển ra ngoài VN, DoR, `check:threat-model`; kèm sửa `backup.sh` đặt tên bằng EPOCHREALTIME (uutils 0.10.0 của runner ubuntu-26.04 làm `%3N` sai → xoá nhầm bản mới) và bước N−1 bỏ qua đúng test đó của v0.3.0 (D-074). MUST CMP-AUDIT-007/CMP-VN-004/WF-TEAM-003/SEC-TM-006 chờ phần người.
  - Lát 24–27 (PR mới, autopilot 2026-11-06): T-114 ruleset tag + asset/SHA256SUMS release · T-115 cơ sở dữ liệu nhạy cảm + xét mọi bên ngoài VN · T-116 kho tệp S3 tự host (SigV4 tự viết, rclone fixture, D-073) + e2e 2 bản sao · T-118 DATABASE_URL production sslmode=verify-full · T-119 bảng quyền GITHUB_TOKEN sinh từ workflow · T-120 chính sách seed staging · T-123 ngân sách job/phút CI mỗi PR · T-124 retention-days, bỏ gitleaks trùng · T-125 xoá blob sau commit qua outbox (DB-TX-003) · T-127 RUNBOOK rollback về backup.sh cũ (AUD-DATA-011 🟠 chờ bản phát hành). Thêm: transport KMS dùng chung qua globalThis (cùng lỗi bundle Next T-116 bắt được).
  - Đang chạy (executor-deep, worktree): T-121 xoá tài khoản tự phục vụ (D-075, ngoại lệ cứng — người merge), T-122 bộ thu lỗi tự host, T-126 sao lưu/xoay khoá tệp trên S3 → PR riêng.
  - #79 (Release PR 0.3.1): người — PR do `GITHUB_TOKEN` tạo nên CI không chạy (`gitleaks` không có `workflow_dispatch`); merge = gắn tag phát hành.
- Trước đó: lát 14–19 ĐÃ MERGE (#73–#78, #80–#82): TOTP, form ứng tuyển, thông báo tự host, sàn tuổi xoá GPS, autovacuum, `check:github`, `check:lib-writes`, bộ đếm sai bỏ qua IP quen.
- Ruleset thật (`.github/rulesets/main.json`): required check chỉ `quality` (job tổng hợp mọi job ci.yml) + `gitleaks`, không strict; `pr-policy`, `codeql`, `merge-gate` là advisory theo ADR-0039 của khung (AUD-CI-004).
- `GO-NO-GO.md` = NO-GO production (số máy sinh ở đó). Chưa có pháp nhân: chỉ dữ liệu mẫu (DPIA mục 0b, D-043).

## Tiếp theo
1. Chủ dự án: quyết #79 (Release 0.3.1 — cần cho CI chạy: đóng/mở lại bằng tay hoặc cấp PAT cho release-please); chạy 3 lệnh Kiểm LOOP-ORCH-003/LOOP-STOP-001/LOOP-STOP-002 ngoài phiên (FB-088); quyết D-056 (90 ngày lưu toạ độ GPS — pháp chế); xoá `DSAR_DAYS` khỏi `.env.example`; áp bản vá TEST-005; LICENSE; các đề xuất "Khi chạy thật" trong DECISIONS.
2. Pháp lý/HR: thành lập pháp nhân trước dữ liệu thật; DPIA trong 60 ngày từ ngày xử lý thật; luật sư đối chiếu Luật 91/2025, NĐ 356/2025, BLLĐ 2019, NĐ 145/2020; HR chốt nội quy ca/OT, lịch lễ (H02).
3. Hạ tầng thật (60 MUST blueprint còn mở chỉ cần nó hoặc người; thêm 2 mục cấu trúc PLAN lát 1 chờ chấp nhận/miễn và phần người của các mục lát 23–26 — D-072, T-117): KMS/HSM, đích off-site, giám sát production + kênh trực, tên miền + ACME (mẫu `ops/caddy/Caddyfile`), staging/IaC, diễn tập rollback deploy; ruleset tag `v*` + annotated tag; rồi `loop resume`.
4. Agent: gộp T-121/T-122/T-126 (PR riêng); audit delta sau lát 27; 🟢 mở ở AUDIT-STATUS (CODE-012, DATA-010…); khoá env mới chờ thêm vào `.env.example` (`FILE_STORAGE`, `S3_*` — `PENDING_EXAMPLE_KEYS`); DEP-001 TypeScript 7 khi typescript-eslint hỗ trợ (8.72.1 vẫn peer `<6.1.0`); gỡ `overrides` glob/minimatch khi gói cha tự dùng bản vá; ARCH-005 trước task kênh SMTP/Web Push.

## Quyết định
- D-014…D-075 ở `docs/autopilot/DECISIONS.md`; D-056 thiết kế xoá GPS (chờ pháp chế); D-070…D-072 PLAN-harden 2026-11-05 (phân loại MUST mở); D-073 S3 tự host; D-074 N−1 KNOWN_FIXED; D-075 phạm vi xoá tài khoản tự phục vụ.
- Bằng chứng hạ tầng mang nhãn faithful-fixture (máy dev), không phải production.
- Công cụ vận hành ghim hash ở `scripts/tools/install-tool.mjs` → `.tools/bin` (gitleaks, OpenBao, restic, Prometheus, Alertmanager, Caddy, ZAP); lệnh Kiểm blueprint cần `PATH=$PWD/.tools/bin:$PATH`.

## Bàn giao phiên
- Nhánh `claude/amazing-darwin-wd2wb4` · nhánh chính: `60359c4` (#99) · vòng autopilot: bật (single-session, PLAN-harden-2026-11-05).
- Lệnh kiểm: `.xtemplates/scripts/dev-task.sh gate` (cần `node scripts/tools/install-tool.mjs install restic openbao` cho test off-site/KMS) · `PATH=$PWD/.tools/bin:$PATH python3 .xtemplates/scripts/xt.py loop verify --all` (~45 phút) · e2e cần `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`.
- Đang chặn: không (agent) · Câu hỏi cần người: như mục Tiếp theo 1–3.
