---
title: SLO / SLI — X-Company
updated: 2026-10-18
status: nháp — metric đã có trong ứng dụng (`/api/metrics`, T-038); chưa có Prometheus thật nên query chưa chạy thử trên dữ liệu thật
---

# SLO và SLI (OPS-SLO-001)

SLI luôn là tỷ lệ **tốt / tổng** trong một cửa sổ. Mục tiêu lấy từ PROJECT.md mục 5 (SLO 99,9%/tháng **sau pilot**; ghi chấm công p95 < 1 s).
"Query" là PromQL trên metric thật của ứng dụng (`lib/http/metrics.ts`, OTel `http.server.request.duration` → Prometheus) hoặc SQL PostgreSQL (chạy được trên schema hiện tại).

Metric nguồn (xuất ở `GET /api/metrics`, bearer `METRICS_TOKEN`; không đặt token thì endpoint 404 — chỉ cho mạng nội bộ/Prometheus scrape):
- `http_server_request_duration_seconds` (histogram, giây; bucket 5 ms … 10 s, có `le="1"`) với nhãn `http_request_method`, `http_route` (**mẫu route**, vd `/api/app/tasks/[id]/[action]`, không phải path đầy đủ), `http_response_status_code`. Đo ở mọi route đi qua `publicRoute`/`withActor` (API nghiệp vụ); `/api/healthz`, `/api/readyz` không đo (không tính vào SLI).
- `outbox_dead_total` (gauge): số việc outbox `status = 'dead'` (DLQ); vắng mặt khi không đọc được DB (không báo 0 giả).
- `http_server_series_dropped_total` (counter): quan sát bị bỏ vì vượt trần số chuỗi nhãn (1 000) — phải luôn 0.
- Bộ đếm nằm trong bộ nhớ tiến trình: khởi động lại thì về 0 (Prometheus `rate()` tự xử lý reset); mỗi instance một bộ.

**Giới hạn đã biết:** chưa có Prometheus thật nên PromQL ở đây và `ops/prometheus/alerts.yml` **chưa được chạy thử**; chỉ kiểm cấu trúc bằng `npm run -s check:alerts` (rồi `promtool check rules` khi có hạ tầng) và `npm run -s check:docs` (có định nghĩa tốt/tổng, có query, có mục tiêu). Chưa kiểm cú pháp bằng sloth/OpenSLO.

| SLI | Loại | Tốt | Tổng | SLO | Cửa sổ | Nguồn |
|---|---|---|---|---|---|---|
| SLI-1 Khả dụng web | availability | phản hồi HTTP không phải 5xx | mọi phản hồi HTTP của route đo | 99,9% | 30 ngày | `http_server_request_duration_seconds_count` |
| SLI-2 Độ trễ ghi chấm công | latency | yêu cầu ghi sự kiện công xử lý ≤ 1 s | mọi yêu cầu ghi sự kiện công | 95% (p95 < 1 s) | 30 ngày | `http_server_request_duration_seconds_bucket{le="1"}` |
| SLI-3 Độ tươi outbox | freshness | `outbox_event` xử lý trong ≤ 5 phút kể từ lúc tạo | `outbox_event` đã tới hạn xử lý | 99% | 30 ngày | bảng `outbox_event` (worker T-029) |

## SLI-1 — khả dụng
```promql
sum(rate(http_server_request_duration_seconds_count{http_response_status_code!~"5.."}[30d]))   # tốt (good)
/
sum(rate(http_server_request_duration_seconds_count[30d]))                                      # tổng (total)
```

## SLI-2 — độ trễ ghi chấm công
```promql
sum(rate(http_server_request_duration_seconds_bucket{http_route="/api/app/attendance/events",le="1"}[30d]))   # tốt (good)
/
sum(rate(http_server_request_duration_seconds_count{http_route="/api/app/attendance/events"}[30d]))            # tổng (total)
```
`http_route` là mẫu route thật của `app/api/app/attendance/events/route.ts`.

## SLI-3 — độ tươi outbox (SQL)
```sql
SELECT count(*) FILTER (WHERE processed_at IS NOT NULL AND processed_at - available_at <= interval '5 minutes') AS good,
       count(*) AS total
FROM outbox_event
WHERE available_at >= now() - interval '30 days' AND available_at <= now();
```
Hàng chưa xử lý nhưng đã quá 5 phút tính vào `total` mà không vào `good`.

## Ngân sách lỗi và hành động
Ngân sách lỗi SLO 99,9%/30 ngày ≈ 43 phút. Hết 50% ngân sách → dừng việc không khẩn cấp, ưu tiên độ tin cậy; hết 100% → chỉ sửa lỗi cho tới khi hồi phục.

## Cảnh báo (rule mẫu — `ops/prometheus/alerts.yml`)
Burn rate đa cửa sổ (Google SRE Workbook): cảnh báo chỉ bắn khi cả cửa sổ dài lẫn ngắn cùng vượt ngưỡng.

| Rule | Điều kiện | Mức | Owner |
|---|---|---|---|
| `XCAvailabilityFastBurn` | lỗi 5xx > 14,4 × 0,001 trong 1h **và** 5m, giữ 2m | page | seeker19110 |
| `XCAvailabilitySlowBurn` | lỗi 5xx > 6 × 0,001 trong 6h **và** 30m, giữ 15m | ticket | seeker19110 |
| `XCAttendanceLatencyFastBurn` | tỷ lệ chậm > 6 × 0,05 trong 1h **và** 5m, giữ 5m | ticket | seeker19110 |
| `XCOutboxDeadLetter` | `outbox_dead_total > 0` giữ 15m (BE-JOB-004) | ticket | seeker19110 |

Mỗi rule có `severity`, `owner`, `runbook_url` (→ [RUNBOOK.md](RUNBOOK.md) mục 4 và "DLQ / redrive"); `npm run -s check:alerts` chặn rule thiếu các trường này. Chưa nối Prometheus/Alertmanager thật: việc của chủ dự án khi có hạ tầng giám sát.
