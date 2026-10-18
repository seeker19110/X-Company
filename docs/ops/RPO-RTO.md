---
title: RPO / RTO theo kho dữ liệu
updated: 2026-10-18
status: ĐỀ XUẤT — chủ sản phẩm chốt (DB-BACKUP-001)
decided_by: <chủ sản phẩm điền>
---

# RPO / RTO

> Các số dưới là **đề xuất** lấy từ PROJECT.md mục 5 (kế hoạch §13); **chưa được chủ sản phẩm chốt** và **chưa có cơ chế nào chạy** — cột "Cơ chế" là thiết kế đề xuất, không phải hiện trạng. Tới khi chốt và diễn tập, không được hứa các số này với khách/nhân viên.

| Kho | RPO (đề xuất) | RTO (đề xuất) | Cơ chế đề xuất | Hiện trạng | Lần diễn tập gần nhất |
|---|---|---|---|---|---|
| PostgreSQL (nghiệp vụ, audit, phiên) | ≤ 15 phút | ≤ 4 giờ | base backup hằng ngày + lưu trữ WAL liên tục (PITR) tới nơi ngoài máy chủ, mã hoá | chưa cấu hình | chưa diễn tập |
| Kho tệp private (`FILE_STORAGE_DIR`) | ≤ 1 giờ | ≤ 4 giờ | `rsync` mỗi giờ tới nơi ngoài máy chủ (hoặc versioning của S3-compatible khi chuyển adapter) | chưa cấu hình | chưa diễn tập |
| Cấu hình và bí mật (kho bí mật) | 0 (bản sao có phiên bản) | ≤ 1 giờ | kho bí mật có lịch sử; `.env.example` trong repo | `<chủ dự án điền>` | chưa diễn tập |
| Mã nguồn | 0 | ≤ 1 giờ | GitHub + bản sao máy dev | có | — |

Quy trình: [runbooks/restore-db.md](runbooks/restore-db.md), [runbooks/restore-files.md](runbooks/restore-files.md). Chủ sản phẩm chốt: ngày `<điền>` bởi `<điền>`.
