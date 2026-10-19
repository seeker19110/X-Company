-- Mã hoá dữ liệu lúc lưu + nhãn PII trong schema (T-048; BASE-SEC-013, DB-SEC-001, DB-SEC-009, CMP-PRIV-007). Chỉ thêm — không sửa migration cũ.
--
-- Giai đoạn "expand" của expand → backfill → contract:
--   1. (migration này) thêm cột mã hoá/chỉ mục mù, CHO PHÉP NULL; ứng dụng mới GHI mã hoá (cột bản rõ để NULL) và ĐỌC ưu tiên cột mã hoá,
--      rơi về cột bản rõ cho dòng cũ.
--   2. backfill (`npm run -s crypto:backfill`): mã hoá dòng cũ, idempotent, theo lô, kiểm số dòng; `--scrub` xoá bản rõ SAU KHI đã
--      giải mã thử khớp. Chưa `--scrub` thì cột bản rõ còn nguyên → ứng dụng bản trước vẫn chạy được trên schema mới.
--   3. contract (việc SAU, migration riêng có `-- contract:`): bỏ cột bản rõ khi không còn bản nào đọc. KHÔNG làm trong lát này.
-- Đường lùi: cột mới đều nullable nên ứng dụng bản trước chạy nguyên trên schema mới (không đọc cột mới). Dòng ghi bởi bản mới
-- có cột bản rõ NULL → bản trước thấy NULL; muốn lùi hẳn thì giải mã ngược bằng công cụ trước khi hạ bản (RUNBOOK mục mã hoá).
-- Gỡ cột (nếu bỏ hẳn): migration "contract" sau — ALTER TABLE … DROP COLUMN …_enc/…_bidx; khôi phục guard cũ bằng thân hàm ở 0008.

ALTER TABLE attendance_event ADD COLUMN geo_enc text;
ALTER TABLE employee ADD COLUMN phone_enc text, ADD COLUMN phone_bidx text;
ALTER TABLE inquiry ADD COLUMN phone_enc text, ADD COLUMN phone_bidx text;
ALTER TABLE job_application ADD COLUMN phone_enc text, ADD COLUMN phone_bidx text;
ALTER TABLE leave_request ADD COLUMN reason_enc text;

-- Chỉ mục mù để tìm theo số điện thoại mà không lộ bản rõ (HMAC, khoá DATA_INDEX_KEY ngoài CSDL). Một phần: chỉ dòng có giá trị.
CREATE INDEX employee_phone_bidx_idx ON employee (company_id, phone_bidx) WHERE phone_bidx IS NOT NULL;
CREATE INDEX inquiry_phone_bidx_idx ON inquiry (company_id, phone_bidx) WHERE phone_bidx IS NOT NULL;
CREATE INDEX job_application_phone_bidx_idx ON job_application (company_id, phone_bidx) WHERE phone_bidx IS NOT NULL;

-- inquiry: CHECK "email hoặc phone" phải tính cả phone_enc (dòng mới chỉ có SĐT thì phone = NULL, phone_enc có giá trị).
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'inquiry'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) LIKE '%email IS NOT NULL%phone IS NOT NULL%'
  LOOP
    EXECUTE format('ALTER TABLE inquiry DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE inquiry ADD CONSTRAINT inquiry_contact_present
  CHECK (email IS NOT NULL OR phone IS NOT NULL OR phone_enc IS NOT NULL);

-- attendance_event là bằng chứng gốc (0008): thêm ngoại lệ HẸP cho toạ độ — chuyển bản rõ → bản mã và xoay khoá.
--   · geo_enc: được đặt lần đầu (NULL → giá trị) hoặc mã hoá lại (giá trị → giá trị); KHÔNG được xoá (giá trị → NULL).
--   · geo_lat/geo_lng/geo_accuracy_m/geo_captured_at: chỉ được đổi thành NULL (cả bốn cùng lúc) và chỉ khi đã có geo_enc.
-- Mọi cột khác vẫn bất biến như trước. (Hàm thay thế bằng CREATE OR REPLACE; thân cũ ở 0008.)
CREATE OR REPLACE FUNCTION attendance_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'attendance_event không xoá được' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - 'voided_by_adjustment_id' - 'status' - 'review_reason'
        - 'geo_lat' - 'geo_lng' - 'geo_accuracy_m' - 'geo_captured_at' - 'geo_enc')
     IS DISTINCT FROM (to_jsonb(OLD) - 'voided_by_adjustment_id' - 'status' - 'review_reason'
        - 'geo_lat' - 'geo_lng' - 'geo_accuracy_m' - 'geo_captured_at' - 'geo_enc')
     OR (OLD.voided_by_adjustment_id IS NOT NULL AND NEW.voided_by_adjustment_id IS DISTINCT FROM OLD.voided_by_adjustment_id) THEN
    RAISE EXCEPTION 'attendance_event là bằng chứng gốc — chỉ đổi trạng thái xác minh hoặc đánh dấu huỷ bởi điều chỉnh'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.geo_lat, NEW.geo_lng, NEW.geo_accuracy_m, NEW.geo_captured_at)
       IS DISTINCT FROM (OLD.geo_lat, OLD.geo_lng, OLD.geo_accuracy_m, OLD.geo_captured_at)
     AND NOT (NEW.geo_lat IS NULL AND NEW.geo_lng IS NULL AND NEW.geo_accuracy_m IS NULL AND NEW.geo_captured_at IS NULL
              AND NEW.geo_enc IS NOT NULL) THEN
    RAISE EXCEPTION 'attendance_event: toạ độ gốc chỉ được xoá bản rõ khi đã có bản mã'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.geo_enc IS NOT NULL AND NEW.geo_enc IS NULL THEN
    RAISE EXCEPTION 'attendance_event: không xoá bản mã toạ độ' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

