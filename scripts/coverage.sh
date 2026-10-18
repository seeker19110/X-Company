#!/usr/bin/env bash
# coverage.sh — chạy toàn bộ test dưới c8 với ngưỡng (sàn Gate quy mô M, LOOP-HARNESS-023).
# Artefact ra thư mục tạm, không ghi vào repo; đỏ khi dưới ngưỡng.
set -euo pipefail
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
exec scripts/with-test-db.sh npx --no-install c8 \
  --temp-directory "$OUT/tmp" --report-dir "$OUT/report" \
  --include 'lib/**' --exclude 'tests/**' \
  --check-coverage --lines 85 --branches 80 --functions 85 \
  --reporter text-summary \
  node --import tsx --test --test-concurrency=1 "tests/**/*.test.ts"
