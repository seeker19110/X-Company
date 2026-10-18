-- Hồi quy rà lại PR #8 #9: ngưỡng xác minh QR quét ngoại tuyến tách khỏi ngưỡng lệch giờ trực tuyến.
ALTER TABLE attendance_policy ADD COLUMN qr_offline_review_sec integer NOT NULL DEFAULT 1800
  CHECK (qr_offline_review_sec BETWEEN 60 AND 259200);
