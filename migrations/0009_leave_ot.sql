-- Nghỉ phép (sổ biến động, không có cột số dư) và làm thêm giờ có hạn mức đồng thời (SPEC-attendance F-005).
CREATE TABLE leave_type (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company (id),
  code text NOT NULL,
  name text NOT NULL,
  paid boolean NOT NULL DEFAULT true,
  requires_balance boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, id),
  UNIQUE (company_id, code)
);

CREATE TABLE leave_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  leave_type_id uuid NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  minutes integer NOT NULL CHECK (minutes > 0),
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  created_by_user_id uuid NOT NULL,
  decided_by_user_id uuid,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, employee_id) REFERENCES employee (company_id, id),
  FOREIGN KEY (company_id, leave_type_id) REFERENCES leave_type (company_id, id),
  CHECK (end_at > start_at),
  CHECK (decided_by_user_id IS NULL OR decided_by_user_id <> created_by_user_id),
  -- Hai đơn đã duyệt của cùng nhân viên không chồng thời gian (chặn cả ghi tay).
  EXCLUDE USING gist (employee_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&) WHERE (status = 'approved')
);

CREATE TABLE leave_ledger (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  leave_type_id uuid NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('accrual', 'taken', 'adjustment', 'reversal')),
  minutes integer NOT NULL CHECK (minutes <> 0),
  reason text,
  leave_request_id uuid,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, employee_id) REFERENCES employee (company_id, id),
  FOREIGN KEY (company_id, leave_type_id) REFERENCES leave_type (company_id, id),
  FOREIGN KEY (company_id, leave_request_id) REFERENCES leave_request (company_id, id),
  CHECK (entry_type <> 'accrual' OR minutes > 0),
  CHECK (entry_type <> 'taken' OR minutes < 0),
  CHECK (entry_type <> 'adjustment' OR length(trim(coalesce(reason, ''))) > 0)
);
CREATE INDEX leave_ledger_balance_idx ON leave_ledger (employee_id, leave_type_id);
-- Sổ chỉ thêm: sửa sai bằng bút toán điều chỉnh/đảo, không sửa dòng cũ.
REVOKE UPDATE, DELETE, TRUNCATE ON leave_ledger FROM xc_app_rw;

-- Hạn mức OT có ngày hiệu lực và nguồn (giá trị ⚙ — HR/pháp chế xác nhận ở F02).
CREATE TABLE ot_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company (id),
  valid_from date NOT NULL,
  max_ot_day_minutes integer NOT NULL DEFAULT 240,
  max_total_day_minutes integer NOT NULL DEFAULT 720,
  max_month_minutes integer NOT NULL DEFAULT 2400,
  max_year_minutes integer NOT NULL DEFAULT 12000,
  source_note text NOT NULL,
  UNIQUE (company_id, id),
  UNIQUE (company_id, valid_from)
);

CREATE TABLE ot_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  business_date date NOT NULL,
  minutes integer NOT NULL CHECK (minutes > 0 AND minutes <= 1440),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  employee_consent_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  exception_basis text,
  policy_id uuid,
  created_by_user_id uuid NOT NULL,
  decided_by_user_id uuid,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, employee_id) REFERENCES employee (company_id, id),
  FOREIGN KEY (company_id, policy_id) REFERENCES ot_policy (company_id, id),
  CHECK (decided_by_user_id IS NULL OR decided_by_user_id <> created_by_user_id),
  CHECK (status <> 'approved' OR employee_consent_at IS NOT NULL)
);
CREATE INDEX ot_request_emp_date_idx ON ot_request (employee_id, business_date) WHERE status = 'approved';
