-- Chống dò mật khẩu rải (AUD-SEC-004, D-053): đăng nhập đếm lần sai theo IP qua mọi email trong 15 phút.
-- Index cũ (email, ip, attempted_at) không phục vụ lọc theo ip đứng một mình → index riêng, một phần (chỉ lần sai).
-- Chỉ thêm index — không đổi dữ liệu. Đường lùi: ứng dụng bản trước không dùng index này; gỡ bằng migration contract
-- (DROP INDEX login_attempt_ip_failed_idx) khi không cần.
CREATE INDEX login_attempt_ip_failed_idx ON login_attempt (ip, attempted_at DESC) WHERE success = false;
