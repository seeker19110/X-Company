---
title: Khôi phục PostgreSQL
updated: 2026-10-18
last_drilled: chưa diễn tập
status: nháp — đã có sao lưu + diễn tập khôi phục cục bộ (faithful-fixture, xem ../restore-drills.md); chưa có sao lưu tự động/ngoài máy trên hạ tầng thật; số liệu RPO/RTO ở ../RPO-RTO.md là đề xuất
---

# Khôi phục PostgreSQL tới thời điểm T

> Người **không phải tác giả** phải chạy được từ tài liệu này (OPS-DR-008). Chưa diễn tập; ghi tên người diễn tập ở [../RUNBOOK.md](../RUNBOOK.md) mục 6.
> Repo có `npm run -s backup` (sao lưu) và `npm run -s backup:drill` (diễn tập khôi phục vào CSDL tạm) — xem [../RUNBOOK.md](../RUNBOOK.md) mục "Sao lưu và khôi phục thử cục bộ"; chưa có lịch tự động/ngoài máy trên hạ tầng thật. Các lệnh dưới là mẫu khôi phục cho cơ chế được đề xuất ở [../RPO-RTO.md](../RPO-RTO.md) (mục A dùng đúng định dạng `pg_dump -Fc` mà `backup.sh` tạo ra). `<chủ dự án điền>` = thông tin hạ tầng chưa có.

## Thứ tự phụ thuộc
1. Dừng ghi: `pm2 stop x-company` (tránh ghi vào DB đang khôi phục).
2. Khôi phục DB (tài liệu này) → 3. xác minh → 4. khôi phục tệp ([restore-files.md](restore-files.md), cùng thời điểm T để `file_object` khớp tệp) → 5. xoay bí mật nếu nguyên nhân là lộ ([../RUNBOOK.md](../RUNBOOK.md)) → 6. `pm2 start x-company`.

## A. Khôi phục từ bản `pg_dump` (logical)
```bash
set -euo pipefail
createdb -h "<host>" -U "<role-quản-trị>" xc_restore                       # DB mới, KHÔNG ghi đè DB đang chạy
pg_restore -h "<host>" -U "<role-quản-trị>" -d xc_restore --no-owner --role=<role-owner-migration> "<đường-dẫn>/xc-<thời-điểm>.dump"
```
Role `xc_app_rw` (nhóm) có sẵn từ migration 0001; role đăng nhập của ứng dụng phải được cấp lại: `GRANT xc_app_rw TO <role-ứng-dụng>;`.

## B. Về thời điểm T bất kỳ (PITR, cần lưu trữ WAL — đề xuất, chưa cấu hình)
```bash
# 1) dựng lại từ base backup gần T nhất vào thư mục mới, 2) đặt trong postgresql.conf / recovery:
#    restore_command = 'cp <thư-mục-WAL>/%f %p'
#    recovery_target_time = '2026-10-18 09:30:00+00'     # UTC
#    recovery_target_action = 'promote'
# 3) tạo tệp recovery.signal trong data directory rồi khởi động PostgreSQL
```

## Xác minh (bắt buộc trước khi chuyển hướng ứng dụng)
```bash
export DATABASE_URL="postgres://<role-ứng-dụng>@<host>/xc_restore"      # mật khẩu lấy từ kho bí mật
psql "$DATABASE_URL" -c "select count(*) from audit_event"                # có dữ liệu, mốc occurred_at max ≈ T
npm run audit:verify                                                       # exit 0 = chuỗi audit toàn vẹn
psql "$DATABASE_URL" -c "select code, status, current_version from attendance_period order by created_at desc limit 5"
psql "$DATABASE_URL" -c "select count(*) from file_object"                # đối chiếu với restore-files.md
```
Chuyển hướng: đổi `DATABASE_URL` của ứng dụng sang `xc_restore` (hoặc đổi tên DB), `pm2 restart x-company --update-env`, kiểm `curl -fsS "$APP_ORIGIN/robots.txt"`.
Mất dữ liệu giữa T và lúc sự cố: ghi vào timeline sự cố; sự kiện chấm công ngoại tuyến sẽ đồng bộ lại từ thiết bị (idempotency theo khoá).
