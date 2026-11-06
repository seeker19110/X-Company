# Bên xử lý dữ liệu (processors)

> Sinh từ `docs/compliance/vendors.yaml` bởi `node scripts/check-vendors.mjs --write` — không sửa tay; CI (`npm run -s check:vendors`) đỏ khi lệch.
> Thêm/đổi bên xử lý (sub-processor) = PR sửa sổ; mục "chờ chủ dự án" là việc người (DPA, vị trí, chứng chỉ).

| Bên xử lý | Dịch vụ | Dữ liệu chạm | Vị trí | DPA | Rủi ro | Trạng thái | Rà lần cuối |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GitHub (GitHub, Inc.) | lưu mã nguồn, CI (Actions), Dependabot, phát hành | mã nguồn, tên/email người đóng góp; không có dữ liệu nhân viên/khách của ứng dụng | Hoa Kỳ (GitHub, Inc.) | GitHub Data Protection Agreement — chờ chủ dự án xác nhận áp dụng cho tài khoản | thấp | đang dùng | 2026-11-06 |
| npm registry (GitHub, Inc.) | tải phụ thuộc lúc build theo package-lock.json (integrity sha512) | không có dữ liệu cá nhân | Hoa Kỳ | không cần (không xử lý dữ liệu cá nhân) | thấp | đang dùng | 2026-11-06 |
| Máy chủ ứng dụng + PostgreSQL (tự host, PM2) — nhà cung cấp chưa chọn | chạy ứng dụng web/PWA, worker, CSDL | toàn bộ dữ liệu trong docs/privacy/data-map.yaml | chờ chủ dự án chọn (ngoài Việt Nam → hồ sơ chuyển dữ liệu, CMP-VN-004) | chờ chủ dự án | cao | dự kiến | 2026-11-06 |
| Kho khoá KMS (OpenBao/Vault transit, tự host) | bọc/mở DEK cho mã hoá cột (lib/crypto/columns) | chỉ DEK đã bọc và ngữ cảnh; không có dữ liệu cá nhân rõ | chờ chủ dự án (cùng hạ tầng ứng dụng hoặc KMS/HSM riêng) | không cần khi tự host; chờ chủ dự án nếu dùng KMS dịch vụ | trung bình | dự kiến | 2026-11-06 |
| Đích sao lưu off-site restic (S3/SFTP) — nhà cung cấp chưa chọn | lưu bản sao lưu CSDL đã mã hoá (scripts/backup-offsite.sh) | bản sao lưu đã mã hoá restic của toàn bộ CSDL | chờ chủ dự án (khác tài khoản/vùng với production, OPS-DR-003) | chờ chủ dự án | cao | dự kiến | 2026-11-06 |
