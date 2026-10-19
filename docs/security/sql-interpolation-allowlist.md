---
title: Allowlist nội suy trong chuỗi SQL
updated: 2026-10-18
status: hiệu lực
---

# Allowlist nội suy `${…}` trong chuỗi SQL (SEC-WEB-001, BASE-SEC-007)

Luật: mọi giá trị đến từ đầu vào đi qua tham số `$n` của `pg`. Nội suy `${…}` trong chuỗi SQL chỉ được dùng cho **hằng nội bộ**
(tên bảng từ tập đóng, mảnh `FOR UPDATE`/`AND … = $n` cố định, số thứ tự tham số). Mỗi chỗ có comment `// sql-interp-allow: <lý do>`
ngay trên chuỗi và tệp được liệt kê ở đây; `npm run -s check:sql-interpolation` (trong `check:supply-chain`) đỏ khi có chỗ mới
thiếu comment hoặc tệp chưa có trong bảng. Thêm chỗ mới = thêm dòng vào bảng này trong cùng PR và nêu lý do ở mô tả PR.

| Tệp | Nội suy | Vì sao an toàn |
| --- | --- | --- |
| `lib/attendance/period.ts` | `lock ? "FOR UPDATE" : ""`; `empFilter`/`employeeId ? "AND … = $4" : ""` | hằng cố định; `employeeId` đi qua `$4` |
| `lib/audit/index.ts` | `hasKey ? "WHERE chain_key = $1" : ""` | hằng cố định; `chainKey` đi qua `$1` |
| `lib/authz/grants.ts` | `table` | lấy từ `SCOPE_TABLE` (`branch`/`department`) |
| `lib/cms/index.ts` | `VISIBLE_SQL`, `where` (` AND p.type = $${n}`) | hằng module; chỉ chèn số thứ tự tham số |
| `lib/inquiry/index.ts` | `table` | kiểu hợp nhất `"inquiry" \| "job_application"` |
| `lib/worker/retention.ts` | `table`, `sets`, `where`, `old` | hằng của các lời gọi nội bộ; `before`/giá trị qua `$n` |
| `lib/privacy/index.ts` | `COLS`, `TABLE_OF[type]` | hằng danh sách cột của `data_subject_request`; bảng chủ thể theo enum SubjectType; mọi giá trị qua `$n` |
| `lib/crypto/rotate.ts` | `table`, `column`, `enc`, `bidx` | tên bảng/cột lấy từ sổ `ENCRYPTED_COLUMNS` (hằng trong mã, tập đóng); id dòng, số lô và bản mã luôn qua `$n` |

Kiểm: `npm run -s check:sql-interpolation`. CodeQL (`js/sql-injection`, suite `security-extended`) chạy ở `.github/workflows/codeql.yml`.
