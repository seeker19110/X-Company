#!/usr/bin/env bash
# coverage.sh — chạy toàn bộ test dưới c8; ngưỡng là BASELINE ở .c8rc.json (QA-COV-002, LOOP-CI-001):
# chỉ được nâng — scripts/check-coverage-baseline.mjs chặn PR hạ ngưỡng so với nhánh gốc.
# Báo cáo lcov ra coverage/ (gitignore) để CI lưu làm artifact (QA-COV-001); đỏ khi dưới ngưỡng.
set -euo pipefail
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
rm -rf coverage
scripts/with-test-db.sh npx --no-install c8 --config .c8rc.json --temp-directory "$TMP" \
  node --import tsx --test --test-concurrency=1 "tests/**/*.test.ts"
