# docs/autopilot/PLAN-lat-12.md — X-Company · Lát 12–13: hoàn tất phát triển, rồi pha harden trước production

> Duyệt: D-055 (phiên chính tự duyệt 2026-10-21) · Yêu cầu chủ dự án 2026-10-21: "chạy dev hoàn chỉnh trước khi lên production" · Nguồn: `docs/ops/AUDIT-STATUS.md` (12 🟢 mở sau lát 11), kiểm lại cuối lát 11 (6 lệnh Kiểm đỏ), `GO-NO-GO.md` · Kế hoạch trước: `PLAN.md` (lát 1–10), `PLAN-lat-11.md` · Blueprint: BLUEPRINT.md

## Tóm tắt duyệt (cổng duy nhất)
- Lát 12 — mọi mục audit 🟢 còn mở mà agent tự làm được, mỗi mục test đỏ trước khi sửa; ghim gitleaks để kiểm cuối chạy đủ trên máy dev.
- Lát 13 — pha harden (ADR-0031 của khung): `delivery_phase: harden`, audit delta trên cây cuối, `release-check`, GO-NO-GO mới. Từ đây PR ngoại lệ cứng có `reviewer-alt` rà trước khi mở.
- Không làm (lý do ghi D-055): DEP-001 TypeScript 7 — typescript-eslint 8.72.0 peer `typescript <6.1.0` (npm, 2026-10-21); HAR-003 số dòng bằng chứng (không đổi hành vi); XFEAT-005 phần còn lại (đọc `company.timezone`, lịch lễ — chờ lịch công ty H02).
- Chờ người, không đổi: SEC-002 (TOTP), DOC-001, DOC-002, CFG-001/002, 91 MUST hạ tầng thật/pháp lý, 3 lệnh Kiểm LOOP-* bị guard chặn trong phiên (FB-088).
- Rủi ro: ngân sách JS tĩnh 229,7/230 KB chặn A11Y-008/009 → T-071 giảm JS thật trước (không nâng trần, không đổi cách đo).

## Mục tiêu của kế hoạch này
Mọi mục audit agent tự làm được đã đóng bằng mã + test; pha harden chạy xong với `release-check` và GO-NO-GO trên cây cuối, chỉ còn việc người/hạ tầng thật.

## Ngân sách (4 con số)
- Số vòng tối đa: (bỏ trống — `--single-session` tự tính)
- Ngân sách: 6.000.000 token
- Timeout mỗi lệnh Gate: 1800 giây (`XT_RECORD_TIMEOUT`)
- Ngày hết hạn: `--hours 48`

## Ủy quyền production (người duyệt một lần ở đây; máy kiểm bằng `xt.py grant-check`, ADR-0022)
- grant: payments | mode=sandbox | max_per_txn=0 | refund=false
- grant: data_delete | hard_delete=false | max_rows=100
- grant: data_export | pii=false | max_rows=10000
- grant: outbound_messages | live=false | max_per_hour=0
- grant: auth_crypto | custom_crypto=false
- grant: secrets | read_values=false

## Điểm dừng bắt buộc về hành động
- Merge PR ngoại lệ cứng (auth, quyền, migration, dữ liệu người dùng) khi `merge_hard_exceptions: human` → người merge.
- Deploy production, tên miền, KMS/HSM thật, dữ liệu thật: ngoài phạm vi (chưa có pháp nhân — D-043).

## Task

