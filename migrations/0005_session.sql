-- Phiên đăng nhập (lưu BĂM của token, không lưu token) và lần đăng nhập sai để giới hạn (SPEC-identity-org).
CREATE TABLE session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES app_user (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  user_agent text,
  ip text
);
CREATE INDEX session_user_idx ON session (user_id);

CREATE TABLE login_attempt (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL,
  ip text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  success boolean NOT NULL
);
CREATE INDEX login_attempt_lookup_idx ON login_attempt (email, ip, attempted_at DESC);
