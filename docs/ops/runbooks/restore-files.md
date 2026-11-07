---
title: Khôi phục kho tệp
updated: 2026-11-07
last_drilled: "kho S3: diễn tập tự động cục bộ (faithful-fixture, tests/db/backup-offsite.test.ts); kho đĩa: chưa diễn tập"
status: "đĩa (D-005) — mẫu tay; S3 (D-073) — script sao lưu/diễn tập/khôi phục (T-126)"
---

# Khôi phục kho tệp private

Kho tệp chọn bằng `FILE_STORAGE` (`lib/files/storage.ts`, `adapters/register-storage.ts`): `disk` (mặc định) — thư mục `FILE_STORAGE_DIR` (mặc định `.data/files`); `s3` — bucket S3-compatible (`S3_*`). Cả hai lưu theo khoá `aa/<40 hex>` và chỉ giữ BẢN MÃ (AES-256-GCM, khoá tệp bọc bằng khoá chủ env/KMS; kho đĩa có thể còn tệp cũ bản rõ trước T-048). Bảng `file_object` giữ `storage_key`, `sha256` (bản rõ), `size_bytes`.

Khôi phục **cùng thời điểm T** với DB ([restore-db.md](restore-db.md)). Đọc lại tệp cần khoá chủ của thời điểm sao lưu — xem [RUNBOOK §Xoay bí mật](../RUNBOOK.md) (giữ khoá cũ trong kho bí mật tới khi bản sao lưu cũ hết hạn giữ).

## A. Sao lưu

### Kho S3 (`FILE_STORAGE=s3`)
```bash
# env như ứng dụng (FILE_STORAGE=s3, S3_*, DATA_ENCRYPTION_KEYS | KMS_*) + RESTIC_REPOSITORY, RESTIC_PASSWORD_FILE
npm run -s backup:files          # scripts/backup-files.sh — chụp bản mã + manifest → restic (thẻ xc-files) → check → forget
npm run -s backup:files:drill    # scripts/restore-files-drill.sh — khôi phục vào thư mục tạm, đọc qua đường giải mã, so sha256
```
Bản chụp: `files-manifest.json` (khoá, kích thước, sha256 bản mã, sha256 bản rõ) + `objects/<aa>/<40 hex>` (bản mã nguyên byte). Đối tượng không phải của ứng dụng → dừng, nêu khoá (exit 1). Mã thoát + chính sách giữ: [RUNBOOK §Sao lưu kho tệp S3](../RUNBOOK.md).

### Kho đĩa (mẫu đề xuất — chưa có script)
```bash
rsync -a --delete-after "$FILE_STORAGE_DIR"/ "<nơi-lưu-sao-lưu>/files-$(date -u +%Y%m%dT%H%MZ)/"
```
Quyền thư mục `0700`, tệp `0600`; sao lưu phải mã hoá và hạn chế quyền như DB.

## B. Khôi phục

### Kho S3
```bash
set -euo pipefail
W="$(mktemp -d)"
restic restore latest --tag xc-files --target "$W"          # hoặc snapshot theo thời điểm T: restic snapshots --tag xc-files
SNAP="$(dirname "$(find "$W" -name files-manifest.json)")"
npx --no-install tsx scripts/files-s3.ts verify "$SNAP"      # sha256 bản mã + giải mã thử, trước khi chạm bucket
# S3_* trỏ vào bucket ĐÍCH (bucket mới, hoặc bucket cũ khi chỉ mất một phần đối tượng)
npx --no-install tsx scripts/files-s3.ts restore "$SNAP"     # ghi đối tượng còn thiếu, rồi đọc lại MỌI mục qua objectStorage.get, so sha256
rm -rf "$W"
```
- `restore` KHÔNG ghi đè đối tượng đã có ở đích (bản trên đích có thể đã được xoay khoá; ghi đè bằng bản cũ gắn lại khoá cũ). Chỉ dùng `--overwrite` khi chắc bản trên đích hỏng.
- Bản chụp hỏng (sha256 bản mã lệch) → từ chối, không ghi gì. Chạy lại an toàn (đối tượng đã ghi → `skipped_existing`).
- Exit: 0 đạt · 1 lệch/không đọc được/S3 lỗi · 2 cấu hình. Đổi bucket → cập nhật `S3_BUCKET` của web VÀ worker rồi restart.

### Kho đĩa
```bash
set -euo pipefail
pm2 stop x-company
rsync -a "<nơi-lưu-sao-lưu>/files-<thời-điểm>/" "$FILE_STORAGE_DIR"/
chmod -R go-rwx "$FILE_STORAGE_DIR"
pm2 start x-company
```

## Xác minh (so với DB)
Kho S3: `files-manifest.json` có `plain_sha256` theo `key`; đối chiếu với `select storage_key, sha256 from file_object` (thiếu đối tượng cho dòng DB = tệp tải lên sau thời điểm chụp hoặc mất). Kho đĩa (tệp đã mã hoá cần đọc qua ứng dụng; vòng dưới chỉ đúng cho tệp bản rõ cũ):
```bash
psql "$DATABASE_URL" -At -F ' ' -c "select storage_key, sha256 from file_object" | while read -r key sum; do
  [ "$(sha256sum "$FILE_STORAGE_DIR/$key" 2>/dev/null | cut -d' ' -f1)" = "$sum" ] || echo "LỖI: $key"
done
```
Tệp có trong kho nhưng không có trong DB là tệp mồ côi (chưa có job dọn — T-027): không xoá khi đang xử lý sự cố.
