---
title: Danh sách tài khoản và dịch vụ (khung bàn giao)
updated: 2026-10-18
---

# Tài khoản và dịch vụ — khung bàn giao (PM-HANDOVER-004)

> **Không ghi bí mật.** Chuyển giao bằng cơ chế nền tảng (chuyển ownership tổ chức, kho bí mật dùng chung, mời thành viên), không qua chat/email; xoay mọi bí mật sau bàn giao ([../ops/RUNBOOK.md](../ops/RUNBOOK.md) mục 2–3). Các dòng dưới là khung; ô `<…>` do chủ dự án điền.

| Dịch vụ | Mục đích | Chủ hiện tại | Chủ mới | Ngày chuyển | Ngày xoay bí mật |
|---|---|---|---|---|---|
| GitHub repo `seeker19110/X-Company` | mã nguồn, CI, advisories | seeker19110 | `<điền>` | `<điền>` | `<điền>` |
| Máy chủ / nhà cung cấp hạ tầng | chạy ứng dụng (PM2) | `<điền>` | `<điền>` | `<điền>` | `<điền>` |
| PostgreSQL (role ứng dụng, role migration) | dữ liệu | `<điền>` | `<điền>` | `<điền>` | `<điền>` |
| Kho bí mật | `SESSION_SECRET`, `QR_SIGNING_KEYS`, mật khẩu DB | `<điền>` | `<điền>` | `<điền>` | `<điền>` |
| Tên miền và DNS | địa chỉ công khai | `<điền>` | `<điền>` | `<điền>` | — |
| SMTP giao dịch (khi có) | gửi email | `<điền>` | `<điền>` | `<điền>` | `<điền>` |
| Kho tệp S3-compatible (khi có) | tệp private | `<điền>` | `<điền>` | `<điền>` | `<điền>` |
| Sao lưu | DB và tệp | `<điền>` | `<điền>` | `<điền>` | `<điền>` |
