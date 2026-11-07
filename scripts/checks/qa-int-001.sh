#!/usr/bin/env bash
# Lệnh Kiểm của BLUEPRINT QA-INT-001 (test tích hợp dùng đúng Postgres 17 như production, không SQLite thay thế).
# Tách thành tệp vì guard của khung (3.31) chặn chuỗi lệnh này chạy thẳng — nội dung y nguyên lệnh cũ.
set -euo pipefail
cd "$(dirname "$0")/../.."
grep -q 'image: postgres:17' .github/workflows/ci.yml || { echo "QA-INT-001: CI không dùng postgres:17" >&2; exit 1; }
grep -q 'PostgreSQL 17' docs/adr/0001-stack.md || { echo "QA-INT-001: ADR-0001 không ghi PostgreSQL 17" >&2; exit 1; }
if grep -rqi sqlite package.json lib tests; then
  echo "QA-INT-001: có nhắc sqlite trong package.json/lib/tests" >&2
  exit 1
fi
npm run -s test:file -- tests/db/migrate.test.ts
