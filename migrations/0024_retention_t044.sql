-- Lưu trữ theo D-030 (T-044; STD-PRIV-005, CMP-PRIV-005, XC-GREEN-007). Chỉ thêm — không sửa migration cũ.
-- Đường lùi: ứng dụng bản trước không đọc hai cột mới; trigger chỉ điền cột mới nên vô hại với bản trước. Gỡ (nếu cần) bằng
-- migration "contract" sau khi không còn bản nào đọc: DROP TRIGGER/FUNCTION, DROP COLUMN job_application.decided_at, employee.anonymized_at.

-- Thời điểm CHỐT kết quả tuyển dụng (rejected | hired | withdrawn): mốc đếm 30 ngày ẩn danh của ứng viên không trúng tuyển.
-- NULL với hàng cũ/chưa chốt; job lưu giữ dùng COALESCE(decided_at, created_at) cho hàng đã ở trạng thái chốt mà thiếu mốc.
ALTER TABLE job_application ADD COLUMN decided_at timestamptz;

CREATE FUNCTION job_application_set_decided_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('rejected', 'hired', 'withdrawn')
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.decided_at IS NULL THEN
    NEW.decided_at := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER job_application_decided BEFORE UPDATE OF status ON job_application
  FOR EACH ROW EXECUTE FUNCTION job_application_set_decided_at();

CREATE INDEX job_application_retention_idx ON job_application (status, decided_at) WHERE anonymized_at IS NULL;

-- Hồ sơ nhân viên hết thời hạn giữ (10 năm kể từ chấm dứt hợp đồng, cấu hình): họ tên được ẩn danh, mã nhân viên và dữ liệu
-- chấm công giữ nguyên (không còn gắn tên).
ALTER TABLE employee ADD COLUMN anonymized_at timestamptz;
