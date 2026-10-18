#!/usr/bin/env bash
# with-test-db.sh <lệnh…> — chạy lệnh với DATABASE_URL trỏ tới PostgreSQL THẬT.
#
# - Có sẵn DATABASE_URL (CI: service postgres) → chạy lệnh luôn.
# - Không có → dựng cụm tạm bằng initdb (cổng ngẫu nhiên, chỉ 127.0.0.1, auth scram-sha-256 có mật khẩu — giống
#   image postgres của CI, để lỗi xác thực lộ ra ở máy dev chứ không chỉ ở CI), chạy lệnh, rồi dừng + xoá.
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
PGDATA="$TMP/data"
PGPW="xc_test_$RANDOM$RANDOM"
printf '%s\n' "$PGPW" >"$TMP/pw"
if [ "$(id -u)" = "0" ]; then chown postgres "$TMP/pw"; fi

cleanup() {
  as_pg "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

as_pg "$PG_BIN/initdb" -D "$PGDATA" -U postgres --auth=scram-sha-256 --pwfile="$TMP/pw" -E UTF8 --locale=C.UTF-8 >/dev/null
# Cổng ngẫu nhiên, thử lại khi trùng.
PORT=""
for _ in 1 2 3 4 5; do
  cand="$(( (RANDOM % 20000) + 30000 ))"
  if as_pg "$PG_BIN/pg_ctl" -D "$PGDATA" -l "$TMP/pg.log" -w \
    -o "-p $cand -k '$TMP' -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off" \
    start >/dev/null 2>&1; then
    PORT="$cand"
    break
  fi
done
if [ -z "$PORT" ]; then
  echo "[with-test-db] ✗ không khởi động được Postgres tạm (xem $TMP/pg.log)" >&2
  cat "$TMP/pg.log" >&2 || true
  exit 1
fi
PGPASSWORD="$PGPW" as_pg env PGPASSWORD="$PGPW" "$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" -U postgres xc_test

export DATABASE_URL="postgres://postgres:$PGPW@127.0.0.1:$PORT/xc_test"
"$@"
