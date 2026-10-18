# API-CONTRACT — X-Company (G4)

> Cập nhật 2026-10-18. Phiên bản API nội bộ: `v1` ngầm định theo đường dẫn `/api/app/*` (cùng triển khai với web).

## Quy ước
- JSON UTF-8; thời điểm ISO 8601 UTC (`Z`); ngày nghiệp vụ `YYYY-MM-DD`; id là UUID.
- Lỗi: `{"error": {"code": "SNAKE_UPPER", "message": "<tiếng Việt cho người dùng>", "details"?: {...}}, "request_id": "..."}`.
  HTTP: 400 sai định dạng · 401 chưa đăng nhập · 403 không có quyền · 404 không thấy (cả khi không có quyền đọc) · 409 xung đột (`VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `SELF_APPROVAL`) · 422 vi phạm nghiệp vụ · 429 giới hạn.
- Ghi: header `x-csrf-token` (route nội bộ); `Idempotency-Key` bắt buộc với lệnh có thể gửi lại (chấm công, gửi form, đồng bộ hàng chờ).
- Phân trang: `?cursor=&limit=` (≤ 100), trả `next_cursor`.

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