-- Nhãn PII của MỌI cột đã có trong docs/privacy/data-map.yaml (42 cột đã triển khai; 2 cột "planned" — app_user.totp_secret,
-- push_subscription.endpoint — chưa tồn tại: migration thêm chúng phải kèm COMMENT; test khớp hai chiều bắt thiếu).
-- Dạng: `PII: <loại>; class=<PII|SENSITIVE|SECRET>; enc=<yes|no>`. enc=yes = ứng dụng GHI dạng mã hoá (cột *_enc); cột bản rõ chỉ còn
-- dữ liệu cũ tới khi `crypto:backfill --scrub`, rồi bị bỏ ở bước contract.
COMMENT ON COLUMN employee.full_name IS 'PII: họ tên; class=PII; enc=no';
COMMENT ON COLUMN audit_event.source_ip IS 'PII: địa chỉ IP; class=PII; enc=no';
COMMENT ON COLUMN audit_event.user_agent IS 'PII: thông tin thiết bị/trình duyệt; class=PII; enc=no';
COMMENT ON COLUMN employee.work_email IS 'PII: email; class=PII; enc=no';
COMMENT ON COLUMN employee.phone IS 'PII: số điện thoại; class=PII; enc=yes';
COMMENT ON COLUMN employee.hired_on IS 'PII: ngày vào làm; class=PII; enc=no';
COMMENT ON COLUMN employee.terminated_on IS 'PII: ngày chấm dứt hợp đồng; class=PII; enc=no';
COMMENT ON COLUMN employment_history.title IS 'PII: chức danh; class=PII; enc=no';
COMMENT ON COLUMN employment_history.manager_employee_id IS 'PII: quan hệ quản lý; class=PII; enc=no';
COMMENT ON COLUMN app_user.email IS 'PII: email; class=PII; enc=no';
COMMENT ON COLUMN app_user.display_name IS 'PII: tên hiển thị; class=PII; enc=no';
COMMENT ON COLUMN app_user.password_hash IS 'PII: băm mật khẩu; class=SECRET; enc=no';
COMMENT ON COLUMN session.token_hash IS 'PII: băm token phiên; class=SECRET; enc=no';
COMMENT ON COLUMN session.ip IS 'PII: địa chỉ IP; class=PII; enc=no';
COMMENT ON COLUMN session.user_agent IS 'PII: thông tin thiết bị/trình duyệt; class=PII; enc=no';
COMMENT ON COLUMN login_attempt.email IS 'PII: email; class=PII; enc=no';
COMMENT ON COLUMN login_attempt.ip IS 'PII: địa chỉ IP; class=PII; enc=no';
COMMENT ON COLUMN inquiry.name IS 'PII: họ tên; class=PII; enc=no';
COMMENT ON COLUMN inquiry.email IS 'PII: email; class=PII; enc=no';
COMMENT ON COLUMN inquiry.phone IS 'PII: số điện thoại; class=PII; enc=yes';
COMMENT ON COLUMN inquiry.message IS 'PII: văn bản tự do; class=PII; enc=no';
COMMENT ON COLUMN inquiry.ip_hash IS 'PII: IP đã băm; class=PII; enc=no';
COMMENT ON COLUMN job_application.name IS 'PII: họ tên; class=PII; enc=no';
COMMENT ON COLUMN job_application.email IS 'PII: email; class=PII; enc=no';
COMMENT ON COLUMN job_application.phone IS 'PII: số điện thoại; class=PII; enc=yes';
COMMENT ON COLUMN job_application.cover_letter IS 'PII: văn bản tự do; class=PII; enc=no';
COMMENT ON COLUMN job_application.ip_hash IS 'PII: IP đã băm; class=PII; enc=no';
COMMENT ON COLUMN attendance_event.geo_lat IS 'PII: vị trí GPS - vĩ độ; class=SENSITIVE; enc=yes';
COMMENT ON COLUMN attendance_event.geo_lng IS 'PII: vị trí GPS - kinh độ; class=SENSITIVE; enc=yes';
COMMENT ON COLUMN attendance_event.geo_accuracy_m IS 'PII: độ chính xác vị trí; class=SENSITIVE; enc=yes';
COMMENT ON COLUMN attendance_event.geo_captured_at IS 'PII: thời điểm lấy vị trí; class=SENSITIVE; enc=yes';
COMMENT ON COLUMN attendance_event.device IS 'PII: định danh thiết bị; class=PII; enc=no';
COMMENT ON COLUMN leave_request.reason IS 'PII: lý do nghỉ (có thể lộ sức khoẻ); class=SENSITIVE; enc=yes';
COMMENT ON COLUMN file_object.original_name IS 'PII: tên tệp do người dùng đặt; class=PII; enc=no';
COMMENT ON COLUMN audit_event.before IS 'PII: ảnh chụp audit trước thay đổi; class=PII; enc=no';
COMMENT ON COLUMN audit_event.after IS 'PII: ảnh chụp audit sau thay đổi; class=PII; enc=no';
COMMENT ON COLUMN outbox_event.payload IS 'PII: nội dung thông báo chờ gửi; class=PII; enc=no';
COMMENT ON COLUMN period_export.content IS 'PII: CSV bảng công; class=PII; enc=no';
COMMENT ON COLUMN data_subject_request.note IS 'PII: ghi chú văn bản tự do; class=PII; enc=no';
COMMENT ON COLUMN data_subject_request.subject_ref IS 'PII: mã tham chiếu chủ thể; class=PII; enc=no';
COMMENT ON COLUMN consent_record.subject_id IS 'PII: mã nội bộ chủ thể; class=PII; enc=no';
COMMENT ON COLUMN subject_file.storage_key IS 'PII: khoá blob tệp; class=PII; enc=no';