### Lát 12 — Hoàn tất phát triển (audit 🟢 còn mở)
- [x] `T-065` Ghim gitleaks 8.30.1 (MIT, sha256 từ checksums chính thức) trong `install-tool`; ba lệnh Kiểm gitleaks của blueprint chạy được trên máy dev (files: scripts/tools/install-tool.mjs, tests/unit/ops-stack.test.ts) — Gate: `npm run -s test:file -- tests/unit/ops-stack.test.ts && node scripts/tools/install-tool.mjs install gitleaks && "$(node scripts/tools/install-tool.mjs path gitleaks)" git --log-opts="HEAD --remotes" --no-banner --exit-code 1`
- [x] `T-066` AUD-DATA-004: test ca biên ranh kỳ cho đơn nghỉ nhiều ngày theo D-012 (tính vào ngày bắt đầu và kỳ chứa ngày đó) (files: tests/db/period.test.ts) — Gate: `npm run -s test:file -- tests/db/period.test.ts`
- [x] `T-067` AUD-SEC-005: `grantRole`/`revokeGrant` tự kiểm `access.manage` (chỉ actor hệ thống tường minh được bỏ qua), `SCOPE_TABLE` có `project` (exec: deep; files: lib/authz/grants.ts, lib/identity/bootstrap.ts, scripts/seed-e2e.ts, tests/) — Gate: `npm run -s test:file -- tests/http/auth.test.ts tests/db/authz-scope.test.ts tests/db/bootstrap-admin.test.ts`
- [x] `T-068` AUD-DATA-003: đường xoá toạ độ GPS có kiểm soát (migration chỉ thêm hàm/quyền) + retention toạ độ theo cấu hình, trước khi bật GPS (exec: deep; files: migrations/, lib/worker/retention.ts, lib/nen/env.ts, tests/db/) — Gate: `npm run -s check:migrations && npm run -s test:file -- tests/db/geo-consent.test.ts tests/db/retention.test.ts`
- [x] `T-069` AUD-PERF-001 phần còn lại: kịch bản chốt kỳ (200 nhân viên × 31 ngày) trong `perf:load` có ngân sách đặt trước (files: scripts/perf-load.mjs, scripts/seed-perf.ts, tests/unit/perf-load.test.ts) — Gate: `npm run -s test:file -- tests/unit/perf-load.test.ts && npm run -s perf:load`
- [x] `T-070` AUD-PERF-003: `perf:load` từ chối ghi báo cáo vào repo khi cây bẩn; báo cáo mới trên cây sạch (sau: T-069; files: scripts/perf-load.mjs, scripts/lib/prod-harness.mjs, docs/perf/) — Gate: `npm run -s test:file -- tests/unit/perf-load.test.ts && ! grep -q '+dirty' docs/perf/load-report-2026-10-21.md`
- [x] `T-071` Giảm JS tĩnh ≥ 2 KB gzip mà không đổi hành vi và không đổi cách đo/trần (exec: deep; files: app/, lib/**/*.pure.ts, docs/perf/) — Gate: `npm run -s build && npm run -s check:perf-budget | awk '/tổng JS static/{for(i=1;i<=NF;i++) if($i=="static") v=$(i+1)} END{exit !(v!="" && v+0<=227.7)}' && npm run -s test:file -- tests/unit/components.test.tsx`
- [x] `T-072` AUD-A11Y-009: gửi form đơn xong (hoặc lỗi không kèm `fields`) focus về khối của form, không rơi về `<body>` (sau: T-071; files: app/components/, e2e/flows.spec.ts) — Gate: `npm run -s check:perf-budget && npm run -s e2e`
- [x] `T-073` AUD-A11Y-008: dải "Đang ngoại tuyến" khi mất mạng và khi trang lấy từ bộ đệm SW (sau: T-072; files: app/, public/sw.js, e2e/) — Gate: `npm run -s check:perf-budget && npm run -s e2e`
- [x] `T-074` AUD-A11Y-007: axe quét thêm 1280 px, trạng thái lỗi/hộp thoại, bảng dashboard có seed mốc và `<caption>` (sau: T-073; files: e2e/, scripts/seed-e2e.ts, app/app/) — Gate: `npm run -s e2e`
- [x] `T-075` AUD-TEST-001 phần còn lại: script chạy lặp test nhạy thời gian dưới tải CPU, 50 lượt health + reliability xanh (files: scripts/flaky-check.sh, tests/) — Gate: `scripts/flaky-check.sh 50 tests/http/health.test.ts tests/db/reliability.test.ts`

### Lát 13 — Harden trước production (G7)
- [x] `T-076` Chuyển `delivery_phase: harden` trong `xt.yaml` (lý do trong PR), doctor sạch (sau: T-075; files: xt.yaml) — Gate: `python3 .xtemplates/scripts/xt.py doctor && grep -q '^delivery_phase: harden' xt.yaml`
- [x] `T-077` Audit delta trên cây cuối (`xt.py audit plan --status docs/ops/AUDIT-STATUS.md`), 🔴/🟠 mới thành task; sổ hợp lệ (sau: T-076; files: docs/ops/) — Gate: `python3 .xtemplates/scripts/xt.py audit check docs/ops/AUDIT-STATUS.md`
- [ ] `T-078` `release-check` trên cây cuối + `GO-NO-GO.md` mới (số đếm máy sinh, nhãn bằng chứng trung thực), PROGRESS (sau: T-077; files: GO-NO-GO.md, PROGRESS.md) — Gate: `npm run -s check:docs && npm run -s check:repo-docs && python3 .xtemplates/scripts/xt.py release-check --blueprint BLUEPRINT.md --status docs/ops/AUDIT-STATUS.md --json > /dev/null`
