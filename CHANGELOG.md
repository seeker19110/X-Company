# Changelog

Mọi thay đổi đáng chú ý của dự án ghi ở đây. Định dạng theo [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
phiên bản theo [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html). Chưa có bản phát hành nào.

## [0.3.0](https://github.com/seeker19110/X-Company/compare/v0.2.1...v0.3.0) (2026-10-24)


### Features

* **identity:** lát 15 — TOTP hai bước, chặn bỏ sysadmin cuối ([#74](https://github.com/seeker19110/X-Company/issues/74)) ([b35d051](https://github.com/seeker19110/X-Company/commit/b35d0511a10dc284db71de5c416efec01b1c0364))
* lát 14 — form ứng tuyển, thông báo trong ứng dụng, sửa audit 🟢 ([#73](https://github.com/seeker19110/X-Company/issues/73)) ([33e7e1a](https://github.com/seeker19110/X-Company/commit/33e7e1a6683fabe7a05ac153a786a6150d4b6cec))
* **ops:** lát 17 — autovacuum + cảnh báo XID, bộ tải chỉ loopback ([#76](https://github.com/seeker19110/X-Company/issues/76)) ([3486732](https://github.com/seeker19110/X-Company/commit/34867327715ecb43b9a700e75378a72ca4181ba1))


### Bug Fixes

* **docs:** sửa ghi chú Kiểm sai dạng, chặn bằng check:docs ([#77](https://github.com/seeker19110/X-Company/issues/77)) ([6fe147c](https://github.com/seeker19110/X-Company/commit/6fe147c109d8b23a4efb960bfabeaf35767911ad))
* lát 12–13 — quyền cấp vai trò, xoá GPS, a11y, harden ([#68](https://github.com/seeker19110/X-Company/issues/68)) ([5d5f480](https://github.com/seeker19110/X-Company/commit/5d5f48057fefd31e2eb107c435e30548b0f0ab3a))
* lát 16 — dọn MFA, DSAR thông báo, RUM, quyền thông báo ([#75](https://github.com/seeker19110/X-Company/issues/75)) ([1d2bbf4](https://github.com/seeker19110/X-Company/commit/1d2bbf4b260fc2bf7fafce062c18ccb1101ccf5b))

## [0.2.1](https://github.com/seeker19110/X-Company/compare/v0.2.0...v0.2.1) (2026-10-21)


### Bug Fixes

* **app:** focus sau thao tác vào khối của mục, không vào nút ([#53](https://github.com/seeker19110/X-Company/issues/53)) ([2a1ec8c](https://github.com/seeker19110/X-Company/commit/2a1ec8cce5439f6c659a4be4e864b04e04f7f741))
* **app:** log lỗi sync, focus không bị che, thông báo trong tầm nhìn ([#50](https://github.com/seeker19110/X-Company/issues/50)) ([66880aa](https://github.com/seeker19110/X-Company/commit/66880aa46698bbc3e4efdaac0bfa8c2e8400bb14))
* **attendance:** luật khoá và giới hạn tần suất cho ghi chấm công ([#62](https://github.com/seeker19110/X-Company/issues/62)) ([0be875d](https://github.com/seeker19110/X-Company/commit/0be875d2e37b62827098e384d7a6b706eb639f7b))
* chặn sửa tiến độ việc đã xong, chốt kỳ ghi theo lô, dọn mã ([#56](https://github.com/seeker19110/X-Company/issues/56)) ([cbf0b4d](https://github.com/seeker19110/X-Company/commit/cbf0b4dab9762f47d891357182bea9dfb76b881c))
* **e2e:** chặn service worker cho test mock bằng page.route ([#59](https://github.com/seeker19110/X-Company/issues/59)) ([9f5a35a](https://github.com/seeker19110/X-Company/commit/9f5a35ae44e4a7341aaa119844383644af78b76e))
* form liên hệ đọc lỗi máy chủ; múi giờ nghiệp vụ một nguồn ([#63](https://github.com/seeker19110/X-Company/issues/63)) ([219f931](https://github.com/seeker19110/X-Company/commit/219f9317731a7695c44cb6f28de2f7b5c3eb6aa4))
* quyền đơn của mình, chặn dò mật khẩu rải, retention theo lô ([#64](https://github.com/seeker19110/X-Company/issues/64)) ([852792f](https://github.com/seeker19110/X-Company/commit/852792f21e0ba67357142fba2d7968277a717e03))
* **security:** APP_ORIGIN https ở production; hộp duyệt OT theo ngày ([#49](https://github.com/seeker19110/X-Company/issues/49)) ([d964f11](https://github.com/seeker19110/X-Company/commit/d964f11066c6691087ecc4e7ebcf2d96132a02c5))

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
