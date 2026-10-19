---
title: Nhật ký diễn tập khôi phục (cục bộ)
updated: 2026-10-19
status: faithful-fixture — diễn tập tự động trên máy phát triển, KHÔNG phải production; chưa có diễn tập do người khác tác giả (OPS-DR-008)
---

# Nhật ký diễn tập khôi phục (DB-BACKUP-003)

> Nhãn bằng chứng: **faithful-fixture** — PostgreSQL 16 thật (cụm tạm `initdb`, `fsync=off` nên khôi phục nhanh hơn đĩa production), dữ liệu tổng hợp, cùng máy với CSDL nguồn. Không chứng minh: sao lưu ngoài máy, khoá KMS/escrow, khôi phục trên hạ tầng production, PITR/WAL.
> Lệnh: `npm run -s backup` rồi `npm run -s backup:drill` ([RUNBOOK.md](RUNBOOK.md) mục "Sao lưu và khôi phục thử cục bộ"). Mỗi lần diễn tập: kiểm sha256 (thực tế = manifest = tệp `.sha256`) → giải mã → `pg_restore` vào CSDL tạm → so số dòng **mọi** bảng (59 bảng), đầu chuỗi audit theo `chain_key`, phiên bản migration → `scripts/verify-audit-chain.ts` trên bản khôi phục → xoá CSDL tạm.

| Ngày (UTC) | Bản sao lưu dùng | RTO đo được (tổng) | Kiểm tra đã làm | Người làm | Kết quả |
|---|---|---|---|---|---|
| 2026-10-19 | dump 266 KB, 73 dòng (lược đồ + 50 bản ghi audit) | 1,20 s | checksum, 59 bảng khớp số dòng, đầu chuỗi audit, migration, `audit:verify` | tự động (`restore-drill.sh`) do tác nhân AI chạy theo yêu cầu chủ dự án | ĐẠT |
| 2026-10-19 | dump 1,0 MB, 102 074 dòng (100 000 outbox + 2 050 audit) | 2,13 s | như trên | như trên | ĐẠT |
| 2026-10-19 | dump 7,7 MB, 1 104 075 dòng (1 000 000 outbox + 2 050 audit; CSDL nguồn 461 MB) | 11,23 s (`pg_restore` 10,01 s) | như trên | như trên | ĐẠT |
| 2026-10-19 | cùng bản 7,7 MB, mã hoá AES-256-CBC | 9,20 s (giải mã 0,36 s) | như trên + sai khoá → exit 2, thiếu khoá → exit 2 | như trên | ĐẠT |

| 2026-10-19 | từ KHO OFF-SITE restic (kho khác thư mục, cùng máy): dump 30,8 MB mã hoá AES-256, 1 000 035 dòng | 10,31 s (`restic check --read-data` 1,47 s + `restic restore` 0,78 s + `restore-drill.sh` 8,06 s) | restic check toàn bộ dữ liệu, bản khôi phục khớp checksum/59 bảng/chuỗi audit; kho bị sửa một khối hoặc cắt cụt → drill ĐỎ exit 3; thiếu mật khẩu → exit 2; sai mật khẩu → exit 3 | tự động (`restore-offsite-drill.sh`) do tác nhân AI chạy theo yêu cầu chủ dự án | ĐẠT |

Off-site: chạy `npm run -s backup:offsite` rồi `npm run -s backup:offsite:drill` ([RUNBOOK.md](RUNBOOK.md) mục "Sao lưu off-site (restic)"). Test hồi quy: `tests/db/backup-offsite.test.ts`. **Chưa chứng minh**: đích thật khác nhà cung cấp/khu vực, lịch tự động trên máy chủ thật, quyền ghi-chỉ-thêm/immutable, khoá kho do người giữ riêng.

Lần diễn tập đầu do người **không phải tác giả** trên hạ tầng thật (OPS-DR-008): chưa có — việc của chủ dự án trước pilot. Test hồi quy: `tests/db/backup-restore.test.ts` (bản hỏng checksum → exit 3; số dòng lệch → exit 1; chuỗi audit bị sửa → exit 1; giữ N bản; thiếu/sai khoá → exit 2; huỷ dòng ở DB đang chạy → bản khôi phục vẫn đủ).
