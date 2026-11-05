# docs/autopilot/PLAN-harden-2026-11-05.md — X-Company · Harden sau khung 3.30.0

> Duyệt: D-070 (phiên chính tự duyệt 2026-11-05) · Nguồn: `docs/ops/AUDIT-STATUS.md` (delta 8655b06..a734990), `xt.py blueprint-status BLUEPRINT.md --strict` (78 MUST mở), `GO-NO-GO.md` · Kế hoạch trước: `PLAN-lat-14.md` (lát 14–19) · Blueprint: BLUEPRINT.md

## Tóm tắt duyệt (cổng duy nhất)
- Bối cảnh: #88 nâng khung 3.15.1 → 3.30.0 (có skill `/complete`), #89 vá OSV glob/minimatch + gộp bump dependabot #84/#86/#87. Cả hai review sạch ở head (reviewer Opus + reviewer-alt Sonnet) → audit delta không còn nợ review; 0 🔴/🟠 mở.
- Audit delta 2026-11-05: 3 🟢 mới — HAR-004 (chú thích `.gitignore`), HAR-005 (lệnh Kiểm UX-VISUAL-001 đỏ oan) sửa ngay ở T-107; CI-005 (gitleaks quét toàn lịch sử hai lần/tuần) ghi nợ.
- Phân loại 78 MUST mở theo phần "Thiếu:" của từng dòng blueprint: 76 cần hạ tầng thật (máy chủ, staging, kênh trực, KMS, đích off-site, IaC), người/pháp chế (RPO/RTO, DPIA, LICENSE, ký GO-NO-GO, kiểm tay trình đọc màn hình) hoặc cấu hình GitHub do chủ repo (ruleset tag, annotated tag, mô tả repo) → không đổi trạng thái, vẫn là việc người ở PROGRESS "Tiếp theo".
- Agent đóng được trong repo: OPS-DEPLOY-003 (nay đã có tag phát hành thật `v0.3.0` để làm N−1) và UX-DS-006 (kiểm glyph tiếng Việt không cần ảnh baseline).
- Mỗi lát một PR ≤ 150 dòng, làn chuẩn, review khác họ model ở head; không chạm auth/mật mã/dữ liệu thật.
- Rủi ro: job `test` dài thêm ~3–4 phút (npm ci + test DB/HTTP của bản trước; timeout job 25 phút, hiện ~5 phút).

## Mục tiêu của kế hoạch này
Không còn MUST nào mở mà agent làm được trong repo; `release-check` chỉ còn NO-GO vì việc người/hạ tầng thật.

## Ngân sách (4 con số)
- Số vòng tối đa: (bỏ trống — `--single-session` tự tính)
- Ngân sách: 2.000.000 token
- Timeout mỗi lệnh Gate: 1800 giây (`XT_RECORD_TIMEOUT`)
- Ngày hết hạn: `--hours 24`

## Ủy quyền production (người duyệt một lần ở đây; máy kiểm bằng `xt.py grant-check`, ADR-0022)
- grant: payments | mode=sandbox | max_per_txn=0 | refund=false
- grant: data_delete | hard_delete=false | max_rows=100
- grant: data_export | pii=false | max_rows=10000
- grant: outbound_messages | live=false | max_per_hour=0
- grant: auth_crypto | custom_crypto=false
- grant: secrets | read_values=false

## Điểm dừng bắt buộc về hành động
- Deploy, dữ liệu thật, khoá/dịch vụ trả phí: ngoài phạm vi (D-043, D-050).
- Merge Release PR (#79) = phát hành tag: người (GO-NO-GO đang NO-GO; PR do `GITHUB_TOKEN` tạo nên CI không chạy).

## Task

### Lát 20 — Sổ harden sau khung 3.30.0
- [x] `T-107` Audit delta 8655b06..a734990: AUDIT-STATUS dời SHA quét, HAR-004/HAR-005 sửa, CI-005 ghi nợ; PLAN-harden + D-070; PROGRESS (files: docs/ops/AUDIT-STATUS.md, docs/autopilot/, BLUEPRINT.md, .gitignore, PROGRESS.md) — Gate: `python3 .xtemplates/scripts/xt.py audit check docs/ops/AUDIT-STATUS.md && npm run -s check:docs && npm run -s check:repo-docs`

### Lát 21 — Tương thích bản trước (OPS-DEPLOY-003)
- [ ] `T-108` OPS-DEPLOY-003: `scripts/test-prev-release.sh` — checkout tag bản phát hành gần nhất (`.release-please-manifest.json`), thay `migrations/` bằng của HEAD, chạy test DB + HTTP của bản đó; migration đã phát hành phải còn nguyên byte; bước trong job CI `test` (files: scripts/test-prev-release.sh, .github/workflows/ci.yml, BLUEPRINT.md) — Gate: `scripts/test-prev-release.sh`

### Lát 22 — Glyph tiếng Việt (UX-DS-006)
- [ ] `T-109` UX-DS-006: e2e vẽ từng chữ có dấu (chuỗi cố định + chữ trên trang chủ) bằng đúng `font` đã tính của trang, so với glyph `.notdef` của ký tự chưa gán — trùng = tofu (files: e2e/pages.spec.ts, BLUEPRINT.md) — Gate: `npm run -s e2e -- e2e/pages.spec.ts -g UX-DS-006`
