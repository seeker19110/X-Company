# Bảng route và chế độ render

> FE-RENDER-001 · chiến lược và lý do: [ADR-0003](adr/0003-chien-luoc-render.md). Script `scripts/check-routes.ts`
> (trong `npm run check:arch`) so bảng này với cây `app/` (`page.tsx`, `route.ts`): thiếu/thừa/sai URL/sai chế độ = đỏ.
> Thêm route = thêm một hàng trong cùng PR.

Chế độ: **tĩnh** (dựng lúc build, không đọc DB) · **cache dùng chung** (đọc DB, cho phép CDN cache ngắn, không dữ liệu theo người dùng) · **động** (mỗi request; route có xác thực luôn `Cache-Control: no-store`) · **CSR** (vỏ tĩnh, dữ liệu tải ở trình duyệt).

## Website công khai

| Route     | Tệp                                | Chế độ | Lý do                                                           |
| --------- | ---------------------------------- | ------ | --------------------------------------------------------------- |
| `/`       | `app/(public)/page.tsx`            | động   | Đọc CMS từ DB mỗi request (`force-dynamic`), không phiên        |
| `/[...slug]` | `app/(public)/[...slug]/page.tsx` | động   | Trang CMS theo đường dẫn, đọc DB mỗi request, không phiên       |
| `/api/public/applications` | `app/api/public/applications/route.ts` | động | Ghi hồ sơ ứng tuyển; không cache |
| `/api/public/inquiries` | `app/api/public/inquiries/route.ts` | động | Ghi yêu cầu liên hệ; không cache |
| `/api/healthz` | `app/api/healthz/route.ts` | động | Liveness, không chạm DB; `no-store` |
| `/api/metrics` | `app/api/metrics/route.ts` | động | Metric Prometheus (RED + DLQ); bearer `METRICS_TOKEN`, không đặt thì 404; `no-store` |
| `/api/readyz` | `app/api/readyz/route.ts` | động | Readiness: `SELECT 1` có timeout, 503 khi DB lỗi/đang tắt; `no-store` |

## Khu nội bộ (đăng nhập)

| Route                                  | Tệp                                                  | Chế độ | Lý do                                                      |
| -------------------------------------- | ---------------------------------------------------- | ------ | ---------------------------------------------------------- |
| `/app/login`                           | `app/app/login/page.tsx`                             | động   | Form đăng nhập; `force-dynamic`, không cache               |
| `/app/approvals`                       | `app/app/(secure)/approvals/page.tsx`                | động   | Dữ liệu theo người dùng (layout `force-dynamic`)           |
| `/app/attendance`                      | `app/app/(secure)/attendance/page.tsx`               | động   | Dữ liệu theo người dùng (layout `force-dynamic`)           |
| `/app/dashboard`                       | `app/app/(secure)/dashboard/page.tsx`                | động   | Dữ liệu theo người dùng và phạm vi quyền                   |
| `/app/me`                              | `app/app/(secure)/me/page.tsx`                       | động   | Dữ liệu theo người dùng                                    |
| `/app/tasks`                           | `app/app/(secure)/tasks/page.tsx`                    | động   | Dữ liệu theo người dùng                                    |
| `/app/today`                           | `app/app/(secure)/today/page.tsx`                    | động   | Dữ liệu theo người dùng                                    |
| `/api/app/adjustments`                 | `app/api/app/adjustments/route.ts`                   | động   | API có xác thực, `no-store`                                |
| `/api/app/applications`                | `app/api/app/applications/route.ts`                  | động   | API có xác thực, `no-store`                                |
| `/api/app/approvals/[type]/[id]/[decision]` | `app/api/app/approvals/[type]/[id]/[decision]/route.ts` | động | API có xác thực, `no-store`                              |
| `/api/app/approvals`                   | `app/api/app/approvals/route.ts`                     | động   | API có xác thực, `no-store`                                |
| `/api/app/attendance/events`           | `app/api/app/attendance/events/route.ts`             | động   | API có xác thực, `no-store`                                |
| `/api/app/attendance/qr/[worksiteId]`  | `app/api/app/attendance/qr/[worksiteId]/route.ts`    | động   | Mã QR theo thời điểm, `no-store`                           |
| `/api/app/auth/login`                  | `app/api/app/auth/login/route.ts`                    | động   | Đặt phiên, `no-store`                                      |
| `/api/app/auth/logout`                 | `app/api/app/auth/logout/route.ts`                   | động   | Huỷ phiên, `no-store`                                      |
| `/api/app/comments`                    | `app/api/app/comments/route.ts`                      | động   | API có xác thực, `no-store`                                |
| `/api/app/files/[id]`                  | `app/api/app/files/[id]/route.ts`                    | động   | Tải tệp private, `private, no-store`                       |
| `/api/app/files`                       | `app/api/app/files/route.ts`                         | động   | Tải lên tệp private, `no-store`                            |
| `/api/app/inquiries`                   | `app/api/app/inquiries/route.ts`                     | động   | API có xác thực, `no-store`                                |
| `/api/app/leave-requests`              | `app/api/app/leave-requests/route.ts`                | động   | API có xác thực, `no-store`                                |
| `/api/app/me`                          | `app/api/app/me/route.ts`                            | động   | Thông tin phiên hiện tại, `no-store`                       |
| `/api/app/ot-requests`                 | `app/api/app/ot-requests/route.ts`                   | động   | API có xác thực, `no-store`                                |
| `/api/app/privacy/requests/[id]/[action]` | `app/api/app/privacy/requests/[id]/[action]/route.ts` | động | Xử lý/xuất dữ liệu yêu cầu chủ thể (quyền `privacy.manage`), `no-store` |
| `/api/app/privacy/requests` | `app/api/app/privacy/requests/route.ts` | động | Danh sách/tạo yêu cầu chủ thể (quyền `privacy.manage`), `no-store` |
| `/api/app/sync`                        | `app/api/app/sync/route.ts`                          | động   | Đồng bộ hàng chờ offline, `no-store`                       |
| `/api/app/tasks/[id]/[action]`         | `app/api/app/tasks/[id]/[action]/route.ts`           | động   | API có xác thực, `no-store`                                |
| `/api/app/tasks`                       | `app/api/app/tasks/route.ts`                         | động   | API có xác thực, `no-store`                                |
