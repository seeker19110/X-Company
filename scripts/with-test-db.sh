#!/usr/bin/env bash
# with-test-db.sh <lệnh…> — chạy lệnh với DATABASE_URL trỏ tới PostgreSQL THẬT.
#
# - Có sẵn DATABASE_URL (CI: service postgres) → chạy lệnh luôn.
# - Không có → dựng cụm tạm bằng initdb (cổng ngẫu nhiên, chỉ 127.0.0.1, auth trust cục bộ), chạy lệnh, rồi dừng + xoá.
#   Chạy bằng root thì initdb/pg_ctl chạy dưới user `postgres` (initdb từ chối root).
# - Không tìm thấy Postgres → exit 1: test DB không bao giờ tự skip (bẫy XBOSS TRAPS #2).
set -euo pipefail

if [ -n "${DATABASE_URL:-}" ]; then
  exec "$@"
fi

PG_BIN=""
if command -v initdb >/dev/null 2>&1; then
  PG_BIN="$(dirname "$(command -v initdb)")"
else
  for d in /usr/lib/postgresql/*/bin /usr/local/pgsql/bin; do
    if [ -x "$d/initdb" ]; then PG_BIN="$d"; fi
  done
fi
if [ -z "$PG_BIN" ]; then
  echo "[with-test-db] ✗ không có DATABASE_URL và không tìm thấy initdb — cài PostgreSQL ≥ 16 hoặc đặt DATABASE_URL" >&2
  exit 1
fi

as_pg() {
  if [ "$(id -u)" = "0" ]; then runuser -u postgres -- "$@"; else "$@"; fi
}

TMP="$(mktemp -d)"
chmod 755 "$TMP"
if [ "$(id -u)" = "0" ]; then chown postgres "$TMP"; fi
PORT="$(( (RANDOM % 20000) + 30000 ))"
PGDATA="$TMP/data"

cleanup() {
  as_pg "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

as_pg "$PG_BIN/initdb" -D "$PGDATA" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
as_pg "$PG_BIN/pg_ctl" -D "$PGDATA" -l "$TMP/pg.log" -w \
  -o "-p $PORT -k $TMP -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off" \
  start >/dev/null
as_pg "$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" -U postgres xc_test

export DATABASE_URL="postgres://postgres@127.0.0.1:$PORT/xc_test"
"$@"
