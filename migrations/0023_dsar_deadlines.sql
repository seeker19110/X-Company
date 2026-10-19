-- Hạn xử lý yêu cầu chủ thể THEO LOẠI (T-044, D-029; NĐ 356/2025/NĐ-CP Điều 5 — nguồn mức B, chưa đối chiếu Công báo).
-- Chỉ thêm — không sửa migration cũ. Cột mới đều NULL được: yêu cầu tạo trước migration này giữ nguyên hạn `due_at` cũ và không
-- có đồng hồ phản hồi (respond_due_at IS NULL = không áp hạn phản hồi). Kiểu yêu cầu mới (rectify, export, object) chỉ mở rộng
-- CHECK; giá trị cũ vẫn hợp lệ.
-- Đường lùi: ứng dụng bản trước không đọc cột mới và không tạo kiểu mới; gỡ tay (nếu cần) bằng migration "contract" sau khi
-- không còn dòng dùng: ALTER TABLE data_subject_request DROP COLUMN … và khôi phục CHECK kind bốn giá trị.

ALTER TABLE data_subject_request DROP CONSTRAINT data_subject_request_kind_check;
ALTER TABLE data_subject_request ADD CONSTRAINT data_subject_request_kind_check
  CHECK (kind IN ('access', 'rectify', 'export', 'delete', 'withdraw_consent', 'restrict', 'object'));

ALTER TABLE data_subject_request
  -- Hạn phản hồi "đã nhận" (2 ngày làm việc kể từ lúc nhận, tính ở ứng dụng) và lúc đã phản hồi.
  ADD COLUMN respond_due_at timestamptz,
  ADD COLUMN responded_at timestamptz,
  -- Gia hạn: tối đa MỘT lần kèm lý do; `due_at` được cộng thêm `extension_days` ngày (hạn gốc = due_at - extension_days).
  ADD COLUMN extended_at timestamptz,
  ADD COLUMN extension_days integer CHECK (extension_days IS NULL OR extension_days > 0),
  ADD COLUMN extension_reason text CHECK (extension_reason IS NULL OR length(extension_reason) BETWEEN 1 AND 1000);

ALTER TABLE data_subject_request ADD CONSTRAINT data_subject_request_extension_check
  CHECK ((extended_at IS NULL) = (extension_days IS NULL) AND (extended_at IS NULL) = (extension_reason IS NULL));
ALTER TABLE data_subject_request ADD CONSTRAINT data_subject_request_respond_check
  CHECK (respond_due_at IS NULL OR respond_due_at >= received_at);

-- Yêu cầu đã đóng trước migration: quyết định đóng chính là phản hồi.
UPDATE data_subject_request SET responded_at = closed_at WHERE closed_at IS NOT NULL AND responded_at IS NULL;

-- Chưa phản hồi mà đã có hạn phản hồi: phục vụ truy vấn quá hạn/cảnh báo.
CREATE INDEX data_subject_request_respond_idx ON data_subject_request (company_id, respond_due_at)
  WHERE responded_at IS NULL AND respond_due_at IS NOT NULL;
