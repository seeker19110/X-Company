-- Tổ chức (SPEC-identity-org): công ty → chi nhánh → phòng ban (cây) ; địa điểm ; nhân viên + lịch sử công tác.
-- Khoá ngoại quan trọng gồm company_id để dữ liệu không lẫn công ty (ARCHITECTURE: quy ước).
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE company (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  tax_code text,
  timezone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE branch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company (id),
  code text NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, code)
);

CREATE TABLE department (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company (id),
  branch_id uuid NOT NULL,
  parent_id uuid,
  code text NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, code),
  FOREIGN KEY (company_id, branch_id) REFERENCES branch (company_id, id),
  FOREIGN KEY (company_id, parent_id) REFERENCES department (company_id, id),
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX department_parent_idx ON department (parent_id);

-- Chặn chu trình trong cây phòng ban (ca biên SPEC-identity-org).
CREATE FUNCTION department_no_cycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  found boolean;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  WITH RECURSIVE up(id, parent_id, depth) AS (
    SELECT d.id, d.parent_id, 1 FROM department d WHERE d.id = NEW.parent_id
    UNION ALL
    SELECT d.id, d.parent_id, up.depth + 1 FROM department d JOIN up ON d.id = up.parent_id WHERE up.depth < 1000
  )
  SELECT EXISTS (SELECT 1 FROM up WHERE up.id = NEW.id) INTO found;
  IF found THEN
    RAISE EXCEPTION 'Cây phòng ban không được có chu trình' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER department_no_cycle_trg BEFORE INSERT OR UPDATE OF parent_id ON department
  FOR EACH ROW EXECUTE FUNCTION department_no_cycle();

CREATE TABLE worksite (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company (id),
  branch_id uuid,
  code text NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  address text,
  lat double precision CHECK (lat BETWEEN -90 AND 90),
  lng double precision CHECK (lng BETWEEN -180 AND 180),
  radius_m integer CHECK (radius_m > 0),
  timezone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  active boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, id),
  UNIQUE (company_id, code),
  FOREIGN KEY (company_id, branch_id) REFERENCES branch (company_id, id),
  CHECK ((lat IS NULL) = (lng IS NULL))
);

CREATE TABLE employee (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company (id),
  code text NOT NULL CHECK (length(trim(code)) > 0),
  full_name text NOT NULL CHECK (length(trim(full_name)) > 0),
  work_email text,
  phone text,
  hired_on date,
  terminated_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, code),
  CHECK (terminated_on IS NULL OR hired_on IS NULL OR terminated_on >= hired_on)
);

-- Lịch sử công tác theo khoảng hiệu lực [valid_from, valid_to); không chồng nhau cho cùng nhân viên.
CREATE TABLE employment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  department_id uuid NOT NULL,
  title text,
  manager_employee_id uuid,
  valid_from date NOT NULL,
  valid_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, employee_id) REFERENCES employee (company_id, id),
  FOREIGN KEY (company_id, department_id) REFERENCES department (company_id, id),
  FOREIGN KEY (company_id, manager_employee_id) REFERENCES employee (company_id, id),
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  CHECK (manager_employee_id IS NULL OR manager_employee_id <> employee_id),
  EXCLUDE USING gist (employee_id WITH =, daterange(valid_from, valid_to, '[)') WITH &&)
);
CREATE INDEX employment_history_dept_idx ON employment_history (department_id);
