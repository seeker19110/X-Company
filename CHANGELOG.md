# Changelog

Mọi thay đổi đáng chú ý của dự án ghi ở đây. Định dạng theo [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
phiên bản theo [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html). Chưa có bản phát hành nào.

## [Unreleased]

### Added

Nền (F-000):

- Next.js 16 + TypeScript strict, ESLint, Prettier, `node:test`, CI (quality, protection-guard, gitleaks, dep-audit).
- Test trên PostgreSQL thật (`scripts/with-test-db.sh`), migration append-only có checksum, role ứng dụng không superuser/BYPASSRLS.

Tính năng P0 (trạng thái lúc 2026-10-18; chi tiết ở [PROJECT.md](PROJECT.md) mục 3 và [PLAN](docs/autopilot/PLAN.md)):

- F-001 Danh tính, tổ chức, phân quyền theo vai trò và phạm vi — mới có lược đồ tổ chức; `can()` và đăng nhập chưa xong.
- F-002 Nhật ký kiểm toán chỉ thêm, chuỗi băm, `npm run audit:verify` — đã có.
- F-003 Website công ty + CMS + liên hệ & tuyển dụng — chưa.
- F-004 Chấm công: ca, sự kiện chống trùng, QR động, ca qua đêm — chưa.
- F-005 Nghỉ phép, OT, sửa công có duyệt — chưa.
- F-006 Kỳ công: khoá, xuất có phiên bản — chưa.
- F-007 Dự án, hạng mục, công việc, kế hoạch tuần — chưa.
- F-008 Nghiệm thu, baseline trọng số, 3 con số tiến độ — chưa.
- F-009 Giờ dự án và đối chiếu với công — chưa.
- F-010 Tệp private có phiên bản, bình luận, thông báo — chưa.
- F-011 PWA: cài đặt, Hôm nay, hàng chờ ngoại tuyến — chưa.
- F-012 Dashboard ngoại lệ — chưa.

Tài liệu dự án: README, LICENSE (độc quyền), CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, SUPPORT, `security.txt`, mẫu issue,
CODEOWNERS, threat model, sổ rủi ro, runbook, kiểm kê dữ liệu cá nhân, các script `check:repo-docs` và `check:docs`.

[Unreleased]: https://github.com/seeker19110/X-Company/commits/main
