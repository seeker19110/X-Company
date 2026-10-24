#!/usr/bin/env bash
# Chạy test theo tệp (npm run -s test:file -- <tệp>…). `node --test` bỏ qua IM LẶNG tệp không tồn tại khi có tệp khác
# trong danh sách (exit 0) → Gate trỏ nhầm tên tệp vẫn "xanh" (T-084, lát 14). Kiểm từng đối số không phải cờ trước.
set -euo pipefail
# Chỉ kiểm đối số có dạng tệp test (đuôi .test.ts/.test.tsx/.test.mjs, không chứa ký tự glob): giá trị của cờ viết tách
# rời (`--test-name-pattern geo`) và glob có nháy để node tự xử lý.
for a in "$@"; do
  case "$a" in
    -* | *[*?[]*) ;;
    *.test.ts | *.test.tsx | *.test.mjs) [ -e "$a" ] || { echo "[test:file] ✗ không có tệp: $a" >&2; exit 2; } ;;
  esac
done
exec "$(dirname "$0")/with-test-db.sh" node --import tsx --test --test-concurrency=1 "$@"
