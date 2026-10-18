---
title: Hạn gia hạn (khung bàn giao)
updated: 2026-10-18
---

# Phụ thuộc có hạn (PM-HANDOVER-009)

Nhắc trước hạn ≥ 30 ngày bằng lịch của chủ gia hạn; chứng chỉ TLS tự động gia hạn cần bằng chứng (`<điền>` khi có).

| Hạng mục | Chủ gia hạn | Hết hạn | Nhắc trước | Bằng chứng/ghi chú |
|---|---|---|---|---|
| `public/.well-known/security.txt` (`Expires`) | seeker19110 | 2027-04-18 | 30 ngày | `npm run -s check:repo-docs` đỏ khi quá hạn |
| Tên miền | `<điền>` | `<điền>` | 30 ngày | |
| Chứng chỉ TLS | `<điền>` | `<điền>` | 30 ngày | tự động gia hạn? `<điền>` |
| Gói máy chủ/hạ tầng | `<điền>` | `<điền>` | 30 ngày | |
| SMTP / dịch vụ ngoài (khi có) | `<điền>` | `<điền>` | 30 ngày | |
| Giấy phép/khoá (vd `GITLEAKS_LICENSE` nếu dùng repo tổ chức) | `<điền>` | `<điền>` | 30 ngày | |
| Chu kỳ hỗ trợ runtime: Node 24 (bảo trì từ 2026-10-20, EOL 2028-04-30 theo ADR-0001), PostgreSQL 17 (EOL 2029-11-08) | seeker19110 | 2028-04-30 | 90 ngày | endoflife.date |
