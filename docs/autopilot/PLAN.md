# docs/autopilot/PLAN.md — X-Company · P0 lõi (website, điều hành nội bộ, PWA)

> Duyệt: D-006 (phiên chính tự duyệt 2026-10-18) · Spec: docs/specs/SPEC-{identity-org,website-cms,attendance,work,pwa}.md (F-001…F-012) · Blueprint: BLUEPRINT.md · Đầu vào: docs/input/ke-hoach-website-webapp-pwa.md · F01: docs/g0/F01-xboss-audit.md

## Tóm tắt duyệt (cổng duy nhất)
- Blueprint `web-app` quy mô M: 469 MUST (BLUEPRINT.md) · 1.314 SHOULD (BLUEPRINT-BACKLOG.md); tick dần theo lát kèm `— Kiểm:`.
- Stack (ADR-0001, D-002): Next.js 16.4.2 · React 19.3.1 · TypeScript 6.0.3 · pg 8.23.1 SQL thuần · PostgreSQL 17 (chạy được 16) · node:test + tsx 4.23 + c8 12 · Playwright 1.64 · ESLint 10.13 · Prettier 3.9 · Argon2id @node-rs/argon2 2.2.2 · Node ≥ 22.12 (prod 24 LTS).
- Nền mã: repo mới, chép có chọn lọc hạ tầng XBOSS (D-001) — XBOSS không làm nền vì nghiệp vụ thi công (F01).
- 24 task / 7 lát; mỗi lát một PR; Gate là lệnh test cụ thể; test DB chạy trên Postgres thật (không skip).
- Rủi ro chính: RK-001 quy tắc ca/OT chưa được HR chốt (giá trị ⚙ là cấu hình có ngày hiệu lực) · RK-002 GPS/QR hiện trường · RK-003 nợ mang theo khi chép XBOSS · RK-004 khối lượng P0 lớn hơn một phiên — lát xếp theo rủi ro, phần chưa xong ghi rõ ở báo cáo.
- Ngoài phạm vi phiên này: pilot thật, dữ liệu thật, thiết bị thật (AT13, Q02), đo tải trên hạ tầng thật (AT14), restore (AT15), DPIA — cần người.
- Điểm dừng: merge PR ngoại lệ cứng (auth, mật mã, dữ liệu người dùng — `merge_hard_exceptions: human`) → người merge.

## Mục tiêu của kế hoạch này
Một ứng dụng chạy được end-to-end trên Postgres thật: website đọc CMS đã duyệt và nhận liên hệ thành hồ sơ (AT01);
đăng nhập, tổ chức và phân quyền kiểm ở server (AT02, AT12); chấm công chống trùng, ca qua đêm, nghỉ/OT/sửa công có
duyệt, khoá kỳ và xuất (AT03–AT08); công việc–nghiệm thu–tiến độ (AT09–AT11); PWA có hàng chờ ngoại tuyến (AT05).
Đo được bằng: bộ test kịch bản S-* xanh trong CI + `blueprint-status --run`.

## Ngân sách (4 con số)
- Số vòng tối đa: (bỏ trống — `--single-session` tự tính max(40, 8 × task chưa làm))
- Ngân sách: 12.000.000 token
- Timeout mỗi lệnh Gate: 1800 giây (`XT_RECORD_TIMEOUT`)
- Ngày hết hạn: 2026-10-20T06:00:00Z (`--hours 48`)

## Hạn
| Loại | Ngày | Hậu quả nếu trễ | Cách xử lý khi trễ |
|---|---|---|---|
| Hạn thật | (chưa có — kế hoạch tính từ T0 khi có đầu mối nghiệp vụ) | — | — |
| Hạn mong muốn | 2026-10-20 | nội bộ phiên | cắt lát 7 → backlog, không hạ cổng |

## Ủy quyền production (người duyệt một lần ở đây; máy kiểm bằng `xt.py grant-check`, ADR-0022)
- grant: payments | mode=sandbox | max_per_txn=0 | refund=false
- grant: data_delete | hard_delete=false | max_rows=100
- grant: data_export | pii=false | max_rows=10000
- grant: outbound_messages | live=false | max_per_hour=0
- grant: auth_crypto | custom_crypto=false
- grant: secrets | read_values=false

