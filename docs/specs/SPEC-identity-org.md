---
title: SPEC-identity-org
features: [F-001, F-002]
status: approved
approved_by: "autopilot D-006"
approved_at: 2026-10-18
updated: 2026-10-18
---

# SPEC — Danh tính, tổ chức, phân quyền, nhật ký kiểm toán (F-001, F-002)

Trạng thái: Approved for implementation (D-006)

> Nguồn: kế hoạch §5, §11 (dữ liệu cốt lõi), §12. Nghiệm thu: AT02, AT12. Cập nhật 2026-10-18.

## Mô hình
- `company` (pháp nhân/công ty) → `branch` → `department` (cây, `parent_id`) ; `worksite` (địa điểm làm việc, toạ độ + bán kính tuỳ chọn).
- `employee` (hồ sơ nhân sự, mã nhân viên duy nhất trong công ty) — `employment_history` ghi đơn vị/chức danh/quản lý trực tiếp **theo khoảng hiệu lực** `[valid_from, valid_to)`; báo cáo lịch sử dùng bản ghi tại thời điểm đó (§11 "không viết lại theo phòng ban hiện tại").
- `app_user` (tài khoản đăng nhập, email duy nhất toàn hệ thống, `disabled_at`) liên kết 0..1 `employee`.
- `membership(user, company)` + `role_grant(user, company, role, scope_type, scope_id)`; `scope_type` ∈ `company | branch | department | project | self`.
- Vai trò (§5): `employee`, `team_lead`, `project_manager`, `hr`, `accountant`, `editor`, `sales`, `executive`, `sysadmin`. Một người nhiều vai trò.

## Quy tắc quyền (kiểm ở server, mặc định từ chối)
- R1. Mọi request vào `/app/**` và `/api/app/**` cần phiên hợp lệ; không có → 401 (API) / chuyển đăng nhập (trang).
- R2. Quyết định quyền = hàm thuần `can(actor, action, resource)` với `actor` gồm danh sách `role_grant` còn hiệu lực; `resource` mang `company_id` và các trục phạm vi (`branch_id`, `department_id`, `project_id`, `owner_employee_id`). Không khớp quyền nào → từ chối.
- R3. Phạm vi `department` bao gồm cả phòng ban con (cây). Phạm vi `self` chỉ dữ liệu có `owner_employee_id` = nhân viên của actor.
- R4. `project_manager` của dự án **không** tự có quyền đọc hồ sơ HR, công, lương của thành viên (§5).
- R5. Không ai duyệt đơn do chính mình tạo (áp cho mọi loại phê duyệt) — kể cả `hr`, `executive`.
- R6. Xuất dữ liệu nhạy cảm (`export_sensitive`) là quyền riêng, không suy ra từ vai trò nào trừ khi cấp tường minh.
- R7. `company_id` của tài nguyên phải khớp `company_id` của grant; không có quyền liên công ty.
- R8. Vô hiệu hoá tài khoản hoặc thu hồi grant có hiệu lực **ngay ở request kế tiếp** (phiên kiểm lại `disabled_at` và phiên bản quyền trên mỗi request) — AT12.

## Phiên & xác thực
- Mật khẩu Argon2id (D-003), tối thiểu 12 ký tự, chặn mật khẩu phổ biến (danh sách cục bộ 100k NCSC qua SecLists, phần dài ≥ 12 ký tự — D-010).
- Phiên: id ngẫu nhiên 256 bit lưu băm SHA-256 trong bảng `session`; cookie `__Host-xc_session` HttpOnly, Secure, SameSite=Lax, hết hạn trượt 12 giờ, tuyệt đối 7 ngày. Đăng xuất xoá bản ghi phiên.
- CSRF: request thay đổi trạng thái phải có header `x-csrf-token` khớp token gắn phiên (double-submit có ký) và `Origin` cùng site.
- Giới hạn đăng nhập: 5 lần sai / 15 phút / (email, IP) → 429 kèm `Retry-After`. Chống dò rải (D-053): 30 lần sai / 15 phút / IP qua mọi email; 50 lần sai / 15 phút / email qua mọi IP.
- Xác thực bổ sung (TOTP) bắt buộc với `sysadmin`, `hr`, `executive` — P0 lát sau (T-0xx), trước pilot.

