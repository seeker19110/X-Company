-- AUD-DATA-006: sàn tuổi cho đường xoá toạ độ GPS (0029). Hàm attendance_event_erase_geo nhận p_before tuỳ ý ≤ now(), nên
-- role ứng dụng gọi với p_before = now() xoá được MỌI toạ độ, bỏ qua RETENTION_GEO_DAYS (min 1 ngày ở lib/nen/env.ts).
-- Sửa: CREATE OR REPLACE cùng chữ ký, thân như 0029 + từ chối mốc trong vòng 1 ngày gần nhất (khớp sàn của biến môi trường).
-- Quyền EXECUTE (REVOKE PUBLIC, GRANT xc_app_rw) và SECURITY DEFINER/search_path/cờ xc.geo_erase giữ nguyên.
-- Đường lùi: migration mới CREATE OR REPLACE lại thân 0029 (không đổi dữ liệu).
CREATE OR REPLACE FUNCTION attendance_event_erase_geo(p_before timestamptz, p_limit integer) RETURNS SETOF uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  SET xc.geo_erase = 'on'
AS $$
BEGIN
  IF p_before IS NULL OR p_before > now() - interval '1 day' THEN
    RAISE EXCEPTION 'attendance_event_erase_geo: mốc thời gian phải có và cũ hơn ít nhất 1 ngày'
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
