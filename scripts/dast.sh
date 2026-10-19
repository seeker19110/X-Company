#!/usr/bin/env bash
# dast.sh — DAST (SEC-WEB-001, SEC-WEB-004): OWASP ZAP baseline (thụ động) + quét chủ động giới hạn thời gian trên bản build
# production (`next start`) với DB seed như e2e/lighthouse. Gọi qua `npm run dast` (bọc bởi with-test-db.sh); cần Docker.
# Cổng: scripts/zap-gate.mjs — đỏ khi còn cảnh báo mức Medium trở lên ngoài security/zap/allowlist.json.
set -euo pipefail
: "${DATABASE_URL:?cần DATABASE_URL}"
# ZAP 2.17.0 (index đa kiến trúc, cùng digest với hotel-manager, tra ghcr.io 2026-10-18).
ZAP_IMAGE="${ZAP_IMAGE:-ghcr.io/zaproxy/zaproxy:2.17.0@sha256:5ccfff9a411743ab2615136a2edd7416bec9ce41572fa94e935df38c14adb2b6}"
PORT="${DAST_PORT:-3100}"
OUT="${DAST_OUT:-zap-out}"
export MIGRATE_DATABASE_URL="$DATABASE_URL"
export NEXT_TELEMETRY_DISABLED=1
npx --no-install tsx scripts/migrate.ts
npx --no-install tsx scripts/seed-e2e.ts
# Ứng dụng chạy bằng role đăng nhập riêng (không superuser) như production.
DATABASE_URL="$(npx --no-install tsx scripts/e2e-role.ts)"
export DATABASE_URL
export SITE_COMPANY_ID
SITE_COMPANY_ID="$(node -e "process.stdout.write(require('./e2e/.seed.json').companyId)")"
export APP_ORIGIN="http://localhost:$PORT"
export SESSION_SECRET="${SESSION_SECRET:-dast-session-secret-0123456789abcdef-xyz}"
export QR_SIGNING_KEYS="${QR_SIGNING_KEYS:-k1:dast-qr-key-0123456789abcdef0123456789abcdef}"
export DATA_ENCRYPTION_KEYS="${DATA_ENCRYPTION_KEYS:-dast1:$(openssl rand -base64 32)}"
export DATA_INDEX_KEY="${DATA_INDEX_KEY:-$(openssl rand -base64 32)}"
FILE_STORAGE_DIR="$(mktemp -d)"
export FILE_STORAGE_DIR
if [ "${DAST_SKIP_BUILD:-0}" != "1" ]; then npm run -s build >/dev/null; fi
LOG="$(mktemp)"
# setsid: app chạy trong nhóm tiến trình riêng để dừng được cả next-server con (kill theo nhóm), không để sót tiến trình.
setsid npx --no-install next start -H 127.0.0.1 -p "$PORT" >"$LOG" 2>&1 &
APP_PID=$!
trap 'kill -TERM -- "-$APP_PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 120); do
  if curl -fsS "http://127.0.0.1:$PORT/api/healthz" >/dev/null 2>&1; then break; fi
  if ! kill -0 "$APP_PID" 2>/dev/null; then echo "[dast] ✗ app dừng sớm" >&2; tail -n 50 "$LOG" >&2; exit 1; fi
  sleep 2
done
curl -fsS "http://127.0.0.1:$PORT/api/healthz" >/dev/null || { echo "[dast] ✗ app không lên trong 240 giây" >&2; tail -n 50 "$LOG" >&2; exit 1; }
mkdir -p "$OUT" && chmod 777 "$OUT"
OUT="$(cd "$OUT" && pwd)"  # tuyệt đối: docker -v cần đường dẫn đầy đủ
# -I: không thoát khác 0 vì cảnh báo — cổng là zap-gate.mjs (đọc JSON), để allowlist có lý do áp dụng được.
docker run --rm --network host -v "$OUT:/zap/wrk:rw" "$ZAP_IMAGE" \
  zap-baseline.py -t "http://127.0.0.1:$PORT" -m 2 -I -J baseline.json -r baseline.html
docker run --rm --network host -v "$OUT:/zap/wrk:rw" "$ZAP_IMAGE" \
  zap-full-scan.py -t "http://127.0.0.1:$PORT" -m 2 -T 12 -I -J active.json -r active.html
node scripts/zap-gate.mjs "$OUT/baseline.json" "$OUT/active.json"
