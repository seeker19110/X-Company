-- Công việc (SPEC-work F-007/F-008): dự án → hạng mục (cây) → công việc; mốc; phụ thuộc FS; lịch sử; bằng chứng.
CREATE TABLE project (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company (id),
  code text NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  manager_employee_id uuid NOT NULL,
  start_date date,
  due_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'on_hold', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, code),
  FOREIGN KEY (company_id, manager_employee_id) REFERENCES employee (company_id, id),
  CHECK (due_date IS NULL OR start_date IS NULL OR due_date >= start_date)
);

CREATE TABLE project_member (
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, employee_id),
  FOREIGN KEY (company_id, project_id) REFERENCES project (company_id, id),
  FOREIGN KEY (company_id, employee_id) REFERENCES employee (company_id, id)
);

CREATE TABLE work_package (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  parent_id uuid,
  code text NOT NULL,
  name text NOT NULL,
  UNIQUE (company_id, id),
  UNIQUE (project_id, code),
  FOREIGN KEY (company_id, project_id) REFERENCES project (company_id, id),
  FOREIGN KEY (company_id, parent_id) REFERENCES work_package (company_id, id),
  CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE TABLE task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  work_package_id uuid,
  title text NOT NULL CHECK (length(trim(title)) > 0),
  description text,
  responsible_employee_id uuid NOT NULL,
  reviewer_employee_id uuid,
  due_date date,
  priority smallint NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 4),
  estimate_minutes integer CHECK (estimate_minutes > 0),
  requires_acceptance boolean NOT NULL DEFAULT true,
  acceptance_criteria text,
  evidence_required boolean NOT NULL DEFAULT false,
  reported_pct smallint NOT NULL DEFAULT 0 CHECK (reported_pct BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo', 'in_progress', 'blocked', 'awaiting_acceptance', 'done', 'cancelled')),
  blocked_reason text,
  blocked_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, project_id) REFERENCES project (company_id, id),
  FOREIGN KEY (company_id, work_package_id) REFERENCES work_package (company_id, id),
  FOREIGN KEY (company_id, responsible_employee_id) REFERENCES employee (company_id, id),
  FOREIGN KEY (company_id, reviewer_employee_id) REFERENCES employee (company_id, id),
  -- Người nghiệm thu độc lập với người thực hiện (W2, R5).
  CHECK (reviewer_employee_id IS NULL OR reviewer_employee_id <> responsible_employee_id),
  CHECK (NOT requires_acceptance OR reviewer_employee_id IS NOT NULL),
  CHECK (NOT requires_acceptance OR length(trim(coalesce(acceptance_criteria, ''))) > 0),
  CHECK ((status = 'blocked') = (blocked_reason IS NOT NULL))
);
CREATE INDEX task_project_idx ON task (project_id, status);
CREATE INDEX task_responsible_idx ON task (responsible_employee_id, status);

CREATE TABLE task_collaborator (
  task_id uuid NOT NULL REFERENCES task (id),
  employee_id uuid NOT NULL REFERENCES employee (id),
  PRIMARY KEY (task_id, employee_id)
);

CREATE TABLE task_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  task_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('file', 'link', 'note')),
  ref text NOT NULL CHECK (length(trim(ref)) > 0),
  added_by_user_id uuid NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, task_id) REFERENCES task (company_id, id)
);

CREATE TABLE task_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id uuid NOT NULL,
  task_id uuid NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  action text NOT NULL,
  from_status text,
  to_status text,
  changes jsonb,
  reason text,
  FOREIGN KEY (company_id, task_id) REFERENCES task (company_id, id)
);
REVOKE UPDATE, DELETE, TRUNCATE ON task_history FROM xc_app_rw;

CREATE TABLE milestone (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  name text NOT NULL,
  due_date date NOT NULL,
  baseline_due_date date,
  achieved_at timestamptz,
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, project_id) REFERENCES project (company_id, id)
);

CREATE TABLE task_dependency (
  company_id uuid NOT NULL,
  predecessor_id uuid NOT NULL,
  successor_id uuid NOT NULL,
  type text NOT NULL DEFAULT 'FS' CHECK (type = 'FS'),
  PRIMARY KEY (predecessor_id, successor_id),
  FOREIGN KEY (company_id, predecessor_id) REFERENCES task (company_id, id),
  FOREIGN KEY (company_id, successor_id) REFERENCES task (company_id, id),
  CHECK (predecessor_id <> successor_id)
);
