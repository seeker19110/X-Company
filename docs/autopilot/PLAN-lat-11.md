# docs/autopilot/PLAN-lat-11.md — X-Company · Lát 11: sửa audit 🟢 còn mở

> Duyệt: D-051 (phiên chính tự duyệt 2026-10-21) · Nguồn: `docs/ops/AUDIT-STATUS.md` · Kế hoạch gốc (lát 1–10, đã xong): `docs/autopilot/PLAN.md` · Blueprint: BLUEPRINT.md

## Tóm tắt duyệt (cổng duy nhất)
- 7 task sửa mục audit 🟢 có đường tái hiện; mỗi task test đỏ trước khi sửa; không nới cổng, không hạ ngân sách.
- Thứ tự: rủi ro thấp trước (route chấm công, form liên hệ, múi giờ), rồi quyền/đăng nhập/migration (người merge — `merge_hard_exceptions: human`).
- Ngoài phạm vi: SEC-002 (TOTP), DOC-001, DOC-002, CFG-001/002 — chờ người quyết; SEC-005, A11Y-007/008/009, DATA-003/004, TEST-001, PERF-001/003, DEP-001, HAR-003 — lát sau.
- Rủi ro: T-059 đổi hành vi chấm công trực tuyến khi vượt trần (429) — trần đặt xa trên nhu cầu thật (vài lượt/ngày/người); hàng chờ ngoại tuyến đi qua `/sync` có trần riêng.

## Mục tiêu của kế hoạch này
Đóng 7 mục audit 🟢 bằng mã + test; AUDIT-STATUS ghi "đã sửa" kèm PR.

## Ngân sách (4 con số)
- Số vòng tối đa: (bỏ trống — `--single-session` tự tính)
- Ngân sách: 4.000.000 token
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
- Merge PR ngoại lệ cứng (auth, quyền, migration) khi `merge_hard_exceptions: human` → người merge.

## Task

### Lát 11 — Sửa audit 🟢 còn mở, agent tự làm được (AUDIT-STATUS 2026-10-21; D-051)
- [x] `T-058` Một luật khoá Idempotency cho mọi route: `/attendance/events` dùng chung bộ kiểm ký tự in được của middleware, trần 100 theo CHECK của bảng (AUD-XFEAT-003; files: lib/http/idempotency.ts, lib/attendance/routes.ts, tests/http/attendance-events.test.ts) — Gate: `npm run -s test:file -- tests/http/attendance-events.test.ts tests/http/idempotency.test.ts`
- [x] `T-059` Giới hạn tần suất cho `/attendance/events` theo người dùng như `/sync`; kịch bản tải dùng nhiều nhân viên để không đo đường 429; API-CONTRACT (AUD-XFEAT-004; sau: T-058; files: lib/attendance/routes.ts, scripts/perf-load.mjs, docs/design/API-CONTRACT.md, tests/http/attendance-events.test.ts) — Gate: `npm run -s test:file -- tests/http/attendance-events.test.ts tests/unit/perf-load.test.ts`
- [x] `T-060` Form liên hệ xử lý phản hồi không phải JSON (502/5xx HTML) bằng thông điệp lỗi máy chủ, không báo mất mạng (AUD-XFEAT-007; files: app/components/contact-form.tsx, tests/unit/components.test.tsx, messages/) — Gate: `npm run -s test:file -- tests/unit/components.test.tsx`
- [x] `T-061` Múi giờ nghiệp vụ một nguồn: chuỗi `Asia/Ho_Chi_Minh` chỉ ở `lib/nen/time.ts` (SQL nhận tham số), bỏ `localDateOf` trùng, lint chặn chuỗi múi giờ (AUD-XFEAT-005; files: lib/, eslint.config.mjs) — Gate: `npm run -s lint && npm run -s test:file -- tests/db/period.test.ts tests/db/dashboard.test.ts tests/db/assign-warning.test.ts tests/unit/compute-shift.test.ts tests/http/attendance-events.test.ts`
- [x] `T-062` Hành động quyền riêng `ot.request`, `adjustment.request_own` thay cho `leave.request` để audit denied đúng tên (AUD-XFEAT-006; files: lib/authz/index.ts, lib/attendance/ot.ts, lib/attendance/period.ts, tests/) — Gate: `npm run -s test:file -- tests/unit/authz.test.ts tests/db/leave-ot.test.ts tests/db/period.test.ts`
- [x] `T-063` Chặn dò mật khẩu rải: thêm giới hạn lần sai theo IP (mọi email) và theo email (mọi IP) bên cạnh cặp (email, IP) (AUD-SEC-004; exec: deep; files: lib/identity/auth.ts, tests/http/auth.test.ts, docs/THREAT-MODEL.md) — Gate: `npm run -s test:file -- tests/http/auth.test.ts`
- [ ] `T-064` Retention chia lô + index cho cột lọc thời gian (session, login_attempt, inquiry, idempotency_record) bằng migration chỉ thêm (AUD-PERF-002; exec: deep; files: migrations/, lib/worker/retention.ts, tests/db/) — Gate: `npm run -s check:migrations && npm run -s test:file -- tests/db/retention.test.ts tests/db/retention-explain.test.ts`
