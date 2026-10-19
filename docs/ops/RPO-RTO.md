---
title: RPO / RTO theo kho dữ liệu
updated: 2026-10-19
status: ĐỀ XUẤT — chủ sản phẩm chốt (DB-BACKUP-001); đã có sao lưu + diễn tập khôi phục CỤC BỘ (faithful-fixture, chưa production)
decided_by: <chủ sản phẩm điền>
---

# RPO / RTO

> Các số dưới là **đề xuất** lấy từ PROJECT.md mục 5 (kế hoạch §13); **chưa được chủ sản phẩm chốt**. Từ 2026-10-19 có cơ chế sao lưu logical + diễn tập khôi phục **chạy cục bộ** (`scripts/backup.sh`, `scripts/restore-drill.sh`) — cột "Cơ chế" vẫn là thiết kế đề xuất cho production; cột "Hiện trạng" nói rõ cái gì đã chạy thử. Tới khi chốt và diễn tập trên hạ tầng thật, không được hứa các số này với khách/nhân viên.

| Kho | RPO (đề xuất) | RTO (đề xuất) | Cơ chế đề xuất | Hiện trạng | Lần diễn tập gần nhất |
|---|---|---|---|---|---|
| PostgreSQL (nghiệp vụ, audit, phiên) | ≤ 15 phút | ≤ 4 giờ | base backup hằng ngày + lưu trữ WAL liên tục (PITR) tới nơi ngoài máy chủ, mã hoá | **cục bộ**: `pg_dump -Fc` + sha256 + manifest + giữ N bản + mã hoá AES-256 tuỳ chọn (cùng máy, không off-site, không WAL/PITR); RPO đạt được cục bộ = chu kỳ chạy `backup` (đề xuất hằng ngày = 24 giờ, KHÔNG đạt 15 phút) | 2026-10-19, máy dev, faithful-fixture: [restore-drills.md](restore-drills.md) |
| Kho tệp private (`FILE_STORAGE_DIR`) | ≤ 1 giờ | ≤ 4 giờ | `rsync` mỗi giờ tới nơi ngoài máy chủ (hoặc versioning của S3-compatible khi chuyển adapter) | chưa cấu hình | chưa diễn tập |
| Cấu hình và bí mật (kho bí mật) | 0 (bản sao có phiên bản) | ≤ 1 giờ | kho bí mật có lịch sử; `.env.example` trong repo | `<chủ dự án điền>` | chưa diễn tập |
| Mã nguồn | 0 | ≤ 1 giờ | GitHub + bản sao máy dev | có | — |

## Số đo thực (cục bộ — faithful-fixture)
Đo ngày **2026-10-19** (UTC). Môi trường = **máy phát triển cục bộ** (Linux 4 vCPU, 16 GB RAM), PostgreSQL 16.15 cụm tạm `initdb` với `fsync=off`, nguồn và đích cùng máy, dữ liệu tổng hợp (bảng `outbox_event` sinh hàng loạt + chuỗi audit thật). Đây **không** phải production: đĩa/mạng/dung lượng thật sẽ chậm hơn; chỉ dùng làm mốc tương đối và để chứng minh quy trình chạy đúng.

| Cỡ dữ liệu (tổng số dòng / CSDL nguồn) | Cỡ tệp sao lưu | Thời gian backup | Thời gian restore (`pg_restore` vào CSDL tạm) | RTO đo được (kiểm checksum + giải mã + restore + đối chiếu + `audit:verify`) | Ngày đo |
|---|---|---|---|---|---|
| 73 dòng (lược đồ + 50 audit) | 266 KB | 0,20 s | 0,37 s | 1,20 s | 2026-10-19 |
| 102 074 dòng | 1,0 MB | 0,61 s | 1,12 s | 2,13 s | 2026-10-19 |
| 1 104 075 dòng (CSDL 461 MB) | 7,7 MB | 3,54 s | 10,01 s | 11,23 s | 2026-10-19 |
| 1 104 075 dòng, mã hoá AES-256-CBC | 7,7 MB | 3,47 s | 7,78 s (+ giải mã 0,36 s) | 9,20 s | 2026-10-19 |

- **RTO**: số đo trên cho riêng bước khôi phục DB trên cùng máy. RTO thật còn gồm dựng máy chủ, cấp lại role ứng dụng, xoay bí mật, chuyển hướng ứng dụng (chưa đo — OPS-DR-001).
- **RPO**: `rpo_seconds` trong báo cáo chỉ là tuổi bản sao lưu lúc diễn tập (1–15 s trong lần đo). RPO thực = khoảng cách giữa hai lần sao lưu thành công; cảnh báo `XCLocalBackupStale` (docs/ops/alerts.json) bắn khi bản mới nhất cũ hơn 25 giờ.
- Dữ liệu sinh có tính lặp cao nên nén tốt (tệp sao lưu nhỏ hơn CSDL nhiều lần); dữ liệu thật nén kém hơn.

## Chưa chứng minh (nêu thật)
- **Sao lưu ngoài máy (off-site, 3-2-1)**: bản sao lưu nằm cùng máy với CSDL; mất máy = mất cả hai (OPS-DR-003, DB-BACKUP-004, OPS-DR-007 — quyền xoá tách biệt).
- **Khoá mã hoá qua KMS/escrow**: `BACKUP_PASSPHRASE` nằm trong biến môi trường; chưa có bản sao/escrow khoá (OPS-DR-004). `openssl enc` không xác thực bản mã (toàn vẹn dựa vào sha256 + diễn tập + chuỗi audit).
- **Diễn tập trên production** và diễn tập do người khác tác giả (OPS-DR-008, OPS-DR-005); lịch sao lưu tự động trên máy chủ thật + cảnh báo khi job thất bại (DB-BACKUP-002).
- **PITR / WAL liên tục** (RPO ≤ 15 phút), sao lưu kho tệp private (`FILE_STORAGE_DIR`), bí mật, state IaC (OPS-DR-002/006).
- Số RPO/RTO chưa được chủ sản phẩm chốt (DB-BACKUP-001).

Quy trình: [runbooks/restore-db.md](runbooks/restore-db.md), [runbooks/restore-files.md](runbooks/restore-files.md). Chủ sản phẩm chốt: ngày `<điền>` bởi `<điền>`.
