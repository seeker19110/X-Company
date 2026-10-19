#!/usr/bin/env bash
# lighthouse.sh — Lighthouse CI (FE-PERF-002, PRF-WEB-005) trên bản build production (`next start`) với DB seed như e2e.
# Gọi qua `npm run lighthouse` (bọc bởi with-test-db.sh). Cấu hình + ngưỡng: lighthouserc.json.
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
export SESSION_SECRET="${SESSION_SECRET:-lh-session-secret-0123456789abcdef-xyz}"
export QR_SIGNING_KEYS="${QR_SIGNING_KEYS:-k1:lh-qr-key-0123456789abcdef0123456789abcdef}"
# Khoá mã hoá dữ liệu lúc lưu (T-048): bắt buộc ở production → sinh ngẫu nhiên mỗi lần chạy.
export DATA_ENCRYPTION_KEYS="${DATA_ENCRYPTION_KEYS:-lh1:$(openssl rand -base64 32)}"
export DATA_INDEX_KEY="${DATA_INDEX_KEY:-$(openssl rand -base64 32)}"
export TRUST_PROXY="${TRUST_PROXY:-0}" # production bắt buộc khai tường minh; harness không có proxy
FILE_STORAGE_DIR="$(mktemp -d)"
export FILE_STORAGE_DIR
if [ "${LH_SKIP_BUILD:-0}" != "1" ]; then npm run -s build >/dev/null; fi
# Chromium: dùng CHROME_PATH nếu có, không thì của Playwright (đã cài trong CI).
if [ -z "${CHROME_PATH:-}" ]; then
  CHROME_PATH="$(node -e "console.log(require('@playwright/test').chromium.executablePath())")"
  export CHROME_PATH
fi
# Phiên bản ghim; đổi cùng lúc với job `lighthouse` trong .github/workflows/ci.yml.
exec npx --yes @lhci/cli@0.15.1 autorun --config=lighthouserc.json "$@"
