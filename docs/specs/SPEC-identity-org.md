---
title: SPEC-identity-org
features: [F-001, F-002]
status: approved
approved_by: "autopilot D-006"
approved_at: 2026-10-18
updated: 2026-10-24
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
- Xác thực bổ sung (TOTP) bắt buộc với `sysadmin`, `hr`, `executive` — chi tiết ở mục con dưới (T-086).

### Xác thực hai bước (TOTP) — AUD-SEC-002, D-058

- Thuật toán: TOTP RFC 6238 trên HOTP RFC 4226 — HMAC-SHA1 của `node:crypto`, bước 30 s, 6 chữ số, chấp nhận lệch ±1 bước; bí mật 20 byte ngẫu nhiên (`randomBytes`), hiển thị base32 (RFC 4648, không padding) + URI `otpauth://totp/X-Company:<email>?secret=…&issuer=X-Company&algorithm=SHA1&digits=6&period=30`. So mã bằng `timingSafeEqual`. Không thêm phụ thuộc, không gọi dịch vụ QR ngoài.
- Bắt buộc với người dùng có grant **còn hiệu lực** vai trò `sysadmin`, `hr` hoặc `executive` (hằng `MFA_REQUIRED_ROLES`), và với mọi người đã bật TOTP.
- Lưu trữ: `app_user.totp_secret_enc` (mã hoá cột qua `lib/crypto/columns`, nhãn PII đã khai "planned" trong `docs/privacy/data-map.yaml`), `totp_enabled_at`, `totp_last_step_seq` (bigint, chống phát lại). Bí mật không bao giờ vào log/audit (khoá `totp` đã bị che).
- Luồng đăng nhập:
  1. `POST /api/app/auth/login` đúng mật khẩu, người dùng không cần MFA → như cũ (cookie phiên).
  2. Cần MFA → **không** cấp phiên; trả `200 {mfa: "totp", challenge}` (đã đăng ký) hoặc `200 {mfa: "totp_enroll", challenge, secret, otpauth_uri}` (chưa đăng ký — tin lần đầu, TOFU; bí mật tạm lưu mã hoá trong thử thách). `challenge` = token ngẫu nhiên 256 bit, lưu băm SHA-256 trong `mfa_challenge` (user_id, purpose, secret_enc NULL, attempts, expires_at = +5 phút). Lượt mật khẩu đúng được ghi `success=true` như cũ.
  3. `POST /api/app/auth/mfa` `{challenge, code}` (cùng Origin) → thử thách còn hạn và `attempts < 5`; mã đúng trong cửa sổ và bước > `totp_last_step_seq` → cập nhật `totp_last_step_seq` (enroll: ghi bí mật + `totp_enabled_at`, audit `auth.mfa_enroll`), xoá thử thách, tạo phiên **đã xác thực hai bước**, audit `auth.login`, cookie như bước 1.
  4. Mã sai → `attempts+1`, audit `auth.mfa` `denied`, 401 `INVALID_MFA_CODE`; lần sai thứ 5 xoá thử thách (phải đăng nhập lại). Giới hạn theo người dùng: 10 lần sai TOTP / 15 phút qua mọi thử thách → 429 kèm `Retry-After`. Thử thách hết hạn/không tồn tại/đã dùng → 401 `MFA_CHALLENGE_INVALID` (một thông điệp). Mã đã dùng (bước ≤ `totp_last_step_seq`) → như mã sai.
