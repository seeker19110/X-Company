-- Đường xoá toạ độ GPS có kiểm soát (T-068; AUD-DATA-003, STD-PRIV-005, CMP-PRIV-005). Không sửa migration cũ, không đổi
-- dữ liệu. Gồm: một hàm xoá + quyền EXECUTE, một index, và CREATE OR REPLACE thân guard attendance_event_guard (thay thân ở
-- 0025 — bắt buộc vì SECURITY DEFINER không bỏ qua trigger).
--
-- Vấn đề: guard của attendance_event (0025) chặn đặt geo_enc về NULL với MỌI role → không xoá được toạ độ khi tới hạn lưu
-- giữ hoặc khi chủ thể yêu cầu xoá. SECURITY DEFINER không bỏ qua trigger, nên guard phải nhận ra đường xoá hợp lệ:
--   · hàm SECURITY DEFINER hẹp attendance_event_erase_geo (dưới) đặt CẢ NĂM cột toạ độ (geo_enc + bốn cột bản rõ) về NULL, không đụng cột khác;
--   · hàm bật cờ xc.geo_erase = 'on' bằng mệnh đề SET của hàm (tự hoàn nguyên khi hàm trả về — không rò ra giao dịch gọi);
--   · guard chỉ cho xoá khi cờ bật VÀ current_user là owner của bảng (chỉ đúng khi đang chạy trong hàm SECURITY DEFINER do
--     owner tạo). Role ứng dụng tự `SET xc.geo_erase` vẫn bị chặn (current_user ≠ owner); owner UPDATE trực tiếp không có cờ
--     cũng bị chặn. Mọi quy tắc khác của guard giữ nguyên thân 0025.
-- Mốc thời gian lưu giữ: server_received_at (đồng hồ server; device_time do client gửi nên không dùng để tính hạn).
-- Audit: hàm không ghi audit (chuỗi băm audit tính ở lib/audit); người gọi ghi audit đếm trong CÙNG giao dịch
-- (lib/worker/retention.ts — `retention.geo_erase`).
--
-- Xoá theo yêu cầu chủ thể (DSAR) CHƯA có hàm: thêm bằng migration mới khi có task DSAR dùng nó (thu hẹp bề mặt).
--
-- Đường lùi: ứng dụng bản trước không gọi hàm và không dùng index mới → chạy nguyên trên schema này; guard mới chặt như
-- cũ với mọi UPDATE không đi qua hàm. Gỡ hẳn (migration contract sau): DROP FUNCTION attendance_event_erase_geo(timestamptz,
-- integer); DROP INDEX attendance_event_geo_retention_idx; khôi phục guard
-- bằng thân hàm ở 0025. Toạ độ đã xoá thì không lấy lại được (đúng mục đích) — ngoài bản sao lưu theo vòng đời sao lưu.

-- Bộ chọn hàng còn toạ độ (bất kỳ cột nào) theo mốc nhận — cùng biểu thức với RETENTION_SELECTORS (lib/worker/retention.ts)
-- để planner dùng được index một phần này. Bảng chưa có dữ liệu GPS thật nên không cần CONCURRENTLY.
CREATE INDEX attendance_event_geo_retention_idx ON attendance_event (server_received_at)
  WHERE num_nonnulls(geo_enc, geo_lat, geo_lng, geo_accuracy_m, geo_captured_at) > 0;

CREATE OR REPLACE FUNCTION attendance_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  geo_erase boolean;
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
  -- Đường xoá có kiểm soát (0029): chỉ trong hàm SECURITY DEFINER của owner, chỉ khi cả năm cột toạ độ thành NULL.
  geo_erase := current_setting('xc.geo_erase', true) = 'on'
    AND current_user = (SELECT pg_catalog.pg_get_userbyid(c.relowner) FROM pg_catalog.pg_class c WHERE c.oid = TG_RELID);
  IF geo_erase
     AND num_nonnulls(NEW.geo_enc, NEW.geo_lat, NEW.geo_lng, NEW.geo_accuracy_m, NEW.geo_captured_at) = 0 THEN
    RETURN NEW;
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

-- Retention: xoá toạ độ của tối đa p_limit hàng nhận TRƯỚC p_before (chỉ <, ranh giới giữ). Trả company_id của từng hàng đã
-- xoá (người gọi đếm theo công ty để ghi audit). SKIP LOCKED: hai lượt chạy song song không xoá/đếm trùng.
CREATE FUNCTION attendance_event_erase_geo(p_before timestamptz, p_limit integer) RETURNS SETOF uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  SET xc.geo_erase = 'on'
AS $$
BEGIN
  IF p_before IS NULL OR p_before > now() THEN
    RAISE EXCEPTION 'attendance_event_erase_geo: mốc thời gian phải có và không ở tương lai'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'attendance_event_erase_geo: cỡ lô phải trong 1..10000' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
    UPDATE public.attendance_event e
       SET geo_enc = NULL, geo_lat = NULL, geo_lng = NULL, geo_accuracy_m = NULL, geo_captured_at = NULL
     WHERE e.id IN (
       SELECT a.id FROM public.attendance_event a
        WHERE num_nonnulls(a.geo_enc, a.geo_lat, a.geo_lng, a.geo_accuracy_m, a.geo_captured_at) > 0
          AND a.server_received_at < p_before
        LIMIT p_limit FOR UPDATE SKIP LOCKED)
    RETURNING e.company_id;
END
$$;

-- Hàm mặc định EXECUTE cho PUBLIC → thu hồi; chỉ role nhóm ứng dụng (worker dùng cùng role) được gọi.
REVOKE ALL ON FUNCTION attendance_event_erase_geo(timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION attendance_event_erase_geo(timestamptz, integer) TO xc_app_rw;
