# PROGRESS.md — X-Company
## Đang làm
- 2026-10-25: lát 18–19 (`docs/autopilot/PLAN-lat-14.md`, D-067…D-069) — 🟢 còn mở agent làm được sau #80.
  - Lát 18 ĐÃ MERGE #81 (review reviewer-alt: 1 🟠 export dạng lạ đã sửa — `check:lib-writes` fail-closed).
  - Lát 18 (làn chuẩn): SEC-005 `check:lib-writes` trong `check:arch` (tệp gọi hàm ghi `lib/org`/`lib/cms` phải kiểm quyền cùng tệp, export mới mặc định là ghi); HAR-003 bằng chứng blueprint trích chuỗi thay số dòng + `check:docs` đỏ khi còn `tệp:N`; CFG-003 xác nhận đã sửa.
  - Lát 19 — PR #82 (ngoại lệ cứng auth, người merge): SEC-006 — bộ đếm 50 lần sai/email bỏ qua IP đã đăng nhập thành công email đó trong 30 ngày (D-068).
  - Không làm: DEP-001 (typescript-eslint peer `typescript <6.1.0`, 2026-10-25), TEST-005 (guard chặn, FB-094 — bản vá cho người áp), ARCH-005 (chỉ khi có kênh thật), CI-004 (khung), CFG-002 (hook chặn đọc `.env.example`).
- Trước đó: lát 14–17 ĐÃ MERGE (#73–#78, #80): TOTP, form ứng tuyển, thông báo tự host, sàn tuổi xoá GPS, autovacuum, `check:github`; CFG-001 đóng; SHA quét audit `6f49a0b`.
- Ruleset thật (`.github/rulesets/main.json`): required check chỉ `quality` (job tổng hợp mọi job ci.yml) + `gitleaks`, không strict; `pr-policy`, `codeql`, `merge-gate` là advisory theo ADR-0039 của khung (AUD-CI-004).
- `GO-NO-GO.md` = NO-GO production (số máy sinh ở đó). Chưa có pháp nhân: chỉ dữ liệu mẫu (DPIA mục 0b, D-043).

## Tiếp theo
1. Chủ dự án: rà và merge PR #82 lát 19 (SEC-006, ngoại lệ cứng auth); quyết D-056 (90 ngày lưu toạ độ GPS — pháp chế); xoá `DSAR_DAYS` khỏi `.env.example` (`PENDING_REMOVAL_KEYS`); áp bản vá TEST-005 (`scripts/kms-dev.sh`, cổng 20000–29999); LICENSE; các đề xuất "Khi chạy thật" trong DECISIONS.
2. Pháp lý/HR: thành lập pháp nhân trước dữ liệu thật; DPIA trong 60 ngày từ ngày xử lý thật; luật sư đối chiếu Luật 91/2025, NĐ 356/2025, BLLĐ 2019, NĐ 145/2020; HR chốt nội quy ca/OT, lịch lễ (H02).
3. Hạ tầng thật: KMS/HSM, đích off-site, giám sát production + kênh trực, tên miền + ACME (mẫu `ops/caddy/Caddyfile`), diễn tập rollback deploy; rồi `loop resume`.
4. Agent (khi mở lát mới): TEST-006 e2e AT09 chập chờn (bắt dấu vết `focusin` lúc đỏ); DEP-001 TypeScript 7 khi typescript-eslint hỗ trợ; ARCH-005 trước task kênh SMTP/Web Push; PERF-004 phần RUM nhiều beacon khi bật RUM.

## Quyết định
- D-014…D-069 ở `docs/autopilot/DECISIONS.md`; D-056 thiết kế xoá GPS (chờ pháp chế); D-067…D-069 lát 18–19.
- Bằng chứng hạ tầng mang nhãn faithful-fixture (máy dev), không phải production.
- Công cụ vận hành ghim hash ở `scripts/tools/install-tool.mjs` → `.tools/bin` (gitleaks, OpenBao, restic, Prometheus, Alertmanager, Caddy, ZAP); lệnh Kiểm blueprint cần `PATH=$PWD/.tools/bin:$PATH`.

## Bàn giao phiên
- Nhánh `claude/relaxed-archimedes-jn0ef9` · nhánh chính: `ed9fc56` (#80).
- Lệnh kiểm: `.xtemplates/scripts/dev-task.sh gate` · `PATH=$PWD/.tools/bin:$PATH python3 .xtemplates/scripts/xt.py loop verify --all` (~45 phút, chạy lại mọi Gate + 316 lệnh Kiểm) · e2e cần `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`; công cụ: `node scripts/tools/install-tool.mjs install <tên>`.
- Đang chặn: không (agent) · 3 lệnh Kiểm LOOP-* bị guard chặn trong phiên (FB-088) · Câu hỏi cần người: như mục Tiếp theo 1–3.
