-- Quyền chủ thể dữ liệu (T-040; CMP-RIGHTS-001/004/007, CMP-VN-001/007, STD-PRIV-004, CMP-PRIV-005, CMP-INTL-007).
-- Chỉ thêm — không sửa migration cũ. Đường lùi: ứng dụng bản trước không đọc các bảng mới; riêng ràng buộc trạng thái
-- inquiry được nới thêm 'processing_stopped' (giá trị cũ vẫn hợp lệ).

-- Bản ghi đồng ý: CHỈ THÊM. Cấp = một dòng event 'grant'; rút = một dòng MỚI event 'withdraw' (không UPDATE dòng cũ).
-- Trạng thái hiện hành của (chủ thể, mục đích) = event của dòng có id lớn nhất. Không chứa PII (subject_id là mã nội bộ).
CREATE TABLE consent_record (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES company (id) ON DELETE RESTRICT,
  subject_type text NOT NULL CHECK (subject_type IN ('inquiry', 'job_application', 'employee')),
  subject_id uuid NOT NULL,
  purpose_id text NOT NULL CHECK (purpose_id ~ '^[a-z][a-z0-9_]{1,63}$'),
  policy_version text NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 64),
  event text NOT NULL CHECK (event IN ('grant', 'withdraw')),
  granted_at timestamptz NOT NULL,
  channel text NOT NULL CHECK (length(channel) BETWEEN 1 AND 40),
  ui_snapshot_hash text NOT NULL CHECK (ui_snapshot_hash ~ '^[0-9a-f]{64}$'),
  withdrawn_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((event = 'grant') = (withdrawn_at IS NULL))
);
CREATE INDEX consent_record_company_idx ON consent_record (company_id);
CREATE INDEX consent_record_subject_idx ON consent_record (subject_type, subject_id, purpose_id, id DESC);

REVOKE UPDATE, DELETE, TRUNCATE ON consent_record FROM xc_app_rw;
CREATE FUNCTION consent_record_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'consent_record chỉ thêm (append-only)' USING ERRCODE = 'insufficient_privilege';
END
$$;
CREATE TRIGGER consent_record_no_update BEFORE UPDATE OR DELETE ON consent_record
  FOR EACH ROW EXECUTE FUNCTION consent_record_immutable();
CREATE TRIGGER consent_record_no_truncate BEFORE TRUNCATE ON consent_record
  FOR EACH STATEMENT EXECUTE FUNCTION consent_record_immutable();

-- Dữ liệu cũ (trước migration này): dựng bản ghi 'grant' từ consent_at + consent_notice_version; ảnh chụp giao diện
-- không còn → băm của chuỗi 'legacy:<mục đích>:<phiên bản>'.
INSERT INTO consent_record (company_id, subject_type, subject_id, purpose_id, policy_version, event, granted_at, channel, ui_snapshot_hash)
SELECT company_id, 'inquiry', id, 'inquiry_contact', consent_notice_version, 'grant', consent_at, 'web_form',
       encode(sha256(convert_to('legacy:inquiry_contact:' || consent_notice_version, 'UTF8')), 'hex')
  FROM inquiry;
INSERT INTO consent_record (company_id, subject_type, subject_id, purpose_id, policy_version, event, granted_at, channel, ui_snapshot_hash)
SELECT company_id, 'job_application', id, 'job_application', consent_notice_version, 'grant', consent_at, 'web_form',
       encode(sha256(convert_to('legacy:job_application:' || consent_notice_version, 'UTF8')), 'hex')
  FROM job_application;

-- Yêu cầu của chủ thể (DSAR). subject_ref = mã nghiệp vụ người nhận nhập (YC-…/UV-…/mã nhân viên) hoặc uuid — KHÔNG
-- email/SĐT; subject_id = uuid đã phân giải. due_at = received_at + DSAR_DAYS (cấu hình, tính ở ứng dụng).
CREATE TABLE data_subject_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company (id) ON DELETE RESTRICT,
  subject_type text NOT NULL CHECK (subject_type IN ('inquiry', 'job_application', 'employee')),
  subject_ref text NOT NULL CHECK (subject_ref ~ '^[A-Za-z0-9_-]{1,64}$'),
  subject_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('access', 'delete', 'withdraw_consent', 'restrict')),
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'in_progress', 'done', 'rejected')),
  received_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz NOT NULL,
  closed_at timestamptz,
  handler uuid,
  note text CHECK (length(note) <= 1000),
  reject_reason text CHECK (length(reject_reason) BETWEEN 1 AND 1000),
  -- Kết quả xử lý dạng đếm/danh mục (không PII): số hàng ẩn danh, tệp xoá, mục giữ theo luật + lý do.
  result jsonb,
  CHECK (due_at >= received_at),
  CHECK ((status IN ('done', 'rejected')) = (closed_at IS NOT NULL)),
  CHECK ((status = 'rejected') = (reject_reason IS NOT NULL)),
  FOREIGN KEY (company_id, handler) REFERENCES app_user (company_id, id) ON DELETE RESTRICT,
  UNIQUE (company_id, id)
);
CREATE INDEX data_subject_request_handler_idx ON data_subject_request (company_id, handler);
CREATE INDEX data_subject_request_open_idx ON data_subject_request (company_id, due_at) WHERE status IN ('received', 'in_progress');
-- Một yêu cầu đang mở cho mỗi (chủ thể, loại): gửi lặp không tạo thêm.
CREATE UNIQUE INDEX data_subject_request_open_key ON data_subject_request (company_id, subject_type, subject_id, kind)
  WHERE status IN ('received', 'in_progress');

-- Hạn chế xử lý / giữ theo luật: cờ còn hiệu lực khi released_at IS NULL.
CREATE TABLE processing_restriction (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company (id) ON DELETE RESTRICT,
  subject_type text NOT NULL CHECK (subject_type IN ('inquiry', 'job_application', 'employee')),
  subject_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('restrict', 'retained_by_law')),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  request_id uuid REFERENCES data_subject_request (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz
);
CREATE INDEX processing_restriction_company_idx ON processing_restriction (company_id);
CREATE INDEX processing_restriction_request_idx ON processing_restriction (request_id);
CREATE UNIQUE INDEX processing_restriction_active_key ON processing_restriction (subject_type, subject_id, kind)
  WHERE released_at IS NULL;

-- Tệp (blob ở kho tệp) thuộc về chủ thể công khai (vd CV ứng viên): xoá theo yêu cầu xoá. Chưa có luồng tải lên —
-- khi thêm, ghi qua lib/privacy registerSubjectFile trong cùng giao dịch với tải lên.
CREATE TABLE subject_file (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company (id) ON DELETE RESTRICT,
  subject_type text NOT NULL CHECK (subject_type IN ('inquiry', 'job_application')),
  subject_id uuid NOT NULL,
  storage_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subject_file_company_idx ON subject_file (company_id);
CREATE INDEX subject_file_subject_idx ON subject_file (subject_type, subject_id);

-- Rút đồng ý/xoá → liên hệ chuyển 'processing_stopped' (dừng xử lý; khác 'closed' là kết thúc nghiệp vụ bình thường).
ALTER TABLE inquiry DROP CONSTRAINT inquiry_status_check;
ALTER TABLE inquiry ADD CONSTRAINT inquiry_status_check
  CHECK (status IN ('new', 'assigned', 'in_progress', 'qualified', 'closed', 'processing_stopped'));