- Phiên: cột `session.mfa_at`; mỗi request (`withActor`) actor có vai trò bắt buộc mà phiên không có `mfa_at` → 401 `MFA_REQUIRED` (vd vừa được cấp `hr` khi đang đăng nhập) — có hiệu lực ngay như R8.
- Khôi phục: không có mã dự phòng ở P0; mất thiết bị → sysadmin chạy `npm run -s mfa:reset -- <email>` (xoá bí mật, huỷ phiên, audit `auth.mfa_reset`), lần đăng nhập kế đăng ký lại. Bootstrap sysadmin đầu tiên cũng đăng ký ở lần đăng nhập đầu.
- Rủi ro còn lại: TOFU — ai có mật khẩu của người chưa đăng ký có thể đăng ký trước (giảm: đăng ký ngay khi được cấp vai trò; pilot chưa có dữ liệu thật). Ghi THREAT-MODEL T1.
- Ghi chú triển khai (T-086): `app_user.totp_secret` có trong schema nhưng CHECK buộc luôn NULL — chỉ `totp_secret_enc` mang giá trị (sổ đăng ký `lib/crypto/columns.ts`, data-map `implemented`); đếm lần sai theo người dùng ở bảng `mfa_failure` (tự dọn dòng quá 15 phút); cấp thử thách ghi audit `auth.mfa_challenge`; sự kiện bảo mật `auth.mfa`/`auth.mfa_reset`. Cấp grant ngay lập tức vẫn huỷ mọi phiên (BE-AUTH-004 → 401 `UNAUTHENTICATED`); `MFA_REQUIRED` xảy ra khi grant hẹn giờ (`valid_from` tương lai) tới hiệu lực trong lúc phiên không MFA còn sống. Trang server (`app/server/session.ts`) dùng cùng điều kiện, coi phiên thiếu bước hai là chưa đăng nhập.

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
- S-ID-10: Given HR đã bật TOTP — When đăng nhập đúng mật khẩu — Then không có cookie phiên, có `challenge`; When gửi mã đúng — Then 200 + cookie phiên.
- S-ID-11: Given thử thách hợp lệ — When gửi mã sai 5 lần — Then thử thách bị huỷ (lần 6 trả `MFA_CHALLENGE_INVALID`); mã đúng đã dùng một lần — When gửi lại trong cùng bước — Then 401.
- S-ID-12: Given sysadmin chưa đăng ký — When đăng nhập — Then nhận `totp_enroll` + bí mật; When xác nhận mã đúng — Then TOTP bật và có phiên.
- S-ID-13: Given nhân viên đang có phiên không MFA — When được cấp vai trò `hr` — Then request kế tiếp 401 `MFA_REQUIRED`.
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
| AC-ID-10 | chuẩn | Given HR đã bật TOTP, When đăng nhập đúng mật khẩu Then không cấp phiên mà trả thử thách; When gửi mã đúng Then cấp phiên | S-ID-10 |
| AC-ID-11 | lỗi | Given thử thách, When 5 mã sai Then thử thách huỷ; When phát lại mã đã dùng Then 401 | S-ID-11 |
| AC-ID-12 | chuẩn | Given sysadmin chưa đăng ký, When đăng nhập rồi xác nhận mã Then TOTP bật và có phiên | S-ID-12 |
| AC-ID-13 | lỗi | Given phiên không MFA, When được cấp vai trò bắt buộc Then request kế tiếp 401 `MFA_REQUIRED` | S-ID-13 |

## Ca biên

Nhóm theo PM-SPEC-003 (8 nhóm). "Phủ bởi" nêu test đã có; "chưa có test" là nợ ghi rõ, không phải đã phủ.

| Nhóm | Ca biên | Hành vi mong đợi | Phủ bởi |
|---|---|---|---|
| Rỗng/null | tên/mã chỉ có khoảng trắng; `parent_id` null; toạ độ chỉ có lat hoặc lng | CHECK/ràng buộc từ chối; `parent_id` null là gốc cây; toạ độ phải đủ cặp hoặc cùng null | `tests/db/org.test.ts` |
| Cực đại | cây phòng ban rất sâu | trigger chống chu trình duyệt tối đa 1000 bậc, không lặp vô hạn | chưa có test độ sâu |
| Trùng lặp/idempotency | mã trùng trong công ty; email khác hoa/thường | `DUPLICATE`; email so sánh không phân biệt hoa thường | `tests/db/org.test.ts`, `tests/http/auth.test.ts` |
| Song song | 20 giao dịch ghi audit cùng chuỗi; đăng nhập sai song song; cùng mã TOTP gửi song song cho nhiều thử thách | chuỗi tuyến tính; vẫn chặn từ lần sai thứ 6; đúng một phiên được cấp | `tests/db/audit.test.ts`, `tests/db/review-pr8.test.ts`, `tests/http/mfa.test.ts` |
| Mất mạng giữa chừng | giao dịch rollback giữa chừng | không còn bản ghi audit lẻ (audit cùng giao dịch) | `tests/db/audit.test.ts` |
| Thời gian/múi giờ | grant hết hạn hoặc chưa tới hạn; phiên quá hạn trượt | không có hiệu lực / phiên không hợp lệ; thời điểm lưu UTC | `tests/db/authz-scope.test.ts`, `tests/http/auth.test.ts` |
| Quyền | chéo công ty, tự duyệt, vô hiệu hoá tài khoản; vai trò bắt buộc TOTP tới hiệu lực giữa phiên | 403 / 409 / 401 theo R5, R7, R8; 401 `MFA_REQUIRED` | S-ID-04, S-ID-05, S-ID-06, S-ID-13 |
| Tiền/đơn vị | không áp dụng: miền danh tính/tổ chức không xử lý tiền; đơn vị duy nhất là độ (lat/lng) và mét (`radius_m`) đã có trong tên cột | — | — |

## Câu hỏi mở

- Danh sách mật khẩu phổ biến cần chặn — Đã quyết: D-010 (mục ≥ 12 ký tự trong danh sách 100k NCSC).
- RLS theo tenant có áp dụng không — Đã quyết: D-015 (chưa; một công ty, `company_id` là khoá phạm vi dự phòng, kiểm quyền ở `can()`).
- Thời hạn lưu `session`, `login_attempt` khi pháp chế chưa chốt — Đã quyết: D-016 (cấu hình mặc định thận trọng; pháp chế chốt ở F02).
- Băm mật khẩu — Đã quyết: D-003 (Argon2id).