## Nhật ký kiểm toán (F-002)
- `audit_event`: `id`, `occurred_at` (UTC), `actor_user_id` (null = hệ thống), `company_id`, `action`, `object_type`, `object_id`, `reason`, `result` (`ok|denied|error`), `before`/`after` (JSONB, đã che trường nhạy cảm), `request_id`, `prev_hash`, `hash`.
- Ghi trong **cùng giao dịch** với thay đổi nghiệp vụ. Chỉ INSERT: role ứng dụng không có UPDATE/DELETE trên bảng (GRANT), có trigger chặn UPDATE/DELETE.
- `hash = sha256(prev_hash || canonical_json(bản ghi))`; khoá tư vấn theo `company_id` để chuỗi tuyến tính; lệnh `verify-audit-chain` báo bản ghi đầu tiên sai.
- Từ chối quyền ở thao tác ghi cũng ghi `result=denied`.

## Kịch bản (Given/When/Then)
- S-ID-01: Given nhân viên A (role `employee`, scope `self`) — When đọc bảng công của B — Then 403 và có `audit_event` `denied`.
- S-ID-02: Given trưởng nhóm T scope `department=D1`, D1 có con D1a — When đọc đơn nghỉ nhân viên ở D1a — Then 200; ở D2 — Then 403.
- S-ID-03: Given PM của dự án P — When đọc hồ sơ HR của thành viên dự án — Then 403 (R4).
- S-ID-04: Given HR H tạo đơn sửa công cho chính mình — When H duyệt — Then 409 `SELF_APPROVAL` (R5).
- S-ID-05: Given phiên hợp lệ của U — When admin vô hiệu U — Then request kế tiếp của U trả 401 (R8).
- S-ID-06: Given grant công ty C1 — When truy cập tài nguyên C2 cùng id phòng ban — Then 403 (R7).
- S-ID-07: Given 5 lần sai mật khẩu — When lần thứ 6 trong 15 phút — Then 429.
- S-ID-08: Given chuỗi audit hợp lệ — When ai đó sửa trực tiếp một hàng bằng superuser — Then `verify-audit-chain` exit 1 và chỉ ra id.
- S-ID-09: Given request POST thiếu `x-csrf-token` — Then 403.
- Ca biên: grant hết hạn (`valid_to` quá khứ) = không có; cây phòng ban có chu trình bị chặn bằng ràng buộc khi ghi; email so sánh không phân biệt hoa thường.

## Tiêu chí chấp nhận

Mỗi tiêu chí `AC-<MIỀN>-NN` ánh xạ 1-1 tới một kịch bản `S-*` ở mục Kịch bản; test mang mã `S-*` trong `tests/` hoặc `e2e/` (script `npm run -s check:docs` đối chiếu AC → S-ID → test, WF-SDD-003). Loại: chuẩn · lỗi (ca lỗi) · biên.

