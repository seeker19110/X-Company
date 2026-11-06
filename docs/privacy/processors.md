# Bên xử lý dữ liệu (processors)

> Sinh từ `docs/compliance/vendors.yaml` bởi `node scripts/check-vendors.mjs --write` — không sửa tay; CI (`npm run -s check:vendors`) đỏ khi lệch.
> Thêm/đổi bên xử lý (sub-processor) = PR sửa sổ; mục "chờ chủ dự án" là việc người (DPA, vị trí, chứng chỉ).

| Bên xử lý | Dịch vụ | Dữ liệu chạm | Vị trí | DPA | Rủi ro | Trạng thái | Rà lần cuối |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GitHub (GitHub, Inc.) | lưu mã nguồn, CI (Actions), Dependabot, phát hành | mã nguồn, tên/email người đóng góp; không có dữ liệu nhân viên/khách của ứng dụng | Hoa Kỳ (GitHub, Inc.) | GitHub Data Protection Agreement — chờ chủ dự án xác nhận áp dụng cho tài khoản | thấp | đang dùng | 2026-11-06 |
| npm registry (GitHub, Inc.) | tải phụ thuộc lúc build theo package-lock.json (integrity sha512) | không có dữ liệu cá nhân | Hoa Kỳ | không cần (không xử lý dữ liệu cá nhân) | thấp | đang dùng | 2026-11-06 |
| Máy chủ ứng dụng + PostgreSQL (tự host, PM2) — nhà cung cấp chưa chọn | chạy ứng dụng web/PWA, worker, CSDL | toàn bộ dữ liệu trong docs/privacy/data-map.yaml | chờ chủ dự án chọn (ngoài Việt Nam → hồ sơ chuyển dữ liệu, CMP-VN-004) | chờ chủ dự án | cao | dự kiến | 2026-11-06 |
| Kho khoá KMS (OpenBao/Vault transit, tự host) | bọc/mở DEK cho mã hoá cột (lib/crypto/columns) | DEK RÕ khi bọc/mở (lib/crypto/kms.ts gửi plaintext tới encrypt/, nhận plaintext từ decrypt/) và DEK đã bọc; giữ KEK nên cùng bản dump CSDL là mở được mọi cột PII đã mã hoá | chờ chủ dự án (cùng hạ tầng ứng dụng hoặc KMS/HSM riêng) | không cần khi tự host; chờ chủ dự án nếu dùng KMS dịch vụ | cao | dự kiến | 2026-11-06 |
| Đích sao lưu off-site restic (S3/SFTP) — nhà cung cấp chưa chọn | lưu bản sao lưu CSDL đã mã hoá (scripts/backup-offsite.sh) | bản sao lưu đã mã hoá restic của toàn bộ CSDL | chờ chủ dự án (khác tài khoản/vùng với production, OPS-DR-003) | chờ chủ dự án | cao | dự kiến | 2026-11-06 |
| CA ACME (Let's Encrypt / ZeroSSL) qua Caddy | cấp và gia hạn chứng chỉ TLS tự động (ops/caddy/Caddyfile) | tên miền (công khai trong CT log) và ACME_EMAIL của người nhận cảnh báo hết hạn | Hoa Kỳ (ISRG/Let's Encrypt); ZeroSSL — pháp nhân chưa xác minh | chờ chủ dự án (điều khoản subscriber của CA; ACME_EMAIL nên là hộp thư chức năng, không phải cá nhân) | trung bình | dự kiến | 2026-11-06 |
| Kênh trực / ticket qua webhook (ALERT_WEBHOOK_URL, Alertmanager) — nhà cung cấp chưa chọn | gửi cảnh báo vận hành tới kênh có người trực (scripts/alert-channels.ts, ops/alertmanager/alertmanager.yml) | tên luật cảnh báo, mức, số đo vận hành; không có dữ liệu cá nhân (lib/ops/sinks.ts); URL webhook chứa khoá | chờ chủ dự án | chờ chủ dự án | thấp | dự kiến | 2026-11-06 |
