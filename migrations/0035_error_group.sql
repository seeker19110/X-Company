-- Kho lỗi tự host (T-122, PRF-WEB-008): lỗi client (POST /api/public/errors) và lỗi 500 chưa bắt ở server (publicRoute/withActor,
-- onRequestError) gom theo NHÓM. Chỉ thêm — không sửa migration cũ.
-- Một dòng = một (fingerprint, release): fingerprint = sha256(nguồn + loại lỗi + khung stack đầu đã chuẩn hoá [+ thông điệp đã chuẩn
-- hoá khi không có khung] + ngữ cảnh) tính ở lib/errors — lần lặp cùng nhóm chỉ tăng `occurrence_count` + `last_seen_at`, không thêm dòng.
-- KHÔNG lưu IP, user agent, mã người dùng, URL đầy đủ: `page` là nhãn trang đã chuẩn hoá (lib/rum/page.pure.ts, tập giá trị bị chặn),
-- `stack` chỉ giữ dòng khung đã bỏ origin/query, `message` đã che bí mật/PII (redactString + dãy số dài) — vẫn khai PII vì là văn bản
-- tự do có thể sót dữ liệu cá nhân (docs/privacy/data-map.yaml). Quyền đọc: `errors.read` (sysadmin) qua GET /api/app/errors.
-- Thời hạn lưu: RETENTION_ERROR_DAYS (mặc định 30) tính từ `last_seen_at` (lib/worker/retention.ts).
-- Đường lùi: ứng dụng bản trước không biết bảng này (không ghi, không đọc). Gỡ bằng migration "contract" sau khi không còn bản nào
-- ghi: DROP TABLE error_group.

CREATE TABLE error_group (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('client', 'server')),
  -- Phiên bản build (APP_VERSION; "dev" khi không đặt) — khoá thư mục source map riêng tư .data/sourcemaps/<release>/.
  release text NOT NULL CHECK (release ~ '^[A-Za-z0-9._+-]{1,64}$'),
  -- Fingerprint của nhóm (sha256 hex). Tên cột KHÔNG dùng "fingerprint": từ đó thuộc bộ dò cột sinh trắc (tests/db/geo-consent.test.ts).
  group_key text NOT NULL CHECK (group_key ~ '^[0-9a-f]{64}$'),
  error_type text NOT NULL CHECK (length(error_type) BETWEEN 1 AND 100),
  message text NOT NULL CHECK (length(message) <= 1000),
  stack text CHECK (stack IS NULL OR length(stack) <= 8000),
  page text CHECK (page IS NULL OR (length(page) <= 64 AND page LIKE '/%')),
  context text CHECK (context IS NULL OR length(context) <= 200),
  -- Số lần gặp; kẹp ở trần int4 khi tăng (không tràn).
  occurrence_count integer NOT NULL DEFAULT 1 CHECK (occurrence_count >= 1),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT error_group_seen_order CHECK (last_seen_at >= first_seen_at),
  -- Gom nhóm: cùng fingerprint trong cùng release = một dòng.
  CONSTRAINT error_group_key_release_key UNIQUE (group_key, release)
);
-- Retention (last_seen_at < mốc) + danh sách mới nhất trước.
CREATE INDEX error_group_last_seen_idx ON error_group (last_seen_at);
-- Trần nhóm MỚI mỗi ngày UTC (đếm chặn theo first_seen_at).
CREATE INDEX error_group_first_seen_idx ON error_group (first_seen_at);

COMMENT ON COLUMN error_group.message IS 'PII: thông điệp lỗi đã che, văn bản tự do có thể sót dữ liệu cá nhân; class=PII; enc=no';
