-- Hồi quy review PR #8 #12: dòng leave_only/ot_only có shift_assignment_id NULL — UNIQUE phải coi NULL là bằng nhau.
ALTER TABLE period_line DROP CONSTRAINT period_line_period_id_version_employee_id_business_date_shi_key;
ALTER TABLE period_line ADD CONSTRAINT period_line_unique_line
  UNIQUE NULLS NOT DISTINCT (period_id, version, employee_id, business_date, shift_assignment_id);
