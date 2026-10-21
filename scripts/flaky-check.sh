#!/usr/bin/env bash
# flaky-check.sh <số lượt> <tệp test…> — chạy lặp test nhạy thời gian dưới tải CPU (AUD-TEST-001).
#
# - Dựng tải: mỗi lõi một tiến trình bận (`FLAKY_LOAD=0` để tắt), dừng khi script kết thúc.
# - Một cụm Postgres tạm cho cả loạt (qua with-test-db.sh), mỗi lượt là một `node --test` mới.
# - Đỏ khi có dù chỉ một lượt đỏ (flaky là lỗi, không phải "thường xanh"); in số lượt đỏ và log lượt đỏ đầu tiên.
set -euo pipefail

if [ "$#" -lt 2 ] || ! [[ "$1" =~ ^[1-9][0-9]*$ ]]; then
  echo "dùng: scripts/flaky-check.sh <số lượt ≥ 1> <tệp test…>" >&2
  exit 2
fi

if [ -z "${FLAKY_INNER:-}" ]; then
  exec env FLAKY_INNER=1 "$(dirname "$0")/with-test-db.sh" "$0" "$@"
fi

RUNS="$1"
shift
LOG="$(mktemp -d)"
PIDS=()
cleanup() {
  for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null || true; done
  rm -rf "$LOG"
}
trap cleanup EXIT

if [ "${FLAKY_LOAD:-1}" != "0" ]; then
  for _ in $(seq "$(nproc)"); do
    node -e 'for(;;){}' &
    PIDS+=("$!")
  done
fi

FAILS=0
FIRST=""
for i in $(seq "$RUNS"); do
  if node --import tsx --test --test-concurrency=1 "$@" >"$LOG/run-$i.log" 2>&1; then
    echo "[flaky-check] lượt $i/$RUNS: xanh"
  else
    FAILS=$((FAILS + 1))
    echo "[flaky-check] lượt $i/$RUNS: ĐỎ"
    if [ -z "$FIRST" ]; then
      FIRST="$i"
      cp "$LOG/run-$i.log" "$LOG/first-fail.log"
    fi
  fi
done

load="có tải $(nproc) lõi"
[ "${FLAKY_LOAD:-1}" = "0" ] && load="không tải"
if [ "$FAILS" -gt 0 ]; then
  echo "[flaky-check] ✗ $FAILS/$RUNS lượt đỏ ($load) — log lượt $FIRST:" >&2
  tail -n 60 "$LOG/first-fail.log" >&2
  exit 1
fi
echo "[flaky-check] ✓ $RUNS/$RUNS lượt xanh ($load): $*"
