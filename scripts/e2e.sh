#!/usr/bin/env bash
# e2e.sh — chạy Playwright trên Postgres THẬT + bản build production (QA-E2E-023).
# Gọi qua `npm run e2e` (bọc bởi with-test-db.sh: không có DATABASE_URL thì dựng cụm tạm).
set -euo pipefail
: "${DATABASE_URL:?cần DATABASE_URL}"
export MIGRATE_DATABASE_URL="$DATABASE_URL"
export NEXT_TELEMETRY_DISABLED=1
npx --no-install tsx scripts/migrate.ts
npx --no-install tsx scripts/seed-e2e.ts
# Ứng dụng chạy bằng role đăng nhập riêng (không superuser) như production.
DATABASE_URL="$(npx --no-install tsx scripts/e2e-role.ts)"
export DATABASE_URL
export SITE_COMPANY_ID
SITE_COMPANY_ID="$(node -e "process.stdout.write(require('./e2e/.seed.json').companyId)")"
export APP_ORIGIN="http://localhost:3100"
export SESSION_SECRET="${SESSION_SECRET:-e2e-session-secret-0123456789abcdef-xyz}"
export QR_SIGNING_KEYS="${QR_SIGNING_KEYS:-k1:e2e-qr-key-0123456789abcdef0123456789abcdef}"
# Khoá mã hoá dữ liệu lúc lưu (T-048): bắt buộc ở production → sinh ngẫu nhiên mỗi lần chạy (CSDL e2e là tạm; không literal khoá).
export DATA_ENCRYPTION_KEYS="${DATA_ENCRYPTION_KEYS:-e2e1:$(openssl rand -base64 32)}"
export DATA_INDEX_KEY="${DATA_INDEX_KEY:-$(openssl rand -base64 32)}"
export FILE_STORAGE_DIR="$(mktemp -d)"
if [ "${E2E_SKIP_BUILD:-0}" != "1" ]; then npm run -s build >/dev/null; fi
exec npx --no-install playwright test "$@"
