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
| Phụ thuộc production + dev | osv-scanner trên `package-lock.json` (PR: bước trong job `gate` của `ci.yml`, chặn qua `quality`; push `main` và lịch: `.github/workflows/osv-scanner.yml`; ngoại lệ có hạn ở `osv-scanner.toml`, hạn kiểm bởi `scripts/check-osv-exceptions.mjs`) | mỗi push/PR + lịch tuần (thứ Hai 02:37 UTC) |
| Mã nguồn (SAST) | CodeQL javascript-typescript, `security-extended` (`.github/workflows/codeql.yml`) | mỗi PR + lịch tuần (thứ Ba) |
| Bí mật | gitleaks trên push/PR (`secret-scan.yml`) + toàn lịch sử (job `gitleaks-history`, `maintenance.yml`) | mỗi push/PR; lịch tuần |
| License | `scripts/check-licenses.mjs` + `license-policy.yaml` (job `supply-chain`, `ci.yml`) | mỗi push/PR |
| SBOM | CycloneDX `npm sbom --omit dev` → artifact CI `sbom` (90 ngày), kiểm license ≥ 99% | mỗi push/PR |
| EOL runtime/CSDL | `scripts/eol-check.mjs --strict` (job `eol-check`, `maintenance.yml`): đỏ khi đã EOL hoặc còn < 90 ngày | lịch tuần |
| Image | không có container image của dự án; khi có: thêm quét image (Trivy/Grype) vào lịch tuần | — |

Ngoại lệ hiện có: braces (GHSA-vfj7-8cjw-p6xm), phụ thuộc dev trong chuỗi `eslint-config-next` — D-008, hạn xem lại 2027-01-18 ở `osv-scanner.toml`; `dep-audit` giữ `--omit=dev` (phần dev do osv-scanner phủ).

## SLA xử lý (kể từ khi phát hiện/được báo)
| Mức | Ví dụ | Đánh giá | Có bản vá/giảm thiểu | Ghi chú |
|---|---|---|---|---|
| Critical | thực thi mã từ xa, lộ dữ liệu không cần xác thực, lộ bí mật | ≤ 24 giờ | ≤ 7 ngày (giảm thiểu tạm ngay trong 24 giờ) | tuyên bố sự cố SEV1 nếu đã bị khai thác |
| High | leo thang quyền, IDOR, XSS lưu trữ | ≤ 3 ngày | ≤ 14 ngày | |
| Medium | DoS có điều kiện, lộ thông tin hạn chế | ≤ 7 ngày | ≤ 30 ngày | |
| Low | cần điều kiện hiếm | ≤ 14 ngày | ≤ 90 ngày hoặc đóng có lý do | |

Báo cáo bên ngoài: phản hồi ban đầu ≤ 14 ngày ([../../SECURITY.md](../../SECURITY.md)). Ngoại lệ (chấp nhận rủi ro có hạn) ghi `D-NNN` ở `docs/autopilot/DECISIONS.md` kèm hạn xem lại.

## Rà soát tháng
Mỗi tháng đếm số finding quá SLA (mục tiêu 0) và ghi vào PR/ghi chú `<chủ dự án điền: nơi ghi>`. Báo cáo tháng là việc của người (đếm từ alert CodeQL, osv-scanner, gitleaks, Dependabot). Báo cáo tháng đầu: chưa có.
