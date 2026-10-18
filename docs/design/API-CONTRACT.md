# API-CONTRACT — X-Company (G4)

> Cập nhật 2026-10-18. Phiên bản API nội bộ: `v1` ngầm định theo đường dẫn `/api/app/*` (cùng triển khai với web).

## Quy ước
- JSON UTF-8; thời điểm ISO 8601 UTC (`Z`); ngày nghiệp vụ `YYYY-MM-DD`; id là UUID.
- Lỗi: `{"error": {"code": "SNAKE_UPPER", "message": "<tiếng Việt cho người dùng>", "details"?: {...}}, "request_id": "..."}`.
  HTTP: 400 sai định dạng · 401 chưa đăng nhập · 403 không có quyền · 404 không thấy (cả khi không có quyền đọc) · 409 xung đột (`VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `IDEMPOTENCY_IN_PROGRESS`, `SELF_APPROVAL`) · 422 vi phạm nghiệp vụ (`IDEMPOTENCY_KEY_REUSED`) · 429 giới hạn (`RATE_LIMITED`, kèm `Retry-After`).
- Ghi: header `x-csrf-token` (route nội bộ); `Idempotency-Key` bắt buộc với lệnh có thể gửi lại (xem mục Idempotency).
- Phân trang: `?cursor=&limit=` (≤ 100), trả `next_cursor`.

## Idempotency và giới hạn tần suất (ARC-INT-001, BE-API-008, BE-REL-006)
Cài ở `lib/http/idempotency.ts`, bật qua `withActor(handler, { idempotent: true, rateLimit })`; bảng `idempotency_record`, `api_rate_window` (migration 0020).
- **Áp dụng** (header `Idempotency-Key` BẮT BUỘC): POST `/api/app/leave-requests`, `/ot-requests`, `/adjustments`, `/approvals/:type/:id/:decision`, `/tasks/:id/:action`, `/comments`, `/files`. Khoá 8–255 ký tự in được (không khoảng trắng), nên là UUID v4 mới cho mỗi thao tác.
- **Không áp** (đã idempotent theo bản ghi, giữ cơ chế riêng): `/attendance/events` (header `Idempotency-Key` bắt buộc, UNIQUE trong DB), `/sync` (khoá = `id` từng bản ghi hàng chờ), form công khai (`submission_id`), `/auth/*`.
- **Phạm vi khoá**: `(company_id, user_id, key)` — khoá của người này vô nghĩa với người khác. `request_hash` = sha256(method + route + body chuẩn hoá: khoá JSON sắp xếp; multipart băm trường + nội dung tệp).
- **Kết quả**: thiếu/sai định dạng → 400 `IDEMPOTENCY_KEY_REQUIRED` · cùng khoá + cùng hash → phát lại đúng status/body đã lưu (header `Idempotent-Replayed: true`), không ghi lần hai · cùng khoá khác hash (payload hoặc route) → 422 `IDEMPOTENCY_KEY_REUSED` · đang xử lý → 409 `IDEMPOTENCY_IN_PROGRESS` (`Retry-After: 1`). Chỉ phản hồi 2xx được lưu; lỗi nhả khoá để sửa payload rồi gửi lại. Lưu 24 giờ (`expires_at`; hàng hết hạn coi như không có, job dọn: T-029). `processing` quá 120 giây (tiến trình chết) cho chạy lại.
- **Giới hạn**: phản hồi lưu ở giao dịch riêng ngay sau commit nghiệp vụ (handler tự mở giao dịch); tiến trình chết đúng giữa hai commit có thể ghi trùng một lần sau khi hết 120 giây.
- **Giới hạn tần suất** theo `user_id`, cửa sổ cố định 60 giây, đếm ở DB (đúng khi nhiều instance): `/files` 60, `/comments` 60, `/sync` 60 lượt/phút → 429 `RATE_LIMITED` + `Retry-After` (giây tới hết cửa sổ).
- **Client** (`app/components/api.ts`): mỗi POST tự sinh khoá; lỗi mạng/timeout/5xx/409/429 giữ khoá cho lần gửi lại cùng route + cùng nội dung; thành công hoặc 4xx rõ ràng thì bỏ khoá. Nút gửi vô hiệu + `aria-busy` khi đang gửi.

## Công khai (không xác thực)
| Phương thức | Đường dẫn | Mô tả |
|---|---|---|
| POST | /api/public/inquiries | Gửi liên hệ → 201 `{code}` (S-WEB-01) |
| POST | /api/public/applications | Nộp hồ sơ tuyển dụng → 201 `{code}` |

## Nội bộ
| Phương thức | Đường dẫn | Quyền |
|---|---|---|
| POST | /api/app/auth/login · /logout | — |
| GET | /api/app/me | phiên |
| GET/POST | /api/app/org/{branches,departments,worksites,employees} | `org.read` / `org.manage` |
| POST | /api/app/grants · DELETE /api/app/grants/:id | `access.manage` (sysadmin) |
| POST | /api/app/attendance/events | chính chủ (`self`) — body `{kind, device_time, qr?, geo?, worksite_id?}` + `Idempotency-Key` |
| GET | /api/app/attendance/qr/:worksiteId | `attendance.qr_display` |
| GET | /api/app/attendance/shifts?from&to&employee | `self` hoặc phạm vi |
| POST | /api/app/leave-requests · /ot-requests · /adjustments | `self` |
| POST | /api/app/approvals/:type/:id/{approve,reject} | người duyệt trong phạm vi, ≠ người tạo |
| POST | /api/app/periods/:id/{advance,lock} · GET /export | `hr` phạm vi |
| GET/POST/PATCH | /api/app/projects · /tasks (PATCH kèm `version`) | thành viên/PM |
| POST | /api/app/tasks/:id/{submit,accept,return,reopen,block,cancel} | theo SPEC-work |
| GET | /api/app/projects/:id/progress | thành viên |
| POST | /api/app/files · GET /api/app/files/:id | quyền đối tượng chứa |
| GET/POST | /api/app/cms/pages … /revisions/:id/{submit,approve,publish} | `editor` / người duyệt |
| GET/PATCH | /api/app/inquiries | `sales` |
| POST | /api/app/sync | đồng bộ lô hàng chờ: `[{id, kind, payload, created_at}]` → `[{id, status, result|error}]` |

Mọi route nội bộ có test: 401 khi không phiên, 403 khi ngoài phạm vi, 2xx đường đúng.
