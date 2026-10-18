<!-- Nâng cấp phiên bản chính (OPS-MAINT-005) — dùng: thêm `?template=major-upgrade.md` vào URL tạo PR; gắn nhãn `major`. -->

## Mô tả

Nâng `<gói>` từ `<x.y.z>` lên `<X.0.0>`. Lý do: <bản vá bảo mật / EOL / tính năng cần>.

## Bằng chứng

- [ ] Đọc release notes / migration guide: <link>
- [ ] Danh sách breaking change áp vào dự án và chỗ đã sửa:
- [ ] Gate + E2E xanh; coverage không giảm
- [ ] Đối chiếu EOL (`scripts/eol-check.mjs`) sau nâng cấp

## Rủi ro

- [ ] Hành vi runtime đổi (mặc định, bảo mật, hiệu năng):
- [ ] Ảnh hưởng dữ liệu/migration:

Phụ thuộc mới: <tên · phiên bản · license — hoặc "không có">
Lý do sửa cấu hình cổng/migration: <hoặc "không có">
Backup trước migrate: <hoặc "không có migration">

## Rollback

Revert PR; khôi phục lockfile cũ (`git checkout <sha> -- package.json package-lock.json && npm ci`).

## Tài liệu

<ADR/RUNBOOK/README cập nhật — hoặc "không cần" + lý do>
