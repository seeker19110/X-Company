# PROGRESS.md — X-Company
## Đang làm
- 2026-11-05: pha harden sau khung 3.30.0 (`docs/autopilot/PLAN-harden-2026-11-05.md`, D-070).
  - ĐÃ MERGE #89 (vá OSV glob/minimatch bằng `overrides` theo gói cha + gộp bump dependabot #84/#86/#87, đã đóng) và #88 (nâng khung 3.15.1 → 3.30.0: guard/hook chặt hơn, skill `/complete`…); cả hai review sạch ở head (reviewer Opus + reviewer-alt Sonnet).
  - Lát 20 (T-107): audit delta 8655b06..a734990 — không nợ review, 0 🔴/🟠; HAR-004/HAR-005 🟢 đã sửa (lệnh Kiểm UX-VISUAL-001 đỏ oan vì chữ trong chú thích), CI-005/CI-006 🟢 mở. ĐÃ MERGE #90.
  - Lát 21 (T-108) OPS-DEPLOY-003: `scripts/test-prev-release.sh` chạy test DB+HTTP của tag phát hành trước trên schema HEAD, bước trong job CI `test`; OPS-DEPLOY-003 tick (kiểm chứng đỏ bằng migration đổi tên cột). ĐÃ MERGE #91 (sửa 🔴 review: chọn N−1 đúng trên Release PR/commit phát hành).
  - Lát 22 (T-109) UX-DS-006: e2e kiểm glyph chữ Việt — vế 1 so ảnh `"Họ", serif`/`"Họ", monospace` cho face của font chính (nạp an toàn, theo weight/style, 134 chữ), vế 2 so `.notdef` của noncharacter. ĐÃ MERGE #92, #95, #96 (3 vòng review opus-max: 0 🔴, 3 🟠 đã sửa — TEST-008/010; 🟢 TEST-011 mở).
  - Lát 23 (T-110…T-113) XONG ở #99 (autopilot 2026-11-06): `check:vendors` (sổ bên xử lý, mọi gói dependencies phải phân loại — sửa 🔴 review), data map gắn nơi lưu + đối chiếu chuyển ra ngoài VN, DoR cho task PLAN trong `check:docs`, `check:threat-model` trong CI. MUST CMP-AUDIT-007/CMP-VN-004/WF-TEAM-003/SEC-TM-006 vẫn chờ phần người (DPA, nơi đặt máy chủ, nhãn ready, xác nhận T20/T21). #98 nâng khung 3.31.0 đã merge.
  - Lát 24 (T-114…T-117): WF-REL-003 (ruleset tag + asset/checksum release), CMP-INTL-002 (lint cơ sở dữ liệu nhạy cảm); T-117 xong — 8 MUST phân loại lại: 7 có phần repo → lát 26 (T-118…T-124), OPS-MAINT-004 chỉ còn phần người; lát 25 (T-116) ARC-RES-005 kho tệp S3 tự host + e2e 2 bản sao.
  - #79 (Release PR 0.3.1): người — PR do `GITHUB_TOKEN` tạo nên CI không chạy (`gitleaks` không có `workflow_dispatch`); merge = gắn tag phát hành.
- Trước đó: lát 14–19 ĐÃ MERGE (#73–#78, #80–#82): TOTP, form ứng tuyển, thông báo tự host, sàn tuổi xoá GPS, autovacuum, `check:github`, `check:lib-writes`, bộ đếm sai bỏ qua IP quen.
- Ruleset thật (`.github/rulesets/main.json`): required check chỉ `quality` (job tổng hợp mọi job ci.yml) + `gitleaks`, không strict; `pr-policy`, `codeql`, `merge-gate` là advisory theo ADR-0039 của khung (AUD-CI-004).
- `GO-NO-GO.md` = NO-GO production (số máy sinh ở đó). Chưa có pháp nhân: chỉ dữ liệu mẫu (DPIA mục 0b, D-043).

## Tiếp theo
1. Chủ dự án: quyết #79 (Release 0.3.1 — cần cho CI chạy: đóng/mở lại bằng tay hoặc cấp PAT cho release-please); chạy 3 lệnh Kiểm LOOP-ORCH-003/LOOP-STOP-001/LOOP-STOP-002 ngoài phiên (FB-088); quyết D-056 (90 ngày lưu toạ độ GPS — pháp chế); xoá `DSAR_DAYS` khỏi `.env.example`; áp bản vá TEST-005; LICENSE; các đề xuất "Khi chạy thật" trong DECISIONS.
2. Pháp lý/HR: thành lập pháp nhân trước dữ liệu thật; DPIA trong 60 ngày từ ngày xử lý thật; luật sư đối chiếu Luật 91/2025, NĐ 356/2025, BLLĐ 2019, NĐ 145/2020; HR chốt nội quy ca/OT, lịch lễ (H02).
3. Hạ tầng thật (60 MUST blueprint còn mở chỉ cần nó hoặc người; thêm 2 mục cấu trúc PLAN lát 1 chờ chấp nhận/miễn và phần người của các mục lát 23–26 — D-072, T-117): KMS/HSM, đích off-site, giám sát production + kênh trực, tên miền + ACME (mẫu `ops/caddy/Caddyfile`), staging/IaC, diễn tập rollback deploy; ruleset tag `v*` + annotated tag; rồi `loop resume`.
4. Agent (khi mở lát mới): lát 23–26 của PLAN-harden (T-110…T-124, ưu tiên T-118 sslmode, T-124 retention CI); CI-005 bỏ `gitleaks-history` trùng ở maintenance.yml; DEP-001 TypeScript 7 khi typescript-eslint hỗ trợ (8.72.1 vẫn peer `<6.1.0`); gỡ `overrides` glob/minimatch khi gói cha tự dùng bản vá; ARCH-005 trước task kênh SMTP/Web Push.

## Quyết định
- D-014…D-072 ở `docs/autopilot/DECISIONS.md`; D-056 thiết kế xoá GPS (chờ pháp chế); D-070…D-072 PLAN-harden 2026-11-05 (phân loại MUST mở).
- Bằng chứng hạ tầng mang nhãn faithful-fixture (máy dev), không phải production.
- Công cụ vận hành ghim hash ở `scripts/tools/install-tool.mjs` → `.tools/bin` (gitleaks, OpenBao, restic, Prometheus, Alertmanager, Caddy, ZAP); lệnh Kiểm blueprint cần `PATH=$PWD/.tools/bin:$PATH`.

## Bàn giao phiên
- Nhánh `claude/amazing-darwin-wd2wb4` · nhánh chính: `031136f` (#96; trước đó #94 nâng khung 3.30.1) · vòng autopilot: chưa bật lại sau nâng khung (PLAN-harden làm tay theo `/complete`).
- Lệnh kiểm: `.xtemplates/scripts/dev-task.sh gate` (cần `node scripts/tools/install-tool.mjs install restic openbao` cho test off-site/KMS) · `PATH=$PWD/.tools/bin:$PATH python3 .xtemplates/scripts/xt.py loop verify --all` (~45 phút) · e2e cần `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`.
- Đang chặn: không (agent) · Câu hỏi cần người: như mục Tiếp theo 1–3.
