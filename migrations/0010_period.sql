-- Sửa công có duyệt + kỳ công (SPEC-attendance F-006, AT06): kỳ đi tới 5 trạng thái, khoá chụp số liệu theo phiên bản,
-- xuất có phiên bản + checksum; sau khoá chỉ thay đổi qua điều chỉnh do HR duyệt → phiên bản xuất mới.
CREATE TABLE attendance_period (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company (id),
  code text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'employee_review', 'manager_confirmed', 'hr_closed', 'locked')),
  current_version integer NOT NULL DEFAULT 0,
  locked_at timestamptz,
  locked_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, code),
  CHECK (end_date >= start_date),
  CHECK ((status = 'locked') = (locked_at IS NOT NULL)),
  EXCLUDE USING gist (company_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
);

CREATE TABLE period_exception_note (
  period_id uuid NOT NULL REFERENCES attendance_period (id),
  ref text NOT NULL,
  note text NOT NULL CHECK (length(trim(note)) > 0),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (period_id, ref)
);

-- Số liệu chốt của kỳ theo phiên bản (không tính lại khi cấu hình đổi).
CREATE TABLE period_line (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period_id uuid NOT NULL REFERENCES attendance_period (id),
  version integer NOT NULL CHECK (version > 0),
  employee_id uuid NOT NULL,
  business_date date NOT NULL,
  shift_assignment_id uuid,
  status text NOT NULL,
  present_minutes integer,
  ot_approved_minutes integer NOT NULL DEFAULT 0,
  leave_minutes integer NOT NULL DEFAULT 0,
  note text,
  UNIQUE (period_id, version, employee_id, business_date, shift_assignment_id)
);
REVOKE UPDATE, DELETE, TRUNCATE ON period_line FROM xc_app_rw;

CREATE TABLE period_export (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES attendance_period (id),
  version integer NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by_user_id uuid NOT NULL,
  row_count integer NOT NULL,
  checksum text NOT NULL,
  content text NOT NULL,
  reason text,
  UNIQUE (period_id, version)
);
REVOKE UPDATE, DELETE, TRUNCATE ON period_export FROM xc_app_rw;

CREATE TABLE attendance_adjustment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('add_event', 'void_event')),
  target_event_id uuid,
  new_kind text CHECK (new_kind IN ('in', 'out', 'break_start', 'break_end')),
  new_at timestamptz,
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  before jsonb,
  after jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  post_lock boolean NOT NULL DEFAULT false,
  period_id uuid,
  created_by_user_id uuid NOT NULL,
  decided_by_user_id uuid,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, employee_id) REFERENCES employee (company_id, id),
  FOREIGN KEY (company_id, target_event_id) REFERENCES attendance_event (company_id, id),
  CHECK (decided_by_user_id IS NULL OR decided_by_user_id <> created_by_user_id),
  CHECK ((action = 'add_event') = (new_kind IS NOT NULL AND new_at IS NOT NULL)),
  CHECK ((action = 'void_event') = (target_event_id IS NOT NULL))
);
ALTER TABLE attendance_event
  ADD CONSTRAINT attendance_event_voided_fk FOREIGN KEY (company_id, voided_by_adjustment_id)
  REFERENCES attendance_adjustment (company_id, id);
