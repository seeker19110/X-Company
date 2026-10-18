-- Tiếp nhận từ website (SPEC-website-cms): liên hệ → hồ sơ có mã, người phụ trách, hạn; hồ sơ ứng viên tách quyền.
CREATE TABLE outbox_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id uuid,
  topic text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  processed_at timestamptz,
  last_error text
);
CREATE INDEX outbox_event_pending_idx ON outbox_event (available_at) WHERE processed_at IS NULL;

CREATE TABLE inquiry_route (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company (id),
  -- null = hàng mặc định khi không có quy tắc theo dịch vụ
  service_slug text,
  assignee_user_id uuid NOT NULL,
  FOREIGN KEY (company_id, assignee_user_id) REFERENCES app_user (company_id, id)
);
CREATE UNIQUE INDEX inquiry_route_service_key ON inquiry_route (company_id, COALESCE(service_slug, ''));

CREATE TABLE daily_counter (
  company_id uuid NOT NULL REFERENCES company (id),
  kind text NOT NULL,
  day date NOT NULL,
  n integer NOT NULL,
  PRIMARY KEY (company_id, kind, day)
);

CREATE TABLE inquiry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company (id),
  code text NOT NULL UNIQUE,
  submission_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  email text,
  phone text,
  message text NOT NULL CHECK (length(message) BETWEEN 1 AND 4000),
  service_slug text,
  source text,
  consent_at timestamptz NOT NULL,
  consent_notice_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('new', 'assigned', 'in_progress', 'qualified', 'closed')),
  assignee_user_id uuid,
  due_at timestamptz NOT NULL,
  suspected_spam boolean NOT NULL DEFAULT false,
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, submission_id),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, assignee_user_id) REFERENCES app_user (company_id, id),
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);
CREATE INDEX inquiry_assignee_idx ON inquiry (assignee_user_id, status);

CREATE TABLE inquiry_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id uuid NOT NULL,
  inquiry_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  actor_user_id uuid,
  note text,
  at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, inquiry_id) REFERENCES inquiry (company_id, id)
);

CREATE TABLE job_application (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company (id),
  code text NOT NULL UNIQUE,
  submission_id uuid NOT NULL,
  job_page_id uuid,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  email text NOT NULL,
  phone text,
  cover_letter text CHECK (length(cover_letter) <= 8000),
  consent_at timestamptz NOT NULL,
  consent_notice_version text NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'screening', 'interview', 'offer', 'rejected', 'hired', 'withdrawn')),
  suspected_spam boolean NOT NULL DEFAULT false,
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, submission_id),
  FOREIGN KEY (company_id, job_page_id) REFERENCES cms_page (company_id, id)
);

-- Giới hạn tần suất biểu mẫu công khai theo IP (đã băm).
CREATE TABLE public_rate_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bucket text NOT NULL,
  key_hash text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX public_rate_event_idx ON public_rate_event (bucket, key_hash, at DESC);