## Điểm dừng bắt buộc về hành động
- Xoá/đổi/xuất dữ liệu người dùng thật, migration phá vỡ trên production, drop cột/bảng
- Tiền thật, đăng ký dịch vụ trả phí/nhập khoá thật, gửi tin tới người dùng thật
- Merge PR ngoại lệ cứng (`merge-check` = `hard`: auth, mật mã, dữ liệu người dùng, bí mật) khi `merge_hard_exceptions: human`
- Bật thu GPS/ảnh trên dữ liệu thật trước khi có DPIA và xác nhận của HR/pháp chế (§12)
- Import ruleset `.github/rulesets/main.json` lên GitHub (ghi ruleset qua `gh api` bị guard chặn — người làm trong Settings)
- (Deploy/publish, sửa CI/hook kèm lý do, thêm phụ thuộc: không dừng. Spec hở: tự quyết, `loop decide`.)

## Thứ tự & lý do
1. Lát 1 — Nền: công cụ, DB thật, CI — mọi lát sau cần cổng thật.
2. Lát 2 — Danh tính, tổ chức, quyền, audit — mọi nghiệp vụ dựa vào `can()` và audit (rủi ro rò dữ liệu cao nhất).
3. Lát 4 — Chấm công trước website vì là rủi ro nghiệp vụ lớn nhất (RK-001) và G2 kế hoạch đòi luồng tới khoá kỳ; nhưng website (lát 3) nhỏ và độc lập nên làm xen trước để có giá trị sớm (mốc tuần 4–6).
4. Lát 5 — Công việc/nghiệm thu/tiến độ; lát 6 — PWA (cần API chấm công + task); lát 7 — dashboard + E2E đầy đủ.

## Task

### Lát 1 — Nền (F-000)
- [x] `T-001` Khởi tạo Next.js + TS strict + ESLint + Prettier + node:test/c8; điền xt.yaml lệnh thật (F-000) — Gate: `.xtemplates/scripts/dev-task.sh gate`
- [x] `T-002` Postgres thật cho test (`scripts/with-test-db.sh`), migration runner append-only + checksum, role ứng dụng không superuser/BYPASSRLS (F-000) — Gate: `npm run -s test:file -- tests/db/migrate.test.ts`
- [x] `T-003` CI: job quality (gate + coverage + format_check), protection-guard, gitleaks, dep-audit; ghim SHA action (F-000) — Gate: `python3 .xtemplates/scripts/xt.py ci-check .github/workflows`

### Lát 2 — Danh tính, tổ chức, quyền, audit (F-001, F-002)
- [x] `T-004` audit_event chỉ thêm + chuỗi băm + `verify-audit-chain` (S-ID-08) — Gate: `npm run -s test:file -- tests/db/audit.test.ts`
- [x] `T-005` Tổ chức: company/branch/department (cây, chặn chu trình)/worksite/employee/employment_history hiệu lực theo khoảng — Gate: `npm run -s test:file -- tests/db/org.test.ts`
- [x] `T-006` `can()` thuần + role_grant + phạm vi cây phòng ban, R1–R7 (S-ID-01..04, 06) — Gate: `npm run -s test:file -- tests/unit/authz.test.ts tests/db/authz-scope.test.ts`
- [x] `T-007` Đăng nhập Argon2id, phiên băm, CSRF, rate limit, thu hồi tức thì (S-ID-05, 07, 09) — Gate: `npm run -s test:file -- tests/http/auth.test.ts`

### Lát 3 — Website, CMS, liên hệ (F-003)
- [x] `T-008` CMS: trang/phiên bản, luồng nháp→duyệt→xuất bản, người duyệt ≠ tác giả, markdown an toàn (S-WEB-02, 03, 06) — Gate: `npm run -s test:file -- tests/db/cms.test.ts`
- [x] `T-009` Trang công khai đọc bản published + sitemap/robots/redirect (S-WEB-02) — Gate: `npm run -s test:file -- tests/http/public-site.test.ts`
- [x] `T-010` Liên hệ & tuyển dụng: một hồ sơ/submission_id, định tuyến, honeypot, rate limit, tách quyền ứng viên (S-WEB-01, 04, 05) — Gate: `npm run -s test:file -- tests/http/inquiry.test.ts`

