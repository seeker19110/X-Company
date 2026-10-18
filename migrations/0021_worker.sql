-- Worker outbox (T-029): trạng thái việc, thử lại có giới hạn, DLQ (status = 'dead' giữ payload + lỗi + số lần),
-- khử trùng consumer (processed_message), cột ẩn danh cho retention (D-016). Chỉ thêm — không sửa migration cũ.
ALTER TABLE outbox_event
  ADD COLUMN status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'dead')),
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN locked_until timestamptz,
  ADD COLUMN dead_at timestamptz,
  ADD COLUMN job_key text;

-- Dữ liệu cũ: hàng đã xử lý → done; còn lại → pending, thời điểm thử kế tiếp = available_at.
UPDATE outbox_event SET status = 'done' WHERE processed_at IS NOT NULL;
UPDATE outbox_event SET next_attempt_at = available_at;

-- job_key duy nhất theo nghiệp vụ (BE-JOB-001); NULL = không khử trùng khi enqueue (nhiều NULL được phép).
ALTER TABLE outbox_event ADD CONSTRAINT outbox_event_job_key_key UNIQUE (job_key);

CREATE INDEX outbox_event_claim_idx ON outbox_event (next_attempt_at, id) WHERE status IN ('pending', 'processing');
CREATE INDEX outbox_event_dead_idx ON outbox_event (dead_at) WHERE status = 'dead';
CREATE INDEX outbox_event_done_idx ON outbox_event (processed_at) WHERE status = 'done';

-- Relay là at-least-once → consumer ghi (consumer, event_id) cùng giao dịch với tác động (ARC-INT-005).
CREATE TABLE processed_message (
  consumer text NOT NULL,
  event_id bigint NOT NULL REFERENCES outbox_event (id) ON DELETE RESTRICT,
  processed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consumer, event_id)
);
-- FK cần index riêng (UNIQUE bắt đầu bằng consumer); retention xoá processed_message trước khi xoá outbox done.
CREATE INDEX processed_message_event_idx ON processed_message (event_id);

-- Retention (STD-PRIV-005): đánh dấu bản ghi đã ẩn danh (giữ mã + thống kê, xoá PII).
ALTER TABLE inquiry ADD COLUMN anonymized_at timestamptz;
ALTER TABLE job_application ADD COLUMN anonymized_at timestamptz;
