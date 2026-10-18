# Miền (bounded context) và điểm xuất công khai

> Nguồn sự thật cho ARC-MOD-005/008. Script `scripts/check-domains.mjs` (chạy trong `npm run check:arch`) kiểm hai điều:
> (1) mọi thư mục `lib/*` đều được khai ở đây; (2) import chéo miền (từ `lib/`, `app/`, `scripts/`) chỉ trỏ vào **tệp công khai** đã khai.
> Tên miền bám `docs/design/ARCHITECTURE.md` (mục Nghiệp vụ) và `PROJECT.md`. Thêm miền/tệp công khai = sửa bảng này trong cùng PR.

Cột "Công khai" liệt kê tệp (tương đối `lib/<miền>/`) mà miền khác được import; mặc định `index.ts`. Tests không bị kiểm (được chạm nội bộ).

## Miền nghiệp vụ

| Miền         | Công khai             | Ghi chú                                                          |
| ------------ | --------------------- | ---------------------------------------------------------------- |
| `identity`   | `index.ts`            | tài khoản, phiên, đăng nhập                                      |
| `org`        | `index.ts`            | công ty, chi nhánh, phòng ban, nhân viên                         |
| `authz`      | `index.ts`            | `can()` — mô-đun thuần                                           |
| `audit`      | `index.ts`            | chuỗi băm kiểm toán                                              |
| `attendance` | `index.ts`            | chấm công; `compute.ts` là lõi thuần (không công khai trực tiếp) |
| `work`       | `index.ts`, `tasks.ts` | dự án/công việc; `progress.ts` là lõi thuần                      |
| `cms`        | `index.ts`            | nội dung website                                                 |
| `inquiry`    | `index.ts`            | liên hệ, tuyển dụng                                              |
| `files`      | `index.ts`            | kho tệp private                                                  |
| `notify`     | `index.ts`            | thông báo, email/push qua outbox                                 |
| `outbox`     | `index.ts`            | hàng đợi sự kiện                                                 |
| `dashboard`  | `index.ts`            | tổng hợp cho trang điều hành                                     |
| `today`      | `index.ts`            | màn hình "hôm nay" của nhân viên                                 |
| `site`       | `index.ts`            | cấu hình/ngữ cảnh website công khai                              |

## Hạ tầng dùng chung (không phải miền nghiệp vụ)

| Miền      | Công khai                | Ghi chú                                                  |
| --------- | ------------------------ | -------------------------------------------------------- |
| `db`      | `index.ts`, `migrate.ts` | kết nối, giao dịch, migration runner                     |
| `nen`     | `app-error.ts`           | `AppError` và tiện ích nền                               |
| `http`    | `index.ts`               | `withActor`, phiên, CSRF — cổng từ `app/` vào `lib/`     |
| `logger`  | `index.ts`               | nhật ký có cấu trúc                                      |
| `offline` | `index.ts`               | hàng chờ offline — mô-đun thuần                          |

## Mô-đun thuần (ARC-MOD-003)

Không import `lib/db`, `pg`, `node:http(s)`, `next/*` (ESLint `no-restricted-imports`, `eslint.config.mjs`):
`lib/attendance/compute.ts`, `lib/work/progress.ts`, `lib/authz/index.ts`, `lib/offline/queue.ts`, mọi `lib/**/*.pure.ts` và `lib/**/pure/**`.
