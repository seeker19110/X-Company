-- RUM web-vitals tự làm (T-056, D-042; PRF-WEB-005/008, FE-PERF-001). Chỉ thêm — không sửa migration cũ.
-- Mỗi dòng = MỘT số đo của MỘT lượt xem trang. KHÔNG lưu IP, user agent, mã người dùng, URL đầy đủ hay mã phiên: `page` là MẪU đã
-- chuẩn hoá (lib/rum/page.pure.ts, tập giá trị bị chặn) nên không thể chứa id/đường dẫn của người dùng — không phải dữ liệu cá nhân.
-- Đường lùi: ứng dụng bản trước không biết bảng này (cờ RUM_ENABLED mặc định tắt, route trả 404). Gỡ bằng migration "contract" sau
-- khi không còn bản nào ghi: DROP TABLE rum_sample; DROP INDEX public_rate_event_at_idx.

CREATE TABLE rum_sample (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Làm thô theo PHÚT khi lưu: không cần độ chính xác giây (gộp p75 theo cửa sổ 24 giờ), giảm khả năng đối chiếu với log nơi khác.
  received_at timestamptz NOT NULL DEFAULT date_trunc('minute', now()),
  page text NOT NULL CHECK (length(page) <= 64 AND page LIKE '/%'),
  metric text NOT NULL CHECK (metric IN ('LCP', 'INP', 'CLS', 'FCP', 'TTFB')),
  -- Chỉ số thời gian (LCP/INP/FCP/TTFB): mili giây, số nguyên, tối đa 2 phút.
  value_ms integer CHECK (value_ms BETWEEN 0 AND 120000),
  -- CLS không có đơn vị (điểm bố cục): lưu ×1000 làm tròn để giữ số nguyên (0,1 → 100). Hậu tố `_n` = đại lượng không đơn vị đã rà.
  cls_milli_n integer CHECK (cls_milli_n BETWEEN 0 AND 10000),
  nav_type text CHECK (nav_type IN ('navigate', 'reload', 'back_forward', 'prerender')),
  -- Đúng một cột giá trị được đặt, theo loại chỉ số.
  CONSTRAINT rum_sample_value_by_metric CHECK (
    (metric = 'CLS' AND cls_milli_n IS NOT NULL AND value_ms IS NULL)
    OR (metric <> 'CLS' AND value_ms IS NOT NULL AND cls_milli_n IS NULL)
  )
);
CREATE INDEX rum_sample_page_metric_idx ON rum_sample (page, metric, received_at DESC);
-- Job retention xoá theo thời gian nhận.
CREATE INDEX rum_sample_received_idx ON rum_sample (received_at);

-- Job retention cũng dọn public_rate_event (trước đây không bao giờ bị xoá) theo `at`.
CREATE INDEX public_rate_event_at_idx ON public_rate_event (at);
