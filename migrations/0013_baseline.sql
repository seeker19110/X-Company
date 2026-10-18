-- Baseline kế hoạch (SPEC-work: tiến độ): trọng số hạng mục LÁ + hạn mốc; đề xuất → duyệt (người duyệt ≠ người đề
-- xuất); baseline cũ giữ nguyên (chỉ thêm phiên bản mới).
CREATE TABLE plan_baseline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  weights jsonb NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rejected')),
  proposed_by_user_id uuid NOT NULL,
  approved_by_user_id uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, version),
  FOREIGN KEY (company_id, project_id) REFERENCES project (company_id, id),
  CHECK (approved_by_user_id IS NULL OR approved_by_user_id <> proposed_by_user_id),
  CHECK ((status = 'approved') = (approved_at IS NOT NULL))
);
REVOKE DELETE, TRUNCATE ON plan_baseline FROM xc_app_rw;
