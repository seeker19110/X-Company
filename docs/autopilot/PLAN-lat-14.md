# docs/autopilot/PLAN-lat-14.md — X-Company · Lát 14–15: đóng 🟠 còn mở mà agent tự làm được

> Duyệt: D-058 (phiên chính tự duyệt 2026-10-24) · Nguồn: `docs/ops/AUDIT-STATUS.md` (4 🟠 + 13 🟢 mở sau #68), `GO-NO-GO.md` (BLOCKER audit: SEC-002, DOC-001, DOC-002, CFG-001) · Kế hoạch trước: `PLAN.md` (lát 1–10), `PLAN-lat-11.md`, `PLAN-lat-12.md` · Blueprint: BLUEPRINT.md

## Tóm tắt duyệt (cổng duy nhất)
- Các phiên trước để SEC-002/DOC-001/DOC-002 "chờ người quyết"; đây là quyết định chuyên môn (spec đã ghi MUST, cách làm là thiết kế) → phiên chính tự duyệt theo AGENTS.md §5, mặc định tự host.
- Lát 14 (làn chuẩn, không chạm auth/mật mã): DOC-001 form ứng tuyển; DOC-002 thông báo **trong ứng dụng** (bảng `notification`, handler outbox ghi cùng giao dịch worker — không cần SMTP/Web Push/khoá ngoài); 🟢 rẻ có test: DATA-006, CODE-010, A11Y-011, PERF-004, TEST-002.
- Lát 15 (ngoại lệ cứng auth → người merge): SEC-002 TOTP RFC 6238 cho `sysadmin`/`hr`/`executive` (đăng nhập hai bước, đăng ký lần đầu, chống phát lại, giới hạn lần sai, bí mật mã hoá bằng `lib/crypto/columns`); SEC-007 chặn thu hồi grant sysadmin cuối.
- Không làm (lý do D-058): CFG-001/002/003 (hook chặn agent ghi `.env.example`, D-050 — chờ người); DEP-001 (typescript-eslint 8.x peer `typescript <6.1.0`, npm 2026-10-24); SEC-008 (RUM tắt mặc định); HAR-003 (số dòng bằng chứng, không đổi hành vi); CI-004 (quyết định của khung).
- Rủi ro: JS tĩnh 225,6/230 KB — form ứng tuyển dùng lại phần form liên hệ, schema nạp động; TOTP đổi luồng đăng nhập của seed e2e/test → seed đăng ký bí mật cố định cho người dùng e2e.

## Mục tiêu của kế hoạch này
Không còn 🟠 nào mở mà agent làm được; `release-check` chỉ còn NO-GO vì việc người/hạ tầng thật.

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
- Merge PR ngoại lệ cứng (auth, quyền, mật mã) khi `merge_hard_exceptions: human` → người merge (lát 15).
- Thêm khoá `.env.example`, deploy, dữ liệu thật: ngoài phạm vi (D-043, D-050).

## Task

### Lát 14 — Form ứng tuyển, thông báo trong ứng dụng, 🟢 rẻ
- [x] `T-079` AUD-DOC-001: form ứng tuyển trên trang chi tiết tin tuyển dụng (`job_slug`) và trang `/tuyen-dung` (ứng tuyển chung); schema dùng chung client/server ở `lib/inquiry/schema.pure.ts` (zod/mini), đồng ý kho nhân tài riêng không tích sẵn; e2e gửi → mã `UV-` (files: app/components/, app/(public)/, lib/inquiry/, lib/i18n/, tests/unit/components.test.tsx, tests/http/inquiry.test.ts, e2e/pages.spec.ts) — Gate: `npm run -s test:file -- tests/unit/components.test.tsx tests/http/inquiry.test.ts && npm run -s build && npm run -s check:perf-budget && npm run -s e2e`
- [x] `T-080` AUD-DOC-002 (máy chủ): bảng `notification` (migration chỉ thêm), handler outbox ghi thông báo cho người bị ảnh hưởng trong cùng giao dịch worker (lũy đẳng theo sự kiện + người nhận), API đọc/đánh dấu đã đọc chỉ của chính mình, retention thông báo đã đọc (exec: deep; files: migrations/, lib/notify/, lib/worker/, app/api/app/notifications/, docs/api/, tests/) — Gate: `npm run -s check:migrations && npm run -s check:arch && npm run -s test:file -- tests/db/notification.test.ts tests/http/notification.test.ts tests/db/worker.test.ts tests/db/retention.test.ts`
- [ ] `T-081` AUD-DOC-002 (giao diện): trang `/app/thong-bao` + số chưa đọc ở điều hướng, a11y; e2e giao việc → người nhận thấy thông báo (sau: T-080; files: app/app/, app/components/, lib/i18n/, e2e/) — Gate: `npm run -s build && npm run -s check:perf-budget && npm run -s e2e`
- [ ] `T-082` AUD-DATA-006: migration mới ép sàn tuổi `p_before <= now() - interval '1 day'` cho `attendance_event_erase_geo` (files: migrations/, tests/db/geo-consent.test.ts) — Gate: `npm run -s check:migrations && npm run -s test:file -- tests/db/geo-consent.test.ts tests/db/retention.test.ts`
- [x] `T-083` AUD-CODE-010 + AUD-A11Y-011: hạ cờ `refocus` sau một lượt; `offline.css` precache cho `offline.html`; dải ngoại tuyến không che thanh trên; bỏ `aria-live` thừa và nhãn bảng đọc ba lần (files: app/components/, app/app/, public/, e2e/) — Gate: `npm run -s test:file -- tests/unit/components.test.tsx && npm run -s build && npm run -s check:perf-budget && npm run -s e2e`
- [ ] `T-084` AUD-PERF-004 + AUD-TEST-002: `spawnSync` có timeout; `check-tests` bắt cả `context.route`; e2e bấm đúng nút theo trạng thái (files: scripts/perf-load.mjs, scripts/check-tests.ts, e2e/pages.spec.ts, tests/unit/) — Gate: `npm run -s test:file -- tests/unit/perf-load.test.ts tests/unit/check-tests.test.ts && npm run -s check:tests`

### Lát 15 — Xác thực hai bước, quyền quản trị (ngoại lệ cứng)
- [ ] `T-085` AUD-SEC-007: `revokeGrant` từ chối (409) thu hồi grant `sysadmin` hiệu lực cuối cùng của công ty, dưới khoá chống đua (files: lib/authz/grants.ts, tests/db/authz-scope.test.ts) — Gate: `npm run -s test:file -- tests/db/authz-scope.test.ts tests/http/auth.test.ts`
- [ ] `T-086` AUD-SEC-002 (máy chủ): TOTP RFC 6238 (HMAC-SHA1 của `node:crypto`, vector chuẩn RFC), bí mật mã hoá cột, đăng nhập hai bước bằng thử thách ngắn hạn, đăng ký lần đầu cho vai trò bắt buộc, chống phát lại theo bước, giới hạn lần sai, audit (exec: deep; sau: T-085; files: migrations/, lib/identity/, lib/crypto/columns.ts, app/api/app/auth/, docs/api/, docs/privacy/data-map.yaml, scripts/seed-e2e.ts, tests/) — Gate: `npm run -s check:migrations && npm run -s check:arch && npm run -s test:file -- tests/unit/totp.test.ts tests/http/auth.test.ts tests/http/mfa.test.ts tests/db/bootstrap-admin.test.ts`
- [ ] `T-087` AUD-SEC-002 (giao diện): bước nhập mã và trang đăng ký (khoá thủ công + URI otpauth, không gọi dịch vụ QR ngoài) ở màn đăng nhập; e2e người dùng vai trò bắt buộc đăng nhập bằng TOTP (sau: T-086; files: app/, e2e/, lib/i18n/) — Gate: `npm run -s build && npm run -s check:perf-budget && npm run -s e2e`
- [ ] `T-088` Đóng sổ: SPEC/THREAT-MODEL T1/AUDIT-STATUS khớp mã; `release-check` + `GO-NO-GO.md` mới; PROGRESS (sau: T-087; files: docs/, GO-NO-GO.md, PROGRESS.md) — Gate: `npm run -s check:docs && npm run -s check:repo-docs && python3 .xtemplates/scripts/xt.py audit check docs/ops/AUDIT-STATUS.md && python3 .xtemplates/scripts/xt.py release-check --blueprint BLUEPRINT.md --status docs/ops/AUDIT-STATUS.md --json > /dev/null`

## Ước lượng
| Lát | P50 | P90 |
|---|---|---|
| 14 | 1 ngày-agent | 2 ngày-agent |
| 15 | 1 ngày-agent | 2 ngày-agent |
