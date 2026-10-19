---
title: Nhật ký thử kích hoạt cảnh báo (cục bộ)
updated: 2026-10-19
status: faithful-fixture — thử trên bộ đánh giá cục bộ (lib/ops/alerts.ts), KHÔNG có Prometheus/Alertmanager/kênh trực thật
---

# Nhật ký thử kích hoạt cảnh báo (OPS-SLO-006)

> Lệnh: `npm run -s alerts:drill` (dựng CSDL tạm đã migrate trên cụm Postgres tạm, không chạm DB nào khác; exit 1 nếu bất kỳ luật nào sai). Hồi quy: `tests/unit/alerts-drill.test.ts` chạy lại đúng bài thử này.
> Mỗi luật trong [alerts.json](alerts.json): (1) nền khoẻ mạnh 13 tick × 5 phút — không luật nào được kêu; (2) gây sự cố giả; (3) luật bắn `firing` tới **cả ba kênh** (tệp JSON-lines, webhook HTTP cục bộ, log sự kiện bảo mật `ops.alert` mức error) — đọc lại từ chính từng kênh; (4) tick thêm khi vẫn đang sự cố → **không gửi lặp**; (5) dọn sự cố → `resolved` (log mức info). Đồng hồ giả tiến theo tick nên thử được cả cửa sổ burn-rate 6 giờ; sự cố là thật: metric sinh bằng bộ đo của ứng dụng, DLQ do worker thật, DSAR/kỳ công quá hạn là hàng thật trong DB, DB lỗi cho readiness là kết nối thật tới cổng đóng, sao lưu quá hạn dùng `scripts/backup.sh` thật.

## Kết quả ngày 2026-10-19 (UTC), máy phát triển

| Luật | Mức | Kịch bản | Bắn ở tick | Hết ở tick | tệp | webhook | log | nền yên | không lặp | Kết quả |
|---|---|---|---|---|---|---|---|---|---|---|
| XCLocalAvailabilityFastBurn | page | 60 phản hồi 5xx mỗi 5 phút trên nền 100 yêu cầu khoẻ mạnh | 2 | 1 | có | có | có | có | có | ĐẠT |
| XCLocalAvailabilitySlowBurn | ticket | 60 phản hồi 5xx mỗi 5 phút, giữ 15 phút (cửa sổ 6 giờ/30 phút) | 4 | 6 | có | có | có | có | có | ĐẠT |
| XCLocalAttendanceLatencyBurn | ticket | 200 yêu cầu ghi chấm công mất 2,5 giây mỗi 5 phút | 2 | 1 | có | có | có | có | có | ĐẠT |
| XCLocalAttendanceP95Slow | ticket | 200 yêu cầu ghi chấm công mất 2,5 giây mỗi 5 phút (p95 > 1 giây) | 2 | 3 | có | có | có | có | có | ĐẠT |
| XCLocalOutboxDeadLetter | ticket | enqueue topic không có handler → worker thật đẩy vào DLQ | 4 | 1 | có | có | có | có | có | ĐẠT |
| XCLocalOutboxStale | ticket | việc pending đã tới hạn từ 10 phút trước mà không worker nào lấy | 2 | 1 | có | có | có | có | có | ĐẠT |
| XCLocalDsarOverdue | ticket | yêu cầu truy cập dữ liệu nhận 31 ngày trước, hạn đã qua 1 ngày, chưa xử lý | 1 | 1 | có | có | có | có | có | ĐẠT |
| XCLocalReadyzDown | page | giả lập DB lỗi: probe readiness trỏ tới cổng đóng (đường mã thật lib/nen/health) | 2 | 1 | có | có | có | có | có | ĐẠT |
| XCLocalMetricsScrapeFailed | ticket | endpoint /api/metrics không trả lời | 2 | 1 | có | có | có | có | có | ĐẠT |
| XCLocalBackupStale | ticket | bản sao lưu thật (backup.sh) bị lùi manifest 26 giờ; hết khi chạy backup.sh lại | 1 | 1 | có | có | có | có | có | ĐẠT |
| XCLocalPeriodCloseOverdue | ticket | kỳ công kết thúc 30 ngày trước vẫn ở trạng thái open | 1 | 1 | có | có | có | có | có | ĐẠT |
| XCLocalAuditChainBroken | page | sửa trái phép một bản ghi audit (tắt trigger) rồi khôi phục | 1 | 1 | có | có | có | có | có | ĐẠT |

"Bắn ở tick" / "Hết ở tick" = số tick (mỗi tick 5 phút giả, riêng `XCLocalAuditChainBroken` 62 phút giả) kể từ lúc gây/dọn sự cố tới khi luật gửi `firing`/`resolved`.

## Chưa thử / giới hạn
- 4 luật trong `ops/prometheus/alerts.yml` (`XCAvailabilityFastBurn`, `XCAvailabilitySlowBurn`, `XCAttendanceLatencyFastBurn`, `XCOutboxDeadLetter`) **chưa được thử** vì chưa có Prometheus/Alertmanager (chỉ kiểm cấu trúc bằng `npm run -s check:alerts`); luật cục bộ ở bảng trên là bản đối ứng chạy được, không thay chúng.
- Kênh trực có người (trang/SMS/chat) chưa có: kênh đã thử là tệp, log và webhook tới máy chủ giả cục bộ. Webhook thật (Slack/Teams/PagerDuty…) chưa thử.
- Trạng thái luật nằm trong bộ nhớ worker: khởi động lại worker thì một cảnh báo đang bắn được gửi lại một lần.
- BASE-ERR-011 (thu thập lỗi ERROR/FATAL qua Sentry/GlitchTip/OTel Collector) chưa đạt: chưa có bộ thu lỗi thật.
