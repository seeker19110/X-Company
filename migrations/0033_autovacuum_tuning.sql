-- Tham số autovacuum riêng cho bảng ghi nhiều (DB-PERF-008, T-098). Chỉ đổi reloptions — không đổi dữ liệu/kiểu/khoá chính.
-- Nguồn: tài liệu PostgreSQL 16–18 §24.1 "Routine Vacuuming" (§24.1.6 The Autovacuum Daemon; §24.1.5 Preventing Transaction ID
-- Wraparound Failures) và §19.10 Automatic Vacuuming (giá trị mặc định), tra 2026-10-24. Cụm test/CI: PostgreSQL 16 (≥ 13 nên
-- có autovacuum_vacuum_insert_scale_factor).
--
-- Công thức (§24.1.6): bảng được VACUUM khi n_dead_tup > autovacuum_vacuum_threshold (50) + scale_factor × reltuples; được
-- VACUUM do chèn khi số hàng chèn từ lần trước > autovacuum_vacuum_insert_threshold (1000) + insert_scale_factor × reltuples;
-- được ANALYZE khi số hàng đổi > 50 + analyze_scale_factor × reltuples. Mặc định toàn cụm: vacuum 0,2 · insert 0,2 · analyze 0,1
-- — tức một bảng 10 triệu hàng phải tích ~2 triệu hàng chết mới được dọn. Bảng hàng đợi/phiên/cửa sổ tần suất bị UPDATE/DELETE
-- liên tục nên hạ hệ số để dọn sớm, giữ phình (bloat) nhỏ và đều; bảng chỉ-chèn cần VACUUM do chèn sớm hơn để đóng băng (freeze)
-- trang dần dần (giảm khối lượng VACUUM chống wraparound dồn một lần) và cập nhật visibility map; ANALYZE sớm hơn để thống kê
-- của cột thời gian (truy vấn theo khoảng gần đây, job retention) không tụt hậu.
--
-- Hai nhóm (xác định từ mã):
--   • Xoay vòng (UPDATE/DELETE nhiều): vacuum 0,05 · analyze 0,02 · insert 0,05.
--       outbox_event (worker: pending → processing → done/dead; retention xoá done), session (UPDATE last_seen_at mỗi request;
--       retention xoá), idempotency_record (INSERT rồi UPDATE state = done; retention xoá), api_rate_window (UPSERT mỗi request
--       có giới hạn tần suất), public_rate_event (INSERT mỗi yêu cầu công khai; retention xoá sau 1 ngày), login_attempt (INSERT
--       mỗi lần đăng nhập; retention xoá), notification (INSERT mỗi người nhận, UPDATE read_at; retention xoá),
--       processed_message (INSERT mỗi việc outbox; retention xoá).
--   • Chỉ-chèn (INSERT là chính, xoá theo lô retention hoặc không bao giờ): vacuum 0,1 · analyze 0,02 · insert 0,05.
--       audit_event (chỉ INSERT — trigger cấm UPDATE/DELETE), attendance_event (INSERT mỗi lần chấm công), rum_sample (INSERT mỗi
--       beacon; retention xoá sau RETENTION_RUM_DAYS).
-- Ngưỡng cảnh báo dead tuples (docs/ops/alerts.json, XCLocalDeadTuplesHigh: tỷ lệ > 0,2 kéo dài 1 giờ) nằm trên cả hệ số mặc định
-- 0,2: vượt nó nghĩa là autovacuum không theo kịp/bị chặn (giao dịch treo giữ xmin), không phải nhịp dọn bình thường.
--
-- Khoá: ALTER TABLE … SET (storage parameter) lấy SHARE UPDATE EXCLUSIVE — không chặn đọc/ghi, chỉ chặn VACUUM/DDL đồng thời.
-- Đường lùi: về mặc định toàn cụm bằng một migration mới, mỗi bảng
--   ALTER TABLE <bảng> RESET (autovacuum_vacuum_scale_factor, autovacuum_analyze_scale_factor, autovacuum_vacuum_insert_scale_factor);
-- ứng dụng không phụ thuộc các tham số này (chỉ ảnh hưởng nhịp dọn của autovacuum).

ALTER TABLE outbox_event SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.05);
ALTER TABLE session SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.05);
ALTER TABLE idempotency_record SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.05);
ALTER TABLE api_rate_window SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.05);
ALTER TABLE public_rate_event SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.05);
ALTER TABLE login_attempt SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.05);
ALTER TABLE notification SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.05);
ALTER TABLE processed_message SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.05);

ALTER TABLE audit_event SET (autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.05);
ALTER TABLE attendance_event SET (autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.05);
ALTER TABLE rum_sample SET (autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.05);
