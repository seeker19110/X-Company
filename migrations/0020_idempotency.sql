-- ARC-INT-001 / BE-API-008: khoá idempotency cho POST ghi nghiệp vụ (/api/app/*) + BE-REL-006: bộ đếm tần suất theo user.

-- Một khoá theo (công ty, người dùng, khoá) — khoá của người này không dùng được cho người khác. request_hash =
-- sha256(method + route + body chuẩn hoá). Phản hồi lưu nguyên văn (text) để phát lại đúng từng byte.
-- TTL 24 giờ (expires_at); dọn hàng hết hạn bằng job (T-029) — index idempotency_record_expires_idx phục vụ việc đó.
CREATE TABLE idempotency_record (
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  key text NOT NULL CHECK (length(key) BETWEEN 8 AND 255),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('processing', 'done')),
  response_status integer CHECK (response_status BETWEEN 200 AND 299),
  response_body text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  PRIMARY KEY (company_id, user_id, key),
  FOREIGN KEY (company_id, user_id) REFERENCES app_user (company_id, id) ON DELETE RESTRICT,
  CHECK ((state = 'done') = (response_status IS NOT NULL AND response_body IS NOT NULL))
);
CREATE INDEX idempotency_record_expires_idx ON idempotency_record (expires_at);

-- Cửa sổ cố định theo (user, nhóm route): upsert tăng n trong một câu lệnh (nguyên tử giữa nhiều instance).
-- Hàng cũ dọn bằng job (T-029) theo window_start.
CREATE TABLE api_rate_window (
  user_id uuid NOT NULL,
  bucket text NOT NULL,
  window_start timestamptz NOT NULL,
  n integer NOT NULL CHECK (n > 0),
  PRIMARY KEY (user_id, bucket, window_start)
);
CREATE INDEX api_rate_window_start_idx ON api_rate_window (window_start);
