---
title: Khôi phục kho tệp
updated: 2026-10-18
last_drilled: chưa diễn tập
status: nháp — adapter đĩa (D-005); khi chuyển S3-compatible cần viết lại mục B
---

# Khôi phục kho tệp private

Tệp lưu ở `FILE_STORAGE_DIR` (mặc định `.data/files` dưới thư mục chạy) theo khoá `aa/<40 hex>` (`lib/files/storage.ts`); bảng `file_object` giữ `storage_key`, `sha256`, `size_bytes`. Chưa có tác vụ sao lưu tự động trong repo (`<chủ dự án điền: công cụ, nơi lưu>`).

## A. Sao lưu (mẫu đề xuất)
```bash
rsync -a --delete-after "$FILE_STORAGE_DIR"/ "<nơi-lưu-sao-lưu>/files-$(date -u +%Y%m%dT%H%MZ)/"
```
Quyền thư mục `0700`, tệp `0600`; sao lưu phải mã hoá và hạn chế quyền như DB.

## B. Khôi phục
```bash
set -euo pipefail
pm2 stop x-company
rsync -a "<nơi-lưu-sao-lưu>/files-<thời-điểm>/" "$FILE_STORAGE_DIR"/
chmod -R go-rwx "$FILE_STORAGE_DIR"
pm2 start x-company
```
Khôi phục **cùng thời điểm T** với DB ([restore-db.md](restore-db.md)).

## Xác minh (so sha256 với DB)
```bash
psql "$DATABASE_URL" -At -F ' ' -c "select storage_key, sha256 from file_object" | while read -r key sum; do
  [ "$(sha256sum "$FILE_STORAGE_DIR/$key" 2>/dev/null | cut -d' ' -f1)" = "$sum" ] || echo "LỖI: $key"
done
```
Không in dòng `LỖI` = mọi tệp có trong DB đều có mặt và đúng băm. Tệp có trên đĩa nhưng không có trong DB là tệp mồ côi (chưa có job dọn — T-027): không xoá khi đang xử lý sự cố.
