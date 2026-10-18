# Kết nối CSDL — pool, timeout, bảng tính (DB-PERF-004, DB-PERF-005)

Nguồn cấu hình: `lib/db/index.ts` (`getPool`, `POOL_TIMEOUTS`, `PG_SESSION_OPTIONS`), migration `0018_role_timeouts.sql`.

## Cấu hình hiện hành

| Tham số                                | Giá trị                  | Nơi đặt                            |
| -------------------------------------- | ------------------------ | ---------------------------------- |
| `max` (kết nối tối đa mỗi tiến trình)  | `DB_POOL_MAX`, mặc định 10 | `getPool()`                      |
| `connectionTimeoutMillis` (lấy/mở)     | 5 000 ms                 | `POOL_TIMEOUTS`                    |
| `query_timeout` (client, lưới an toàn) | 35 000 ms                | `POOL_TIMEOUTS`                    |
| `statement_timeout` (server)           | 30 s                     | `PG_SESSION_OPTIONS` + `ALTER ROLE` |
| `idle_in_transaction_session_timeout`  | 60 s                     | `PG_SESSION_OPTIONS` + `ALTER ROLE` |

`ALTER ROLE … SET` chỉ có hiệu lực cho vai trò **đăng nhập**. Migration 0018 đặt cho `xc_app_rw` và mọi vai trò đăng nhập
đang là thành viên của nó. Vai trò đăng nhập tạo sau: DBA chạy

```sql
ALTER ROLE <login> SET statement_timeout = '30s';
ALTER ROLE <login> SET idle_in_transaction_session_timeout = '60s';
```

Pool vẫn gửi cùng giá trị lúc bắt tay kết nối nên không phụ thuộc thứ tự này.

## Bảng tính tổng kết nối

Điều kiện: `pool_size × số tiến trình + dự phòng ≤ max_connections` (PostgreSQL mặc định `max_connections = 100`).

| Thành phần                                    | Số tiến trình | Pool | Kết nối |
| --------------------------------------------- | ------------- | ---- | ------- |
| Ứng dụng Next (web + API)                     | 2             | 10   | 20      |
| Chạy migration (role owner, một lần/lần phát hành) | 1        | 1    | 1       |
| Dự phòng: superuser (3), giám sát/sao lưu, psql của DBA | —   | —    | 15      |
| **Tổng**                                      |               |      | **36 ≤ 100** |

Khi tăng số tiến trình hoặc `DB_POOL_MAX`, cập nhật bảng này; vượt 80% `max_connections` thì đặt PgBouncer (transaction
pooling) trước CSDL. Cảnh báo vận hành: `numbackends` trong `pg_stat_database` > 80% `max_connections` (ngưỡng do đội chọn,
chưa có nguồn chuẩn — ghi nhận 2026-10-18).

## Tắt êm

`NEXT_MANUAL_SIG_HANDLE=true` (đã ở script `start`) để Next không tự thoát khi SIGTERM; `lib/nen/shutdown.ts` xử lý:
readiness 503 → chờ `SHUTDOWN_READY_DELAY_MS` (2 s) → ngừng nhận → chờ request ≤ `SHUTDOWN_GRACE_MS` (20 s) → `pool.end()`
(≤ 5 s) → thoát 0. Grace của orchestrator phải ≥ 30 s.