-- Cột bản mã và chỉ mục mù (không phải cột PII bản rõ nên không nằm trong data-map; nhãn riêng để rà soát).
COMMENT ON COLUMN attendance_event.geo_enc IS 'ENC: bản mã AES-256-GCM của toạ độ GPS (lat, lng, độ chính xác, thời điểm); class=SENSITIVE';
COMMENT ON COLUMN employee.phone_enc IS 'ENC: bản mã AES-256-GCM của employee.phone; class=PII';
COMMENT ON COLUMN employee.phone_bidx IS 'BIDX: chỉ mục mù HMAC-SHA256 của employee.phone (khoá DATA_INDEX_KEY), không phải bản rõ; class=PII';
COMMENT ON COLUMN inquiry.phone_enc IS 'ENC: bản mã AES-256-GCM của inquiry.phone; class=PII';
COMMENT ON COLUMN inquiry.phone_bidx IS 'BIDX: chỉ mục mù HMAC-SHA256 của inquiry.phone (khoá DATA_INDEX_KEY), không phải bản rõ; class=PII';
COMMENT ON COLUMN job_application.phone_enc IS 'ENC: bản mã AES-256-GCM của job_application.phone; class=PII';
COMMENT ON COLUMN job_application.phone_bidx IS 'BIDX: chỉ mục mù HMAC-SHA256 của job_application.phone (khoá DATA_INDEX_KEY), không phải bản rõ; class=PII';
COMMENT ON COLUMN leave_request.reason_enc IS 'ENC: bản mã AES-256-GCM của leave_request.reason; class=SENSITIVE';
