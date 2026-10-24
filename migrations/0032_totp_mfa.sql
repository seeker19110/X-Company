-- Xác thực hai bước TOTP cho vai trò nhạy cảm (AUD-SEC-002, D-058; SPEC-identity-org mục "Xác thực hai bước"). Chỉ thêm —
-- không sửa migration cũ, không đổi dữ liệu.
--   · app_user: bí mật TOTP mã hoá cột (lib/crypto/columns — sổ đăng ký `app_user.totp_secret`), mốc bật, bước đã dùng cuối
--     (chống phát lại). Cột bản rõ `totp_secret` chỉ để khớp mô hình expand/contract của sổ đăng ký và data-map; CHECK buộc
--     nó LUÔN NULL — bí mật không bao giờ được lưu dạng rõ.
--   · session.mfa_at: phiên đã qua bước hai (NULL = chưa). withActor từ chối 401 MFA_REQUIRED khi actor có vai trò bắt buộc.
--   · mfa_challenge: thử thách sau bước mật khẩu (lưu BĂM SHA-256 của token, hạn 5 phút, tối đa 5 lần sai); thử thách đăng ký
--     mang bí mật tạm (mã hoá, AAD = mfa_challenge.secret_enc + id dòng).
--   · mfa_failure: lần nhập sai mã theo người dùng (giới hạn 10 / 15 phút qua mọi thử thách); ứng dụng tự dọn dòng quá cửa sổ.
-- Quyền: bảng mới nhận SELECT/INSERT/UPDATE/DELETE cho xc_app_rw qua ALTER DEFAULT PRIVILEGES (0001) — không cần GRANT riêng.
-- Đường lùi: mọi cột mới nullable/có mặc định, bảng mới độc lập → ứng dụng bản trước chạy nguyên trên schema này (không đọc cột
-- mới; đăng nhập như cũ, không TOTP). Gỡ hẳn: migration contract sau — DROP TABLE mfa_failure, mfa_challenge; ALTER TABLE
-- session DROP COLUMN mfa_at; ALTER TABLE app_user DROP COLUMN totp_secret, totp_secret_enc, totp_enabled_at, totp_last_step_seq.

ALTER TABLE app_user
  ADD COLUMN totp_secret text CONSTRAINT app_user_totp_secret_never_plain CHECK (totp_secret IS NULL),
  ADD COLUMN totp_secret_enc text,
  ADD COLUMN totp_enabled_at timestamptz,
  ADD COLUMN totp_last_step_seq bigint CONSTRAINT app_user_totp_last_step_nonneg CHECK (totp_last_step_seq >= 0),
  ADD CONSTRAINT app_user_totp_enabled_has_secret CHECK (totp_enabled_at IS NULL OR totp_secret_enc IS NOT NULL);

ALTER TABLE session ADD COLUMN mfa_at timestamptz;

CREATE TABLE mfa_challenge (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('verify', 'enroll')),
  secret_enc text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK ((purpose = 'enroll') = (secret_enc IS NOT NULL)),
  CHECK (expires_at > created_at)
);
CREATE INDEX mfa_challenge_user_idx ON mfa_challenge (user_id);

CREATE TABLE mfa_failure (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  failed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mfa_failure_user_idx ON mfa_failure (user_id, failed_at DESC);

-- Nhãn PII (khớp docs/privacy/data-map.yaml + sổ đăng ký mã hoá; test tests/db/encryption.test.ts đối chiếu hai chiều).
COMMENT ON COLUMN app_user.totp_secret IS 'PII: bí mật TOTP; class=SECRET; enc=yes';
COMMENT ON COLUMN app_user.totp_secret_enc IS 'ENC: bản mã AES-256-GCM của bí mật TOTP (app_user.totp_secret); class=SECRET';
COMMENT ON COLUMN mfa_challenge.secret_enc IS 'ENC: bản mã AES-256-GCM của bí mật TOTP chờ xác nhận đăng ký (sống ≤ 5 phút); class=SECRET';
COMMENT ON COLUMN mfa_challenge.token_hash IS 'PII: băm token thử thách TOTP; class=SECRET; enc=no';
