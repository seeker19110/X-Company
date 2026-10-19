---
title: Diễn tập Prometheus + Alertmanager cục bộ
updated: 2026-10-19
status: faithful-fixture — máy dev, KHÔNG phải hạ tầng giám sát production
---

# Diễn tập Prometheus + Alertmanager (T-054)

Sinh bởi `npm run -s ops:stack:drill` lúc 2026-10-19T12:19:51.504Z trên commit `bfbbd695b55cc014120db05a710d97487379e387+dirty`. Kết luận: **PASS**.

Công cụ (ghim sha256, `scripts/tools/install-tool.mjs`): Prometheus/promtool 3.14.0 · Alertmanager/amtool 0.34.1. Node v22.22.0, Next 16.4.2, Linux 6.18.44-fc-v139 x64.

## Kiểm tĩnh

| Kiểm | Lệnh | Kết quả |
| --- | --- | --- |
| rule hợp lệ | `promtool check rules ops/prometheus/alerts.yml` | đạt |
| unit test rule (đồng hồ giả) | `promtool test rules ops/prometheus/alerts.test.yml` | đạt |
| cấu hình Prometheus mẫu | `promtool check config --syntax-only ops/prometheus/prometheus.yml` | đạt |
| cấu hình Alertmanager mẫu | `amtool check-config ops/alertmanager/alertmanager.yml` | đạt |
| mọi alert có ca bắn + ca không bắn | `ruleCoverage(alerts.yml, alerts.test.yml)` | đạt |

## End-to-end (app → Prometheus → Alertmanager → webhook)

| Bước | Kết quả | Chi tiết |
| --- | --- | --- |
| /api/metrics từ chối khi thiếu bearer | đạt | HTTP 401 |
| Prometheus scrape /api/metrics có bearer | đạt | up == 1 sau 5590 ms |
| metric HTTP của app vào TSDB | đạt | sum(http_server_request_duration_seconds_count) = 40 |
| gauge outbox_dead_total có mặt | đạt | giá trị 0 |
| rule thật nạp, health=ok | đạt | XCOutboxDeadLetter:ok, XCAvailabilityFastBurn:ok, XCAvailabilitySlowBurn:ok, XCAttendanceLatencyFastBurn:ok |
| truy vấn SLI trong docs/ops/SLO.md chạy được | đạt | 2 truy vấn status=success |
| Prometheus nối Alertmanager | đạt | 1 Alertmanager hoạt động |
| nền khoẻ: không thông báo nào | đạt | 0 thông báo trong lúc app chạy bình thường |
| dừng app → firing tới webhook | đạt | XCDrillTargetDown sau 2160 ms |
| bật lại app → resolved tới webhook | đạt | sau 73 ms |
| rule SLO thật không bắn khi lưu lượng sạch | đạt | 0 cảnh báo |
| payload webhook đúng định dạng v4 | đạt | 2 thông báo, 0 hỏng |

## Không chứng minh

- Không phải hạ tầng production: một máy dev, Prometheus/Alertmanager một bản (không HA, không lưu trữ dài hạn, không remote-write).
- Kênh nhận là webhook HTTP cục bộ do drill dựng; chưa gửi tới kênh trực có người (Slack/điện thoại/email) — cần URL thật trong url_file.
- Rule SLO thật được kiểm bằng `promtool test rules` trên chuỗi tổng hợp với đồng hồ giả; end-to-end thời gian thật chỉ chạy rule diễn tập `up == 0` (cửa sổ burn-rate 1h–6h không chờ được trong một lần chạy).
- Cấu hình mẫu ops/ chỉ kiểm cú pháp (`--syntax-only`, amtool); đường dẫn credentials_file/url_file trên máy thật chưa tồn tại.
- Không TLS giữa Prometheus và app (scrape http trên 127.0.0.1); production nên scrape qua mạng nội bộ hoặc TLS.