| ID | Loại | Tiêu chí (Given/When/Then) | Kịch bản (S-ID) |
|---|---|---|---|
| AC-ID-01 | lỗi | Given nhân viên A (`employee`, scope `self`), When đọc bảng công của B, Then 403 và có `audit_event` `denied` | S-ID-01 |
| AC-ID-02 | chuẩn | Given trưởng nhóm T scope `department=D1` (D1 có con D1a), When đọc đơn nghỉ ở D1a Then 200; ở D2 Then 403 | S-ID-02 |
| AC-ID-03 | lỗi | Given PM của dự án P, When đọc hồ sơ HR của thành viên dự án, Then 403 (R4) | S-ID-03 |
| AC-ID-04 | lỗi | Given HR H tạo đơn sửa công cho chính mình, When H duyệt, Then 409 `SELF_APPROVAL` (R5) | S-ID-04 |
| AC-ID-05 | lỗi | Given phiên hợp lệ của U, When admin vô hiệu U hoặc thu hồi grant, Then request kế tiếp của U trả 401 / mất vai trò ngay (R8) | S-ID-05 |
| AC-ID-06 | lỗi | Given grant công ty C1, When truy cập tài nguyên C2 cùng id phòng ban, Then 403 (R7) | S-ID-06 |
| AC-ID-07 | lỗi | Given 5 lần sai mật khẩu, When lần thứ 6 trong 15 phút, Then 429 kèm `Retry-After` | S-ID-07 |
| AC-ID-08 | lỗi | Given chuỗi audit hợp lệ, When ai đó sửa trực tiếp một hàng bằng superuser, Then `verify-audit-chain` exit 1 và chỉ ra id | S-ID-08 |
| AC-ID-09 | lỗi | Given request POST thiếu/sai `x-csrf-token` hoặc khác Origin, Then 403 | S-ID-09 |

## Ca biên

Nhóm theo PM-SPEC-003 (8 nhóm). "Phủ bởi" nêu test đã có; "chưa có test" là nợ ghi rõ, không phải đã phủ.

| Nhóm | Ca biên | Hành vi mong đợi | Phủ bởi |
|---|---|---|---|
| Rỗng/null | tên/mã chỉ có khoảng trắng; `parent_id` null; toạ độ chỉ có lat hoặc lng | CHECK/ràng buộc từ chối; `parent_id` null là gốc cây; toạ độ phải đủ cặp hoặc cùng null | `tests/db/org.test.ts` |
| Cực đại | cây phòng ban rất sâu | trigger chống chu trình duyệt tối đa 1000 bậc, không lặp vô hạn | chưa có test độ sâu |
| Trùng lặp/idempotency | mã trùng trong công ty; email khác hoa/thường | `DUPLICATE`; email so sánh không phân biệt hoa thường | `tests/db/org.test.ts`, `tests/http/auth.test.ts` |
| Song song | 20 giao dịch ghi audit cùng chuỗi; đăng nhập sai song song | chuỗi tuyến tính; vẫn chặn từ lần sai thứ 6 | `tests/db/audit.test.ts`, `tests/db/review-pr8.test.ts` |
| Mất mạng giữa chừng | giao dịch rollback giữa chừng | không còn bản ghi audit lẻ (audit cùng giao dịch) | `tests/db/audit.test.ts` |
| Thời gian/múi giờ | grant hết hạn hoặc chưa tới hạn; phiên quá hạn trượt | không có hiệu lực / phiên không hợp lệ; thời điểm lưu UTC | `tests/db/authz-scope.test.ts`, `tests/http/auth.test.ts` |
| Quyền | chéo công ty, tự duyệt, vô hiệu hoá tài khoản | 403 / 409 / 401 theo R5, R7, R8 | S-ID-04, S-ID-05, S-ID-06 |
| Tiền/đơn vị | không áp dụng: miền danh tính/tổ chức không xử lý tiền; đơn vị duy nhất là độ (lat/lng) và mét (`radius_m`) đã có trong tên cột | — | — |

## Câu hỏi mở

- Danh sách mật khẩu phổ biến cần chặn — Đã quyết: D-010 (mục ≥ 12 ký tự trong danh sách 100k NCSC).
- RLS theo tenant có áp dụng không — Đã quyết: D-015 (chưa; một công ty, `company_id` là khoá phạm vi dự phòng, kiểm quyền ở `can()`).
- Thời hạn lưu `session`, `login_attempt` khi pháp chế chưa chốt — Đã quyết: D-016 (cấu hình mặc định thận trọng; pháp chế chốt ở F02).
- Băm mật khẩu — Đã quyết: D-003 (Argon2id).
