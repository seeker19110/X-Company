# Sự kiện bảo mật (SEC-LOG-001/002)

Mỗi sự kiện là một dòng log JSON (stdout) do `lib/nen/security-event.ts` ghi, có thêm hàng kiểm toán chuỗi băm ở
`audit_event` cho hành động nghiệp vụ (kèm `source_ip`, `user_agent` — migration 0017).

**Schema** (`securityEventSchema`): `timestamp` (UTC ISO-8601, `Z`, ms) · `event` · `actor` `{type: user|service|anonymous, id|null}` ·
`target` `{type, id|null}` · `outcome` (`success|denied|error`) · `source_ip` · `user_agent` · `request_id` (+ `trace_id`, `span_id`).
Không ghi email, mật khẩu, token. Thành công = mức INFO, từ chối = WARN, lỗi = ERROR.

| event                     | Khi nào                                          | outcome        | Nơi phát                      |
| ------------------------- | ------------------------------------------------ | -------------- | ----------------------------- |
| `auth.login`              | đăng nhập thành công / sai thông tin             | success/denied | `lib/identity/auth.ts`        |
| `auth.logout`             | đăng xuất                                        | success        | `lib/identity/routes.ts`      |
| `auth.rate_limited`       | vượt 5 lần sai / 15 phút                         | denied         | `lib/identity/auth.ts`        |
| `authz.denied`            | từ chối quyền (403) ở `authorize`/`withActor`    | denied         | `lib/http/index.ts`           |
| `input.validation_failed` | dữ liệu gửi lên sai schema (400)                 | denied         | `lib/http/index.ts`           |
| `ops.alert`               | cảnh báo vận hành bắn (error) / hết (success)    | error/success  | `lib/ops/sinks.ts`            |

## Chưa nối (tính năng chưa tồn tại hoặc chưa phát sự kiện log)
Đổi mật khẩu/MFA, cấp/thu hồi token, đổi vai/quyền (đã có audit `grant.*`, chưa có dòng log), hành động admin, xuất dữ liệu
nhạy cảm, upload, đổi cấu hình, lỗi deserialize, lỗi TLS backend — SEC-LOG-001 còn thiếu các mục này.