### Lát 4 — Chấm công (F-004, F-005, F-006)
- [x] `T-011` `computeShift` thuần: ca qua đêm, nhiều cặp, chồng lấn, nghỉ, thiếu checkout, segments (S-AT-01, 02) — Gate: `npm run -s test:file -- tests/unit/compute-shift.test.ts`
- [x] `T-012` Sự kiện công chống trùng + QR ký HMAC + lệch giờ/offline (S-AT-03..06, 09) — Gate: `npm run -s test:file -- tests/http/attendance-events.test.ts`
- [x] `T-013` Nghỉ phép sổ biến động + OT hạn mức đồng thời + phê duyệt không tự duyệt (S-AT-08) — Gate: `npm run -s test:file -- tests/db/leave-ot.test.ts`
- [x] `T-014` Sửa công có duyệt + kỳ công 5 trạng thái + khoá + xuất CSV có phiên bản/checksum + log muộn (S-AT-07) — Gate: `npm run -s test:file -- tests/db/period.test.ts`

### Lát 5 — Công việc, nghiệm thu, tiến độ, tệp (F-007…F-010)
- [x] `T-015` Dự án/hạng mục/task, máy trạng thái, lịch sử, khoá lạc quan (S-WK-01, 02, 06) — Gate: `npm run -s test:file -- tests/db/tasks.test.ts`
- [x] `T-016` Tiến độ 3 con số trên lá baseline (S-WK-03, ví dụ 35%) + cảnh báo nghỉ khi phân công (S-WK-04) — Gate: `npm run -s test:file -- tests/unit/progress.test.ts tests/db/assign-warning.test.ts`
- [x] `T-017` Tệp private qua route kiểm quyền + bình luận (S-WK-05) — Gate: `npm run -s test:file -- tests/http/files.test.ts`
- [x] `T-018` Giờ dự án + đối chiếu với công (AT08) — Gate: `npm run -s test:file -- tests/db/timesheet.test.ts`

### Lát 6 — Giao diện nội bộ & PWA (F-011)
- [x] `T-019` Giao diện nội bộ: đăng nhập, Hôm nay, Công việc, Chấm công, Phê duyệt (server components gọi lib) — Gate: `npm run -s build`
- [x] `T-020` Manifest + service worker + trang ngoại tuyến (S-PWA-04) — Gate: `npm run -s test:file -- tests/unit/manifest.test.ts`
- [x] `T-021` Hàng chờ IndexedDB + `/api/app/sync` + trạng thái hiển thị (S-PWA-01, 03) — Gate: `npm run -s test:file -- tests/unit/offline-queue.test.ts tests/http/sync.test.ts`
- [x] `T-022` Đăng xuất xoá dữ liệu thiết bị, DB theo user (S-PWA-02) — Gate: `npm run -s test:file -- tests/unit/device-data.test.ts`

### Lát 7 — Dashboard & E2E (F-012)
- [x] `T-023` Dashboard ngoại lệ có owner + next_action, bảng mốc riêng — Gate: `npm run -s test:file -- tests/db/dashboard.test.ts`
- [x] `T-024` E2E đầy đủ luồng chính AT01/AT03/AT06/AT09/AT12 + axe (QA-E2E-023) — Gate: `npm run -s e2e`

