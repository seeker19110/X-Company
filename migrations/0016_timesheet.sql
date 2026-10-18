-- Giờ theo dự án và đối chiếu với công (SPEC-work F-009, AT08): tách khỏi công; chênh lệch có giải trình.
CREATE TABLE timesheet_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  project_id uuid NOT NULL,
  task_id uuid NOT NULL,
  business_date date NOT NULL,
  minutes integer NOT NULL CHECK (minutes BETWEEN 1 AND 1440),
  note text,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'rejected')),
  created_by_user_id uuid NOT NULL,
  decided_by_user_id uuid,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, employee_id) REFERENCES employee (company_id, id),
  FOREIGN KEY (company_id, project_id) REFERENCES project (company_id, id),
  FOREIGN KEY (company_id, task_id) REFERENCES task (company_id, id),
  CHECK (decided_by_user_id IS NULL OR decided_by_user_id <> created_by_user_id)
);
CREATE INDEX timesheet_emp_date_idx ON timesheet_entry (employee_id, business_date);

CREATE TABLE reconciliation_note (
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  business_date date NOT NULL,
  note text NOT NULL CHECK (length(trim(note)) > 0),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, business_date),
  FOREIGN KEY (company_id, employee_id) REFERENCES employee (company_id, id)
);
