-- Xoá toạ độ GPS theo yêu cầu xoá của chủ thể (T-121, CMP-RIGHTS-007, D-075). 0029 đã hẹn: đường xoá cho DSAR thêm bằng
-- migration mới khi có task dùng nó. Toạ độ dựa trên đồng ý riêng (mục đích geo_attendance), không thuộc danh mục phải giữ
-- (hồ sơ lao động/bảng công giữ sự kiện chấm công, không cần toạ độ) → xoá khi nhân viên yêu cầu xoá.
--
-- Hàm SECURITY DEFINER hẹp, cùng khuôn với attendance_event_erase_geo (0029/0031): chỉ đặt năm cột toạ độ về NULL cho MỘT
-- nhân viên của MỘT công ty (cờ xc.geo_erase qua mệnh đề SET của hàm — tự hoàn nguyên; guard của bảng nhận ra đường xoá
-- hợp lệ bằng cờ + current_user là owner). Không đụng cột khác, không xoá dòng. Không ghi audit — người gọi
-- (lib/privacy) ghi audit số đếm trong CÙNG giao dịch. FOR UPDATE (không SKIP LOCKED): yêu cầu xoá phải phủ đủ mọi dòng.
--
-- Đường lùi: ứng dụng bản trước không gọi hàm → chạy nguyên trên schema này. Gỡ hẳn (migration contract sau):
-- DROP FUNCTION attendance_event_erase_geo_subject(uuid, uuid). Toạ độ đã xoá không lấy lại được (đúng mục đích) — ngoài
-- bản sao lưu theo vòng đời sao lưu.
CREATE FUNCTION attendance_event_erase_geo_subject(p_company uuid, p_employee uuid) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  SET xc.geo_erase = 'on'
AS $$
DECLARE
  n integer;
BEGIN
  IF p_company IS NULL OR p_employee IS NULL THEN
    RAISE EXCEPTION 'attendance_event_erase_geo_subject: cần công ty và nhân viên' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE public.attendance_event e
     SET geo_enc = NULL, geo_lat = NULL, geo_lng = NULL, geo_accuracy_m = NULL, geo_captured_at = NULL
   WHERE e.id IN (
     SELECT a.id FROM public.attendance_event a
      WHERE a.company_id = p_company AND a.employee_id = p_employee
        AND num_nonnulls(a.geo_enc, a.geo_lat, a.geo_lng, a.geo_accuracy_m, a.geo_captured_at) > 0
      FOR UPDATE);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

REVOKE ALL ON FUNCTION attendance_event_erase_geo_subject(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION attendance_event_erase_geo_subject(uuid, uuid) TO xc_app_rw;
