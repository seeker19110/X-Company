-- Chấm công lớp 1 (SPEC-attendance): mẫu ca, phân ca, chính sách có ngày hiệu lực, sự kiện gốc chỉ thêm.
CREATE TABLE shift_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company (id),
  code text NOT NULL,
  name text NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  break_minutes integer NOT NULL DEFAULT 0 CHECK (break_minutes BETWEEN 0 AND 480),
  early_grace_minutes integer NOT NULL DEFAULT 60 CHECK (early_grace_minutes BETWEEN 0 AND 720),
  late_grace_minutes integer NOT NULL DEFAULT 240 CHECK (late_grace_minutes BETWEEN 0 AND 720),
  tz text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  UNIQUE (company_id, id),
  UNIQUE (company_id, code),
  CHECK (start_time <> end_time)
);

CREATE TABLE shift_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  business_date date NOT NULL,
  shift_template_id uuid NOT NULL,
  worksite_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (employee_id, business_date, shift_template_id),
  FOREIGN KEY (company_id, employee_id) REFERENCES employee (company_id, id),
  FOREIGN KEY (company_id, shift_template_id) REFERENCES shift_template (company_id, id),
  FOREIGN KEY (company_id, worksite_id) REFERENCES worksite (company_id, id)
);
CREATE INDEX shift_assignment_emp_date_idx ON shift_assignment (employee_id, business_date);

-- Chính sách chấm công có ngày hiệu lực (D-007): giá trị ⚙ của SPEC; bản ghi mới không tính lại kỳ đã khoá.
CREATE TABLE attendance_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company (id),
  valid_from timestamptz NOT NULL,
  clock_skew_max_sec integer NOT NULL DEFAULT 300,
  offline_max_age_sec integer NOT NULL DEFAULT 259200,
  future_tolerance_sec integer NOT NULL DEFAULT 300,
  qr_ttl_sec integer NOT NULL DEFAULT 60 CHECK (qr_ttl_sec BETWEEN 15 AND 600),
  qr_clock_leeway_sec integer NOT NULL DEFAULT 10,
  duplicate_window_sec integer NOT NULL DEFAULT 120,
  source_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, valid_from)
);

CREATE TABLE attendance_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 100),
  request_hash text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('in', 'out', 'break_start', 'break_end')),
  device_time timestamptz NOT NULL,
  server_received_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('qr', 'gps', 'kiosk', 'manual_request')),
  queued boolean NOT NULL DEFAULT false,
  device text,
  worksite_id uuid,
  shift_assignment_id uuid,
  policy_id uuid,
  geo_lat double precision,
  geo_lng double precision,
  geo_accuracy_m double precision,
  geo_captured_at timestamptz,
  qr_nonce text,
  status text NOT NULL CHECK (status IN ('accepted', 'needs_review', 'rejected')),
  review_reason text,
  voided_by_adjustment_id uuid,
  UNIQUE (company_id, id),
  UNIQUE (employee_id, idempotency_key),
  FOREIGN KEY (company_id, employee_id) REFERENCES employee (company_id, id),
  FOREIGN KEY (company_id, worksite_id) REFERENCES worksite (company_id, id),
  FOREIGN KEY (company_id, shift_assignment_id) REFERENCES shift_assignment (company_id, id),
  FOREIGN KEY (company_id, policy_id) REFERENCES attendance_policy (company_id, id),
  CHECK ((status = 'accepted') = (review_reason IS NULL) OR status = 'rejected')
);
CREATE INDEX attendance_event_emp_time_idx ON attendance_event (employee_id, device_time);
CREATE INDEX attendance_event_review_idx ON attendance_event (company_id, status) WHERE status = 'needs_review';

-- Sự kiện gốc không sửa/xoá (§6): chỉ cho phép gắn voided_by_adjustment_id một lần (sửa công có duyệt).
REVOKE DELETE, TRUNCATE ON attendance_event FROM xc_app_rw;
CREATE FUNCTION attendance_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'attendance_event không xoá được' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - 'voided_by_adjustment_id' - 'status' - 'review_reason')
     IS DISTINCT FROM (to_jsonb(OLD) - 'voided_by_adjustment_id' - 'status' - 'review_reason')
     OR (OLD.voided_by_adjustment_id IS NOT NULL AND NEW.voided_by_adjustment_id IS DISTINCT FROM OLD.voided_by_adjustment_id) THEN
    RAISE EXCEPTION 'attendance_event là bằng chứng gốc — chỉ đổi trạng thái xác minh hoặc đánh dấu huỷ bởi điều chỉnh'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER attendance_event_guard_trg BEFORE UPDATE OR DELETE ON attendance_event
  FOR EACH ROW EXECUTE FUNCTION attendance_event_guard();
