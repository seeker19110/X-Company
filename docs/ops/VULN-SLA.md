---
title: Chính sách xử lý lỗ hổng (SLA)
updated: 2026-10-18
status: đề xuất — chủ dự án chốt
---

# Xử lý lỗ hổng theo mức (OPS-MAINT-004)

## Quét hiện có
| Lớp | Công cụ | Nhịp |
|---|---|---|
| Phụ thuộc production | `npm audit --omit=dev --audit-level=moderate` (job `dep-audit`, `.github/workflows/dep-audit.yml`) | mỗi push/PR + lịch tuần (thứ Hai 02:17 UTC) |
| Cập nhật phụ thuộc | Dependabot (`.github/dependabot.yml`) | tuần |
| Bí mật | gitleaks toàn lịch sử (`.github/workflows/secret-scan.yml`) | mỗi push/PR |
| Image, SBOM | chưa có (không có container image; SBOM thuộc T-037) | — |

Phụ thuộc dev chỉ theo dõi qua Dependabot; ngoại lệ hiện có: braces (GHSA-vfj7-8cjw-p6xm) trong chuỗi `eslint-config-next` — D-008.

## SLA xử lý (kể từ khi phát hiện/được báo)
| Mức | Ví dụ | Đánh giá | Có bản vá/giảm thiểu | Ghi chú |
|---|---|---|---|---|
| Critical | thực thi mã từ xa, lộ dữ liệu không cần xác thực, lộ bí mật | ≤ 24 giờ | ≤ 7 ngày (giảm thiểu tạm ngay trong 24 giờ) | tuyên bố sự cố SEV1 nếu đã bị khai thác |
| High | leo thang quyền, IDOR, XSS lưu trữ | ≤ 3 ngày | ≤ 14 ngày | |
| Medium | DoS có điều kiện, lộ thông tin hạn chế | ≤ 7 ngày | ≤ 30 ngày | |
| Low | cần điều kiện hiếm | ≤ 14 ngày | ≤ 90 ngày hoặc đóng có lý do | |

Báo cáo bên ngoài: phản hồi ban đầu ≤ 14 ngày ([../../SECURITY.md](../../SECURITY.md)). Ngoại lệ (chấp nhận rủi ro có hạn) ghi `D-NNN` ở `docs/autopilot/DECISIONS.md` kèm hạn xem lại.

## Rà soát tháng
Mỗi tháng đếm số finding quá SLA (mục tiêu 0) và ghi vào PR/ghi chú `<chủ dự án điền: nơi ghi>`. Báo cáo tháng đầu: chưa có.
