# ADR-0001: Stack — Next.js + PostgreSQL SQL thuần, cùng nền XBOSS

- Trạng thái: Chấp nhận · Ngày: 2026-10-18 · Quyết định: D-001, D-002, D-003, D-004, D-005 (`docs/autopilot/DECISIONS.md`)

## Bối cảnh
Kế hoạch §11 ưu tiên mở rộng kiến trúc một ứng dụng chia module của XBOSS. Kiểm tra F01 (`docs/g0/F01-xboss-audit.md`)
cho thấy phần hạ tầng XBOSS dùng lại được, phần nghiệp vụ thì không.

## Quyết định
| Thành phần | Chọn | Phiên bản (registry/endoflife.date, 2026-10-18) |
|---|---|---|
| Runtime | Node.js | engines `>=22.12`; production Node 24 (Active LTS → Maintenance 2026-10-20, EOL 2028-04-30) |
| Web | Next.js App Router, React | next 16.4.2, react 19.3.1 (MIT) |
| Ngôn ngữ | TypeScript strict | 6.0.3 (typescript-eslint 8.71.2 đòi `<6.1.0`) |
| CSDL | PostgreSQL, driver `pg`, SQL thuần, migration đánh số append-only | pg 8.23.1; PostgreSQL 17 (EOL 2029-11-08), mã chỉ dùng tính năng có ở 16 |
| Xác thực đầu vào | zod | 4.6.7 |
| Mật khẩu | Argon2id `@node-rs/argon2` m=19456 KiB, t=2, p=1 (BE-AUTH-001) | 2.2.2 |
| Test | `node:test` qua tsx, coverage c8; E2E Playwright + @axe-core/playwright | tsx 4.23.15, c8 12.0.0, @playwright/test 1.64.1 |
| Lint/format | ESLint flat config + typescript-eslint, Prettier (`next lint` đã bỏ ở Next 16) | eslint 10.13.0, prettier 3.9.10 |
| Dịch vụ ngoài | Adapter tự host: tệp trên đĩa, email vào outbox, Web Push VAPID (D-005) | — |

Một ứng dụng: `app/(public)` cho website, `app/app` cho khu nội bộ/PWA; nghiệp vụ ở `lib/<miền>`; route chỉ gọi lib qua
lớp kiểm quyền (D-004).

## Hệ quả
- Chép có chọn lọc từ XBOSS (cùng chủ repo): mẫu migration runner, phiên ký HMAC, CSRF, audit chuỗi băm — mỗi lần chép
  ghi nguồn `xboss@e64b77b:<file>` trong commit, có test riêng ở repo này.
- Test DB không bao giờ skip: thiếu `DATABASE_URL` là đỏ (bẫy TRAPS #2 của XBOSS).
- TypeScript 7 (trình biên dịch native) chưa dùng tới khi typescript-eslint hỗ trợ.

## Phương án đã loại
Fork nguyên XBOSS (mang ~173k LOC thi công, vai trò cố định, nợ offline); ORM (thêm lớp trừu tượng, khác XBOSS); hai
ứng dụng riêng (§11 chỉ tách khi chứng minh cần).
