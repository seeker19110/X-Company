# Changelog

Mọi thay đổi đáng chú ý của dự án ghi ở đây. Định dạng theo [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
phiên bản theo [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html). Chưa có bản phát hành nào.

## [0.2.0](https://github.com/seeker19110/X-Company/compare/v0.1.0...v0.2.0) (2026-10-21)


### Features

* **api:** OpenAPI 3.1 sinh từ zod, GO-NO-GO, sửa lệnh kiểm blueprint ([#17](https://github.com/seeker19110/X-Company/issues/17)) ([89199d9](https://github.com/seeker19110/X-Company/commit/89199d9d79962a212d43023e7cd6520a6e7b9d16))
* đăng nhập/phiên, website + CMS + liên hệ, chấm công tới khoá kỳ (T-007…T-014) ([#8](https://github.com/seeker19110/X-Company/issues/8)) ([2831329](https://github.com/seeker19110/X-Company/commit/2831329d63e67105db00f73e5b4453966399fe32))
* **hardening:** lát 8 — env, log, idempotency, worker, CI chính sách ([#11](https://github.com/seeker19110/X-Company/issues/11)) ([c533be5](https://github.com/seeker19110/X-Company/commit/c533be5be2d7831fa4fdb150fc0917d5e36553d7))
* kế hoạch G0–G4 và lát 1 nền (Next.js, Postgres thật, CI) ([#4](https://github.com/seeker19110/X-Company/issues/4)) ([8621c42](https://github.com/seeker19110/X-Company/commit/8621c42b972cfad715a76b70e03accca7b0b357c))
* **ops:** lát 9 — luật VN, sao lưu, cảnh báo, DAST, mã hoá, đo tải ([#22](https://github.com/seeker19110/X-Company/issues/22)) ([26704d5](https://github.com/seeker19110/X-Company/commit/26704d56b6ad04b559db4ab37ac2b70527dfe5e0))
* **ops:** Prometheus + Alertmanager thật cục bộ, unit test rule (T-054) ([#32](https://github.com/seeker19110/X-Company/issues/32)) ([5f01b0f](https://github.com/seeker19110/X-Company/commit/5f01b0f252fe14639f3e2966a93c3ff1bf781b7a))
* **ops:** staging có TLS cục bộ — Caddy + ZAP qua https (T-055) ([#33](https://github.com/seeker19110/X-Company/issues/33)) ([6b959de](https://github.com/seeker19110/X-Company/commit/6b959de9e37ac6c6492ab20f3c19e5dbc7344996))
* **perf:** RUM web-vitals tự host: beacon, route, p75 (T-056) ([#35](https://github.com/seeker19110/X-Company/issues/35)) ([cab8824](https://github.com/seeker19110/X-Company/commit/cab88245f9fecec7b06bd35e3cae7f75a4ac2bf6))


### Bug Fixes

* **attendance:** ràng buộc đơn nghỉ/sửa công, hộp duyệt lọc theo lô ([#44](https://github.com/seeker19110/X-Company/issues/44)) ([cc4f2ce](https://github.com/seeker19110/X-Company/commit/cc4f2ce095d2f89e9a3021dd941d44aab8ec5f2b))
* **ci:** Release PR của release-please không còn bị cổng chặn ([#30](https://github.com/seeker19110/X-Company/issues/30)) ([235954f](https://github.com/seeker19110/X-Company/commit/235954ff88e46e0c63dacf83306ee34db3288a4f))
* **deps:** giữ typescript 6.0.3 — TS 7 vỡ peer của typescript-eslint ([#12](https://github.com/seeker19110/X-Company/issues/12)) ([4b1cefa](https://github.com/seeker19110/X-Company/commit/4b1cefaa3e97711cd00563df907fdeb1cdaafa15))
* **gate:** báo cáo drill/probe ra thư mục tạm, không ghi vào repo ([#37](https://github.com/seeker19110/X-Company/issues/37)) ([95230fd](https://github.com/seeker19110/X-Company/commit/95230fd3ea473aaea6825e9b22c09b6e02a51c49))
* **http:** đọc body có trần, TRUST_PROXY bắt buộc ở production ([#41](https://github.com/seeker19110/X-Company/issues/41)) ([eb14c29](https://github.com/seeker19110/X-Company/commit/eb14c293e864236acd784d948cac9d74affb2693))
* **privacy:** PII không lọt audit, ẩn danh cả app_user (DATA-001/002) ([#40](https://github.com/seeker19110/X-Company/issues/40)) ([063b4a7](https://github.com/seeker19110/X-Company/commit/063b4a707178e9eaa13bf368479420a76bad1397))

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
