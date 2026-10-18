-- Tài khoản và cấp quyền theo vai trò + phạm vi (SPEC-identity-org R1–R8).
CREATE TABLE app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL CHECK (email = lower(email) AND position('@' IN email) > 1),
  display_name text NOT NULL,
  password_hash text,
  company_id uuid NOT NULL REFERENCES company (id),
  employee_id uuid,
  disabled_at timestamptz,
  -- Tăng mỗi khi quyền/tài khoản đổi: phiên kiểm lại ở mỗi request (R8).
  auth_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, employee_id) REFERENCES employee (company_id, id)
);
CREATE UNIQUE INDEX app_user_email_key ON app_user (email);
CREATE UNIQUE INDEX app_user_employee_key ON app_user (employee_id) WHERE employee_id IS NOT NULL;

CREATE TABLE role_grant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN (
    'employee', 'team_lead', 'project_manager', 'hr', 'accountant', 'editor', 'sales', 'executive', 'sysadmin',
    'sensitive_exporter'
  )),
  scope_type text NOT NULL CHECK (scope_type IN ('company', 'branch', 'department', 'project', 'self')),
  scope_id uuid,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  granted_by uuid,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, user_id) REFERENCES app_user (company_id, id),
  CHECK ((scope_type IN ('company', 'self')) = (scope_id IS NULL)),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE INDEX role_grant_user_idx ON role_grant (user_id) WHERE revoked_at IS NULL;