### Lát 8 — Cứng hoá theo blueprint (D-014; mục cần hạ tầng/người → `loop defer`)
- [x] `T-025` Env có schema zod tách server/client, kiểm lúc khởi động, che bí mật khi in, bind 127.0.0.1, tạo quản trị viên đầu tiên (BASE-CFG-002/005/007/008, BASE-SEC-005/010, PRF-WEB-003, FE-BUILD-005) — Gate: `npm run -s test:file -- tests/unit/env.test.ts`
- [x] `T-026` Logger JSON có cấu trúc (che bí mật/PII, chống CRLF, chuỗi cause), lỗi RFC 9457, không nuốt lỗi, audit có IP/UA (BASE-ERR-001…010, SEC-LOG-001/002, SEC-SECRET-007, CMP-AUDIT-002) — Gate: `npm run -s test:file -- tests/unit/log.test.ts tests/http/errors.test.ts`
- [x] `T-027` Độ tin cậy: timeout pool/kết nối/fetch, idle-in-tx, SIGTERM, /healthz /readyz, ON CONFLICT, FK ON DELETE + index, bù blob mồ côi, test đồng thời số dư (ARC-RES-001/002/009, BE-REL-001/004, DB-PERF-001/004/005, DB-TX-001/003/004, DB-MODEL-004, OPS-OBS-006, BASE-DATA-009, QA-UNIT-008) — Gate: `npm run -s test:file -- tests/db/reliability.test.ts tests/http/health.test.ts`
- [x] `T-028` Idempotency-Key cho mọi POST ghi + 422 khác payload + giới hạn tần suất theo người dùng; form khoá nút khi gửi (ARC-INT-001, BE-API-008, BE-REL-006, UX-STATE-006, FE-FORM-007) — Gate: `npm run -s test:file -- tests/http/idempotency.test.ts`
- [x] `T-029` Worker outbox (SKIP LOCKED, backoff jitter, DLQ, processed_message, schema payload) + job lưu giữ/xoá theo cấu hình (ARC-INT-003/005, BE-JOB-001/003/004/007, XC-GREEN-007, STD-PRIV-005; D-016) — Gate: `npm run -s test:file -- tests/db/worker.test.ts tests/db/retention.test.ts`
- [x] `T-030` Tệp (allowlist đuôi khớp nội dung, tên sạch), safe-html/safeUrl, CSP base-uri none, cookie __Host, no-store, ma trận 401/BOLA/BFLA mọi endpoint (BE-FILE-001/003, FE-SEC-001/002/003, SEC-WEB-004, BASE-SEC-007, BE-AUTH-004, BE-CACHE-001, PRF-WEB-004, STD-SEC-004, QA-INT-006) — Gate: `npm run -s test:file -- tests/http/authz-matrix.test.ts tests/http/files.test.ts tests/unit/safe-html.test.ts`
- [x] `T-031` Văn bản & dữ liệu: NFC ở biên, UTF-8 khứ hồi, phân biệt thiếu/rỗng/0, tài nguyên messages/vi.json, ngày qua Intl, module đơn vị, phân trang (BASE-DATA-001/002/003, UX-CONTENT-002, XC-I18N-001/003/005, XC-UNITS-009, XC-PERF-006) — Gate: `npm run -s test:file -- tests/unit/i18n.test.ts tests/db/text-roundtrip.test.ts`
- [x] `T-032` UI: error/loading, hộp thoại xác nhận, lỗi theo ô, schema dùng chung, token màu + kiểm tương phản/hex, CREDITS, test component (UX-STATE-001/005/008, FE-FORM-001/002, UX-A11Y-002, UX-DS-001/002/003, UX-VISUAL-007, FE-TEST-001) — Gate: `npm run -s test:file -- tests/unit/components.test.tsx && npm run -s check:tokens`
- [x] `T-033` E2E mở rộng: axe 0 vi phạm mọi route, bàn phím, 320 px, mobile chạy luồng chính, @smoke, trace + artifact, TZ cố định (STD-A11Y-002, UX-A11Y-001/003, UX-RESP-001/008, FE-TEST-002/003, QA-E2E-001/003/005, PRF-WEB-006) — Gate: `npm run -s e2e`
- [x] `T-034` Kiến trúc & lint: ADR mẫu + ADR-0002/0003, ranh giới module, chống vòng, bỏ skipLibCheck, ROUTES.md, chặn .only/.skip và test không assert (ARC-STYLE-001, ARC-ADR-001/004, ARC-MOD-003/004/005/008, PRF-WEB-001/002, FE-BUILD-003, FE-RENDER-001, QA-STRAT-008, QA-COV-004) — Gate: `npm run -s lint && npm run -s typecheck && npm run -s check:arch`
- [x] `T-035` Tệp dự án: README, LICENSE, CHANGELOG, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, SUPPORT, security.txt, ISSUE_TEMPLATE, CODEOWNERS, .editorconfig, AGENTS.md lệnh (BASE-DOC-001, BASE-REPO-004/007, BASE-SEC-009, XC-OSS-001/004, XC-DOCAI-001/004/005, WF-TEAM-003, WF-REVIEW-007, BASE-GATE-009) — Gate: `npm run -s check:repo-docs`
- [x] `T-036` CI chính sách: pr-policy (commitlint, mục PR, fix kèm test, lockfile), link, readme-smoke, e2e bắt buộc, coverage baseline + artifact, nvmrc, digest, gitattributes/gitignore, pre-commit, lint migration (WF-*, QA-COV-001/002/008, LOOP-CI-001, BASE-DEP-003/006/008, BASE-REPO-003/005, BASE-DOC-005/006/008, OPS-DEPLOY-003, DB-MIG-008/011) — Gate: `python3 .xtemplates/scripts/xt.py ci-check .github/workflows && npm run -s check:ci-policy`
- [x] `T-037` Chuỗi cung ứng: CodeQL, gitleaks toàn lịch sử, osv-scanner gồm dev + ngoại lệ có hạn, chính sách license, SBOM, THIRD_PARTY_NOTICES, eol-check, release-please (SEC-WEB-001, SEC-SECRET-001, SEC-SUPPLY-006, BASE-DEP-004/005, CMP-LIC-001/002/003, OPS-MAINT-003/004/005, WF-REL-001) — Gate: `npm run -s check:supply-chain`
- [x] `T-038` Hiệu năng & quan sát trong repo: lighthouserc, size-limit, baseline, histogram http.server.request.duration, SLO.md (PRF-WEB-005, FE-PERF-002/004, XC-PERF-003, XC-GREEN-001/002, OPS-OBS-003, OPS-SLO-001) — Gate: `npm run -s test:file -- tests/unit/metrics.test.ts && npm run -s check:perf-budget`
- [x] `T-039` Tài liệu vận hành/bảo mật/tuân thủ + spec: RUNBOOK, ứng phó sự cố, threat model đủ mẫu, RISKS, SCOPE, data-map + CI, DPIA nháp, spec có trạng thái/AC/ca biên/câu hỏi mở (OPS-IR-*, SEC-TM-*, PM-*, WF-SDD-*, STD-*, CMP-PRIV-001, …) — Gate: `npm run -s check:docs`
- [x] `T-040` Quyền chủ thể dữ liệu: bảng consent chỉ thêm, yêu cầu truy cập/xoá/rút đồng ý có hạn xử lý, ẩn danh lan tới tệp/outbox (CMP-RIGHTS-001/004/007, CMP-VN-001/007, STD-PRIV-004, CMP-PRIV-005, CMP-INTL-007) — Gate: `npm run -s test:file -- tests/db/data-rights.test.ts`
- [x] `T-041` Chuỗi thông điệp ở lib/** (AppError, tóm tắt, worker/email) vào messages/*.json + mở rộng check:i18n sang lib/ (XC-I18N-001; D-025) — Gate: `npm run -s check:i18n && npm run -s test:file -- tests/unit/i18n.test.ts`

## Phụ thuộc ngoài
| Việc | Bên ngoài | Ngày cam kết | Kế hoạch B |
|---|---|---|---|
| Quy tắc ca/OT/nghỉ (F02) | HR công ty | chưa có | giá trị ⚙ là cấu hình có hiệu lực, đổi không cần sửa mã |
| DPIA + căn cứ thu GPS | HR + pháp chế | chưa có | GPS tắt mặc định; QR + ca vẫn chạy |
| Nội dung website đã duyệt | Kinh doanh | chưa có | nội dung mẫu đánh dấu "nội dung mẫu" trong seed dev, không seed production |

## Ước lượng
| Lát | P50 | P90 |
|---|---|---|
| 1 | 0,5 ngày | 1 ngày |
| 2 | 1 ngày | 2 ngày |
| 3 | 0,5 ngày | 1 ngày |
| 4 | 1,5 ngày | 3 ngày |
| 5 | 1 ngày | 2 ngày |
| 6 | 1 ngày | 2 ngày |
| 7 | 0,5 ngày | 1 ngày |
Tổng: P50 6 ngày-agent · P85 ~10 (không cộng P50 làm ngày hứa). Đây là lõi kỹ thuật; dự toán người-tuần của kế hoạch §15 vẫn là căn cứ ngân sách.
