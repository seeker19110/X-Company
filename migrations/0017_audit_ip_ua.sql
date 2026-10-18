-- Nguồn request của sự kiện kiểm toán (CMP-AUDIT-002: where = ip/ua). Chỉ thêm cột; hàng cũ để NULL và vẫn băm như cũ
-- (hai trường chỉ vào bản ghi băm khi có giá trị — lib/audit). Bảng vẫn append-only (trigger/REVOKE ở 0002 không đổi).
ALTER TABLE audit_event
  ADD COLUMN source_ip inet,
  ADD COLUMN user_agent text CHECK (user_agent IS NULL OR char_length(user_agent) <= 300);
