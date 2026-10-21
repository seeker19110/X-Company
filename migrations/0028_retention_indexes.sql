-- Job retention (AUD-PERF-002, T-064): mỗi bộ chọn hàng quá hạn trong lib/worker/retention.ts (RETENTION_SELECTORS) có index
-- dùng được, để xoá/ẩn danh theo lô không phải quét cả bảng. rum_sample, public_rate_event, outbox_event (done) đã có index
-- (0021, 0026). Chỉ thêm index — không đổi dữ liệu. Đường lùi: ứng dụng bản trước không dùng các index này; gỡ bằng migration
-- contract (DROP INDEX …) khi không cần. Bảng còn nhỏ (chưa có dữ liệu thật) nên không cần CONCURRENTLY.
CREATE INDEX session_absolute_expires_idx ON session (absolute_expires_at);
CREATE INDEX login_attempt_attempted_idx ON login_attempt (attempted_at);
CREATE INDEX idempotency_record_created_idx ON idempotency_record (created_at);
CREATE INDEX inquiry_retention_idx ON inquiry (created_at) WHERE anonymized_at IS NULL;
