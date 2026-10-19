# Miền (bounded context) và điểm xuất công khai

> Nguồn sự thật cho ARC-MOD-005/008. Script `scripts/check-domains.mjs` (chạy trong `npm run check:arch`) kiểm hai điều:
> (1) mọi thư mục `lib/*` đều được khai ở đây; (2) import chéo miền (từ `lib/`, `app/`, `scripts/`) chỉ trỏ vào **tệp công khai** đã khai.
> Tên miền bám `docs/design/ARCHITECTURE.md` (mục Nghiệp vụ) và `PROJECT.md`. Thêm miền/tệp công khai = sửa bảng này trong cùng PR.

Cột "Công khai" liệt kê tệp (tương đối `lib/<miền>/`) mà miền khác được import; mặc định `index.ts`. Tests không bị kiểm (được chạm nội bộ).

## Miền nghiệp vụ

| Miền         | Công khai             | Ghi chú                                                          |
| ------------ | --------------------- | ---------------------------------------------------------------- |
| `identity` | `index.ts`, `password.ts`, `routes.ts`, `session.ts`, `bootstrap.ts` | tài khoản, phiên, đăng nhập                                      |
| `org`        | `index.ts`            | công ty, chi nhánh, phòng ban, nhân viên                         |
| `authz` | `index.ts`, `grants.ts`, `load.ts` | `can()` — mô-đun thuần                                           |
| `audit`      | `index.ts`            | chuỗi băm kiểm toán                                              |
| `attendance` | `index.ts`, `approvals.ts`, `compute.ts`, `period.ts`, `request-routes.ts`, `request-schema.pure.ts`, `routes.ts`, `scope.ts`, `labor-rules.ts` | chấm công; `compute.ts` và `labor-rules.ts` (trần OT, hệ số lương, nghỉ — cấu hình có ngày hiệu lực) là lõi thuần; `request-schema.pure.ts` = schema form dùng chung client+server |
| `work` | `index.ts`, `tasks.ts`, `progress.ts`, `routes.ts` | dự án/công việc; `progress-compute.ts` là lõi thuần                      |
| `cms` | `index.ts`, `markdown.ts` | nội dung website                                                 |
| `inquiry` | `index.ts`, `routes.ts`, `schema.pure.ts` | liên hệ, tuyển dụng                                              |
| `privacy` | `index.ts`, `consent.ts`, `routes.ts`, `deadlines.ts` | quyền chủ thể dữ liệu (DSAR), bản ghi đồng ý chỉ thêm, danh mục dữ liệu phải giữ (`retained.ts`); `deadlines.ts` = hạn xử lý theo loại yêu cầu (lõi thuần, D-029) |
| `files` | `index.ts`, `routes.ts`, `storage.ts` | kho tệp private (`storage.ts`: adapter kho tệp — privacy xoá blob) |
| `notify`     | `index.ts`            | thông báo, email/push qua outbox                                 |
| `outbox`     | `index.ts`            | hàng đợi sự kiện                                                 |
| `worker` | `index.ts`, `retention.ts` | relay outbox (SKIP LOCKED, retry, DLQ), retention; `backoff.pure.ts` là lõi thuần |
| `dashboard`  | `index.ts`            | tổng hợp cho trang điều hành                                     |
| `today`      | `index.ts`            | màn hình "hôm nay" của nhân viên                                 |
| `site`       | `index.ts`            | cấu hình/ngữ cảnh website công khai                              |

## Hạ tầng dùng chung (không phải miền nghiệp vụ)

| Miền      | Công khai                | Ghi chú                                                  |
| --------- | ------------------------ | -------------------------------------------------------- |
| `db`      | `index.ts`, `migrate.ts` | kết nối, giao dịch, migration runner                     |
| `nen` | `app-error.ts`, `config.ts`, `time.ts`, `health.ts`, `timeouts.ts`, `shutdown.ts`, `env.ts`, `log.ts`, `security-event.ts`, `startup.ts`, `units.ts`, `text.ts`, `pagination.ts` | `AppError`, tiện ích nền, health/readiness, timeout, tắt êm |
| `http`    | `index.ts`, `metrics-route.ts`, `metrics.ts` | `withActor`, phiên, CSRF — cổng từ `app/` vào `lib/`     |
| `web`     | `safe-html.ts`, `theme.ts` | HTML an toàn duy nhất cho DOM sink + `safeUrl()` (FE-SEC-001/002); `theme.ts` SINH từ token (`npm run build:tokens`) |
| `logger`  | `index.ts`               | nhật ký có cấu trúc                                      |
| `i18n`    | `index.ts`, `client.ts`, `client-app.ts`, `client-site.ts`, `format.ts` | `t(khoá, tham số)` trên `messages/vi.json` (+ `vi.context.json`), định dạng Intl (số/tiền VND/ngày giờ múi VN/danh sách/tương đối) — thuần, dùng ở client + server + `*.pure.ts` |
| `offline` | `index.ts`, `device.ts`, `queue.ts`, `sync-route.ts` | hàng chờ offline — mô-đun thuần                          |
| `ops` | `index.ts` | cảnh báo vận hành cục bộ (T-046): luật `docs/ops/alerts.json`, kênh đích, bộ đánh giá chạy trong worker (`rules.ts` kiểm luật là mô-đun thuần về I/O mạng) |

## Mô-đun thuần (ARC-MOD-003)

Không import `lib/db`, `pg`, `node:http(s)`, `next/*` (ESLint `no-restricted-imports`, `eslint.config.mjs`):
`lib/attendance/compute.ts`, `lib/attendance/labor-rules.ts`, `lib/work/progress-compute.ts`, `lib/authz/index.ts`, `lib/offline/queue.ts`, mọi `lib/**/*.pure.ts` và `lib/**/pure/**`.
