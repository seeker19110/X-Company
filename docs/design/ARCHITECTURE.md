# Kiến trúc — X-Company (G4)

> ADR-0001 (stack) · D-004 (một ứng dụng) · Cập nhật 2026-10-18

## C4 mức 1 — Bối cảnh
```text
[Khách truy cập] --HTTPS--> [X-Company web]  <--HTTPS-- [Nhân viên / Quản lý / HR (trình duyệt, PWA)]
                                 |   \
                          [PostgreSQL]  [Kho tệp private (adapter: đĩa → S3-compatible)]
                                 |
                 [Worker: outbox → email/push, xuất báo cáo]  --> [SMTP] [Web Push service]
                 Xuất bảng công CSV  --> [Hệ lương/kế toán hiện có] (tệp, không API ở P0)
```

## C4 mức 2 — Container & module
| Container | Công nghệ | Trách nhiệm |
|---|---|---|
| Web (Next.js) | App Router, RSC + route handler | `app/(public)` website · `app/app` khu nội bộ/PWA · `app/api/public/*` (liên hệ, tuyển dụng) · `app/api/app/*` (nội bộ) |
| Proxy | `proxy.ts` (Next 16) | header bảo mật/CSP, chuyển hướng chưa đăng nhập; **không** là nơi kiểm quyền (kiểm ở route) |
| Nghiệp vụ | `lib/<miền>` TS thuần | `identity`, `org`, `authz`, `audit`, `attendance`, `work`, `cms`, `inquiry`, `files`, `notify` — hàm nhận `tx` + `actor`, không đọc request |
| DB | PostgreSQL 17 | `migrations/NNNN_*.sql` append-only; role ứng dụng không phải owner/superuser |
| Worker | `scripts/worker.ts` (Node, `npm run worker`) + `lib/worker/` | **đã có (T-029):** lấy `outbox_event` `FOR UPDATE SKIP LOCKED`, handler theo topic + schema zod, backoff mũ có jitter (tối đa 5 lần), DLQ (`status='dead'`), khử trùng `processed_message`; kênh gửi qua adapter (hiện chỉ ghi log — SMTP/Web Push chưa có; kênh tắt → giữ `pending`). Retention: `npm run retention:run` (D-016) |
| SW | `public/sw.js` | cache tĩnh, fallback offline; hàng chờ ở IndexedDB do trang quản lý |

Luật lớp (kiểm bằng ESLint `no-restricted-imports`): `app/**` → `lib/**` qua `lib/http` (handler bọc `withActor`);
`lib/**` không import `next/*` hay `app/**`; `lib/domain-pure` (tính ca, tiến độ, quyền) không import `lib/db`.

## Dòng một request ghi
`route handler` → `withActor` (phiên, CSRF, rate limit, request_id) → zod parse → `withTx(async tx => { can() → nghiệp vụ → audit.append(tx) → outbox.add(tx) })` → JSON.
Mọi lỗi nghiệp vụ là `AppError(code, http)`; không lộ stack ra client.

## Lược đồ dữ liệu (nhóm → bảng; chi tiết trong migrations)
| Nhóm | Bảng |
|---|---|
| Tổ chức & danh tính | company, branch, department, worksite, employee, employment_history, app_user, session, role_grant, login_attempt |
| Kiểm toán & nền | audit_event (chuỗi băm), outbox_event (+ `processed_message`), idempotency_record |
| Chấm công | shift_template, shift_assignment, attendance_event, attendance_adjustment, leave_type, leave_ledger, leave_request, ot_policy, ot_request, attendance_period, period_export, qr_key |
| Công việc | project, project_member, work_package, task, task_history, dependency, milestone, plan_baseline, timesheet_entry |
| Tệp & trao đổi | file_object, document, document_version, comment, notification |
| Website | cms_page, cms_revision, cms_redirect, inquiry, inquiry_history, job_posting, job_application |

Quy ước: khoá chính `uuid` (sinh ở DB `gen_random_uuid()`); mọi bảng nghiệp vụ có `company_id NOT NULL` và khoá ngoại
quan trọng gồm `company_id` (ràng buộc phạm vi công ty); thời điểm `timestamptz` UTC; ngày nghiệp vụ `date` +
`business_tz`; tiền (nếu có ở P1) `numeric(18,2)` + `currency`; khối lượng kèm đơn vị.

## Thư mục
```text
app/(public)/…        website            app/app/…   nội bộ + PWA        app/api/{public,app}/…  route
lib/<miền>/           nghiệp vụ          migrations/ SQL                 tests/{unit,db,http}/   node:test
e2e/                  Playwright         scripts/    migrate, worker, test-db, verify-audit-chain
docs/{specs,adr,design,g0,autopilot}/
```

## Môi trường
dev (Postgres cục bộ do `scripts/with-test-db.sh` dựng bằng `initdb` khi không có Docker) · test (CI service `postgres:17`) ·
staging/production (tự host PM2 như XBOSS — `RUNBOOK.md` lập ở lát vận hành). Bí mật qua biến môi trường, mẫu ở
`.env.example`, không commit giá trị.
