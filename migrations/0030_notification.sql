-- Thông báo trong ứng dụng (T-080, D-058; SPEC-work W3/AT11, F-010; AUD-DOC-002). Chỉ thêm — không sửa migration cũ.
-- Worker outbox ghi một hàng cho MỖI người nhận, trong cùng giao dịch với đánh dấu đã xử lý (lib/notify, lib/worker/handlers.ts).
-- KHÔNG lưu nội dung/PII: chỉ chủ đề, loại + id đối tượng và `code` (mã hồ sơ/việc, ví dụ LH-…/UV-…) — người nhận mở đối tượng
-- qua API có kiểm quyền để xem chi tiết. Quyền: GRANT mặc định của schema (0001) cho xc_app_rw; mọi truy vấn lọc theo
-- user_id = actor ở lib/notify (chỉ chủ sở hữu đọc/đánh dấu).
-- Thời hạn lưu: đã đọc 90 ngày, chưa đọc 365 ngày (lib/worker/retention.ts).
-- Đường lùi: ứng dụng bản trước không biết bảng này. Gỡ bằng migration "contract" sau khi không còn bản nào ghi: DROP TABLE notification.

CREATE TABLE notification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  topic text NOT NULL CHECK (length(topic) <= 64 AND topic ~ '^[a-z_]+\.[a-z_]+$'),
  ref_type text NOT NULL CHECK (ref_type IN ('inquiry', 'job_application', 'task')),
  ref_id uuid NOT NULL,
  -- Mã tra cứu (không phải tên/email); NULL khi sự kiện không mang mã.
  code text CHECK (code IS NULL OR length(code) BETWEEN 1 AND 64),
  -- Id outbox_event nguồn — không FK: retention xoá outbox done cũ trước khi thông báo hết hạn.
  source_event_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  -- Thông báo thuần phụ thuộc vòng đời tài khoản → CASCADE (DB-MODEL-004, allowlist ở tests/db/reliability.test.ts);
  -- (company_id, user_id) bảo đảm người nhận thuộc đúng công ty.
  CONSTRAINT notification_user_fkey FOREIGN KEY (company_id, user_id) REFERENCES app_user (company_id, id) ON DELETE CASCADE,
  -- Lũy đẳng: chạy lại cùng sự kiện không tạo bản trùng cho cùng người nhận.
  CONSTRAINT notification_source_user_key UNIQUE (source_event_id, user_id)
);

-- Danh sách của tôi (mới nhất trước) + đếm chưa đọc; cột đầu phủ FK (company_id, user_id) và FK company_id.
CREATE INDEX notification_user_idx ON notification (company_id, user_id, created_at DESC, id DESC);
-- Retention: đã đọc quá hạn / chưa đọc quá hạn (cùng biểu thức với RETENTION_SELECTORS).
CREATE INDEX notification_read_retention_idx ON notification (read_at) WHERE read_at IS NOT NULL;
CREATE INDEX notification_unread_retention_idx ON notification (created_at) WHERE read_at IS NULL;
