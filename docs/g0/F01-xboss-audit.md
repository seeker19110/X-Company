# F01 — Kiểm tra XBOSS để tái sử dụng (G0)

> Ngày: 2026-10-18 · Repo: `seeker19110/xboss` commit `e64b77b` · Phương pháp: đọc mã nguồn, migrations, CI, tài liệu
> (chỉ đọc). Bằng chứng ghi dạng `file:dòng` trong repo XBOSS. Phân loại bằng chứng: **đo được** (đếm file/dòng, đọc
> cấu hình) — không có số liệu vận hành thật, nên mọi nhận xét về độ ổn định là **suy luận**.

## Tóm tắt

XBOSS là ứng dụng quản lý thi công MEP/ACMV cho một dự án cụ thể (README.md:3). Nền kỹ thuật chín (auth, RLS, audit,
phê duyệt, PWA, CI) nhưng **nghiệp vụ gần như toàn bộ thuộc xây dựng**; ~70% app/lib và đa số bảng không dùng được cho
X-Company. Kết luận: **không fork nguyên**, tạo repo mới cùng stack và chép có chọn lọc phần mức "Cao" (D-001).

## Stack (đo được)

| Thành phần | XBOSS | Bằng chứng |
|---|---|---|
| Framework | Next.js ^16.3.8, React ^19.2.7, TypeScript ^6.0.3, Tailwind 4 | package.json |
| Runtime | Node 24 | .nvmrc |
| DB | PostgreSQL, driver `pg` Pool, SQL thuần, không ORM | lib/db/index.ts; docs/adr/0001-postgres-raw-sql.md |
| Auth | Tự viết: scrypt, cookie phiên ký HMAC, TOTP, OIDC, CSRF, rate limit, SoD | lib/bao-mat/auth.ts:48-60, session-token.ts, totp.ts, oidc.ts, sod.ts |
| Test | `node:test` qua tsx, coverage `--experimental-test-coverage`, Playwright + axe | scripts/run-tests.mjs; ADR 0002 |
| CI | static · test (Postgres) · coverage · build · e2e (4 shard) + codeql, gitleaks, dependency-review | .github/workflows/ci.yml |
| Deploy | Tự host, PM2, build-swap, migrate bằng URL riêng | deploy.sh; ecosystem.config.js |
| Quy mô mã | ~172,6k LOC TS/TSX, 397 API route, 92 trang, 171 migration, 375 file test, coverage dòng 92,29% | wc; coverage-baseline.json (2026-09-22) |
| Giấy phép | Không có LICENSE; "mọi quyền thuộc chủ sở hữu repo" | README.md:147-150 |

## Mức tái sử dụng theo phân hệ

| Phân hệ X-Company | Mức | Lý do |
|---|---|---|
| Auth / phiên / 2FA / CSRF / rate limit | Cao | lib/bao-mat/* tổng quát |
| Lớp DB + migration runner + mẫu RLS | Cao | lib/db, migrations append-only |
| Audit log (trigger + chuỗi băm) | Cao | migrations/0049, lib/bao-mat/merkle-audit-ledger.ts |
| CI/CD, script check, deploy PM2 | Cao | .github/workflows, deploy.sh |
| Storage, thông báo/web push, xuất Excel/PDF | Cao | lib/nen/storage.ts, lib/van-hanh/push.ts |
| Phê duyệt nhiều bước | Trung bình–cao | migrations/0053; entity_type đang hard-code thi công |
| RBAC | Trung bình | Cơ chế CAN + override dùng được; vai trò cố định thi công, phạm vi chỉ org→dự án, **không có chi nhánh/phòng ban** |
| PWA (manifest, SW, hàng chờ IndexedDB) | Trung bình | Lưu offline **đang tạm khoá** (README.md:3), nợ IndexedDB nhiều tab (PROGRESS.md:33,62) |
| Dự án / công việc / tiến độ / nghiệm thu | Trung bình–thấp | CPM/EVM/gantt dùng được; mô hình task-lưới-tầng gắn thi công |
| Tài liệu / bình luận | Thấp–trung bình | Chỉ `task_comments` |
| Tổ chức (công ty/chi nhánh/phòng ban/nhân viên) | Thấp | `organizations` phẳng + `personnel` công trường |
| Chấm công (ca, vào/ra, QR, GPS, nghỉ, OT, sửa công, khoá kỳ) | Thấp | Chỉ bảng `attendance` theo ngày (migrations/0031_hr.sql:24-30) |
| Website công ty / CMS / liên hệ / tuyển dụng | Không có | — |
| i18n | Không có | chuỗi tiếng Việt viết cứng |

## Bẫy đã ghi ở XBOSS cần mang thành hàng rào ngay từ đầu (TRAPS.md)

1. Route ghi quên kiểm quyền / tin `projectId` từ client → X-Company: mọi route đi qua một hàm `requireActor` +
   kiểm phạm vi ở server, có test "bị cấm" cho từng route ghi.
2. Bất biến nghiệm thu/% tiến độ vỡ qua đường import → tiến độ tính từ dữ liệu nghiệm thu, không lưu số tổng có thể lệch.
3. Test gọi thẳng lib, không qua route → có test tích hợp đi qua handler HTTP.
4. Test DB tự SKIP mà vẫn xanh → test DB không bao giờ skip: thiếu Postgres = đỏ.

## Ảnh hưởng tới dự toán

Phần tái sử dụng cao là hạ tầng; các phân hệ P0 nặng nhất (tổ chức, chấm công, website/CMS) phải viết mới. Kế hoạch
gốc (mục 15) giả định "phần lõi XBOSS dùng lại được nhiều" — giả định này **không đúng** cho nghiệp vụ, nên tổng công
P0 không giảm đáng kể so với dự toán cơ sở. Cập nhật lịch/tổng công cuối tuần 2 theo kế hoạch gốc là việc của chủ dự án.
