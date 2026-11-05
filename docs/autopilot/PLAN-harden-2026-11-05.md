# docs/autopilot/PLAN-harden-2026-11-05.md — X-Company · Harden sau khung 3.30.0

> Duyệt: D-070 (phiên chính tự duyệt 2026-11-05), sửa phân loại MUST: D-071 (sau review #90) · Nguồn: `docs/ops/AUDIT-STATUS.md` (delta 8655b06..a734990), `xt.py blueprint-status BLUEPRINT.md --strict` (78 MUST mở), `GO-NO-GO.md` · Kế hoạch trước: `PLAN-lat-14.md` (lát 14–19) · Blueprint: BLUEPRINT.md

## Tóm tắt duyệt (cổng duy nhất)
- Bối cảnh: #88 nâng khung 3.15.1 → 3.30.0 (có skill `/complete`), #89 vá OSV glob/minimatch + gộp bump dependabot #84/#86/#87. Cả hai review sạch ở head (reviewer Opus + reviewer-alt Sonnet) → audit delta không còn nợ review; 0 🔴/🟠 mở.
- Audit delta 2026-11-05: 3 🟢 mới — HAR-004 (chú thích `.gitignore`), HAR-005 (lệnh Kiểm UX-VISUAL-001 đỏ oan) sửa ngay ở T-107; CI-005 (gitleaks quét toàn lịch sử hai lần/tuần) ghi nợ.
- Phân loại 78 MUST mở theo phần "Thiếu:" của từng dòng blueprint (sửa sau review #90, D-071):
  - **2 đóng hết trong repo**: OPS-DEPLOY-003 (nay đã có tag phát hành thật `v0.3.0` để làm N−1) và UX-DS-006 (kiểm glyph tiếng Việt không cần ảnh baseline) → T-108, T-109.
  - **4 agent làm được phần trong repo, MUST vẫn mở chờ người**: CMP-AUDIT-007 (sổ bên xử lý + CI chặn SDK thiếu dòng; DPA cần người), CMP-VN-004 (cột vùng/quốc gia bên xử lý trong data map + script đối chiếu; nơi đặt máy chủ cần người), WF-TEAM-003 (kiểm DoR bằng skill/script; nhãn `ready` trên GitHub cần chủ repo), SEC-TM-006 (trỏ mọi hàng Cao tới ID checklist/test; 2 rủi ro chấp nhận cần người xác nhận) → T-110…T-113.
  - **2 về cấu trúc PLAN lịch sử** (PM-PRIO-003 lát 1 phải có deploy/smoke, PM-RISK-003 rủi ro đầu có spike ở lát 1): lát 1 đã làm 2026-10, không sửa ngược lịch sử để tick; `readme-smoke` (build + start + curl) đã chạy mỗi PR; chấp nhận/miễn là việc người (`LOOP-STOP-024`).
  - **70 cần hạ tầng thật** (máy chủ, staging, kênh trực, KMS, đích off-site, IaC), **người/pháp chế** (RPO/RTO, DPIA, LICENSE, ký GO-NO-GO, kiểm tay trình đọc màn hình) hoặc **cấu hình GitHub do chủ repo** (ruleset tag, annotated tag, mô tả repo) → vẫn là việc người ở PROGRESS "Tiếp theo".
- Mỗi lát một PR ≤ 150 dòng, làn chuẩn, review khác họ model ở head; không chạm auth/mật mã/dữ liệu thật.
- Rủi ro: job `test` dài thêm ~3–4 phút (npm ci + test DB/HTTP của bản trước; timeout job 25 phút, hiện ~5 phút).

## Mục tiêu của kế hoạch này
Mọi MUST mở có phần làm được trong repo đã làm xong phần đó (2 mục đóng hẳn, 4 mục chỉ còn phần người); `release-check` chỉ còn NO-GO vì việc người/hạ tầng thật.

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
- [x] `T-107` Audit delta 8655b06..a734990: AUDIT-STATUS dời SHA quét, HAR-004/HAR-005 sửa, CI-005 ghi nợ; PLAN-harden + D-070; PROGRESS (files: docs/ops/AUDIT-STATUS.md, docs/autopilot/, BLUEPRINT.md, .gitignore, PROGRESS.md) — Gate: `python3 .xtemplates/scripts/xt.py audit check docs/ops/AUDIT-STATUS.md && python3 .xtemplates/scripts/xt.py progress-check && npm run -s check:docs && npm run -s check:repo-docs`

### Lát 21 — Tương thích bản trước (OPS-DEPLOY-003)
- [ ] `T-108` OPS-DEPLOY-003: `scripts/test-prev-release.sh` — checkout tag bản phát hành gần nhất (`.release-please-manifest.json`), thay `migrations/` bằng của HEAD, chạy test DB + HTTP của bản đó; migration đã phát hành phải còn nguyên byte; bước trong job CI `test` (files: scripts/test-prev-release.sh, .github/workflows/ci.yml, BLUEPRINT.md) — Gate: `scripts/test-prev-release.sh`

### Lát 22 — Glyph tiếng Việt (UX-DS-006)
- [ ] `T-109` UX-DS-006: e2e vẽ từng chữ có dấu (chuỗi cố định + chữ trên trang chủ) bằng đúng `font` đã tính của trang, so với glyph `.notdef` của ký tự chưa gán — trùng = tofu (files: e2e/pages.spec.ts, BLUEPRINT.md) — Gate: `npm run -s e2e -- e2e/pages.spec.ts -g UX-DS-006`

### Lát 23 — Phần trong repo của MUST còn chờ người (MUST vẫn `[ ]`, ghi rõ phần người ở "— Thiếu:")
- [ ] `T-110` CMP-AUDIT-007 (phần repo): sổ bên xử lý `docs/compliance/vendors.yaml` (dịch vụ, dữ liệu chạm, vị trí, DPA: chờ người, ngày rà) + `docs/privacy/processors.md` sinh từ sổ; script CI đỏ khi `package.json` có SDK gọi dịch vụ ngoài chưa có dòng trong sổ (files: docs/compliance/, docs/privacy/, scripts/, tests/unit/, package.json) — Gate: `npm run -s check:vendors && npm run -s test:file -- tests/unit/check-vendors.test.ts`
- [ ] `T-111` CMP-VN-004 (phần repo): data map có `region`/`processor_country` cho mọi hoạt động; lint đỏ khi thiếu hoặc khi quốc gia ≠ VN mà không trỏ hồ sơ chuyển dữ liệu (sau: T-110; files: docs/privacy/data-map.yaml, scripts/check-docs.mjs, tests/unit/) — Gate: `npm run -s check:docs && npm run -s test:file -- tests/unit/check-docs.test.ts`
- [ ] `T-112` WF-TEAM-003 (phần repo): script kiểm Definition of Ready của task PLAN (có Gate máy, có `files:`, không câu hỏi mở `[?]`) chạy trong `check:docs` (files: scripts/, tests/unit/) — Gate: `npm run -s check:docs && npm run -s test:file -- tests/unit/check-dor.test.ts`
- [ ] `T-113` SEC-TM-006 (phần repo): mọi hàng mức Cao của `docs/design/THREAT-MODEL.md` trỏ tới ID checklist khung hoặc tệp test có thật; script đỏ khi hàng Cao thiếu trỏ hoặc trỏ tệp không tồn tại (files: docs/design/THREAT-MODEL.md, scripts/, tests/unit/) — Gate: `npm run -s check:threat-model && npm run -s test:file -- tests/unit/check-threat-model.test.ts`
