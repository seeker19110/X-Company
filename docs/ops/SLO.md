---
title: SLO / SLI — X-Company
updated: 2026-10-18
status: nháp — nguồn đo HTTP chưa tồn tại (T-038); SLI-3 chạy được trên schema hiện có
---

# SLO và SLI (OPS-SLO-001)

SLI luôn là tỷ lệ **tốt / tổng** trong một cửa sổ. Mục tiêu lấy từ PROJECT.md mục 5 (SLO 99,9%/tháng **sau pilot**; ghi chấm công p95 < 1 s).
"Query" là PromQL (nguồn metric `http.server.request.duration` — **chưa có**, thuộc T-038) hoặc SQL PostgreSQL (chạy được ngay trên schema hiện tại).
`npm run -s check:docs` kiểm cấu trúc (có định nghĩa tốt/tổng, có query, có mục tiêu); **chưa** kiểm cú pháp bằng công cụ (sloth/OpenSLO/`EXPLAIN`) — việc còn thiếu.

| SLI | Loại | Tốt | Tổng | SLO | Cửa sổ | Nguồn |
|---|---|---|---|---|---|---|
| SLI-1 Khả dụng web | availability | phản hồi HTTP không phải 5xx | mọi phản hồi HTTP | 99,9% | 30 ngày | metric HTTP (chưa có, T-038) |
| SLI-2 Độ trễ ghi chấm công | latency | yêu cầu ghi sự kiện công xử lý ≤ 1 s | mọi yêu cầu ghi sự kiện công | 95% (p95 < 1 s) | 30 ngày | metric HTTP (chưa có, T-038) |
| SLI-3 Độ tươi outbox | freshness | `outbox_event` xử lý trong ≤ 5 phút kể từ lúc tạo | `outbox_event` đã tới hạn xử lý | 99% | 30 ngày | bảng `outbox_event` (có; worker T-029) |

## SLI-1 — khả dụng
```promql
sum(rate(http_server_request_duration_seconds_count{status!~"5.."}[30d]))   # tốt (good)
/
sum(rate(http_server_request_duration_seconds_count[30d]))                    # tổng (total)
```

## SLI-2 — độ trễ ghi chấm công
```promql
sum(rate(http_server_request_duration_seconds_bucket{route="/api/app/attendance/events",le="1"}[30d]))   # tốt (good)
/
sum(rate(http_server_request_duration_seconds_count{route="/api/app/attendance/events"}[30d]))            # tổng (total)
```
Tên `route` là dự kiến; chỉnh theo route thật khi T-038 thêm metric.

## SLI-3 — độ tươi outbox (SQL)
```sql
SELECT count(*) FILTER (WHERE processed_at IS NOT NULL AND processed_at - available_at <= interval '5 minutes') AS good,
       count(*) AS total
FROM outbox_event
WHERE available_at >= now() - interval '30 days' AND available_at <= now();
```
Hàng chưa xử lý nhưng đã quá 5 phút tính vào `total` mà không vào `good`.

## Ngân sách lỗi và hành động
Ngân sách lỗi SLO 99,9%/30 ngày ≈ 43 phút. Hết 50% ngân sách → dừng việc không khẩn cấp, ưu tiên độ tin cậy; hết 100% → chỉ sửa lỗi cho tới khi hồi phục. Cảnh báo theo tốc độ đốt ngân sách sẽ định nghĩa khi có metric; mỗi cảnh báo phải có mục ở [RUNBOOK.md](RUNBOOK.md) mục 4.
