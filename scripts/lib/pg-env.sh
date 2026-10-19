#!/usr/bin/env bash
# pg-env.sh — dùng chung cho backup.sh / restore-drill.sh (source, không chạy trực tiếp).
# Tách DATABASE_URL thành biến libpq (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE, PGSSLMODE) để KHÔNG đưa URL có
# mật khẩu vào argv của tiến trình con (ps) và không bao giờ in nó ra log.

# xc_pg_env <url>: export biến libpq; trả 1 nếu URL không phải postgres(ql)://.
xc_pg_env() {
  local url="$1"
  local re='^postgres(ql)?://(([^:@/]*)(:([^@]*))?@)?(\[[^]]+\]|[^:/?]*)(:([0-9]+))?(/([^?]*))?(\?(.*))?$'
  [[ "$url" =~ $re ]] || return 1
  local user="${BASH_REMATCH[3]}" pass="${BASH_REMATCH[5]}" host="${BASH_REMATCH[6]}"
  local port="${BASH_REMATCH[8]}" db="${BASH_REMATCH[10]}" query="${BASH_REMATCH[12]}"
  [ -n "$user" ] && export PGUSER="$(xc_urldecode "$user")"
  [ -n "$pass" ] && export PGPASSWORD="$(xc_urldecode "$pass")"
  [ -n "$host" ] && export PGHOST="${host#[}" && PGHOST="${PGHOST%]}"
  [ -n "$port" ] && export PGPORT="$port"
  [ -n "$db" ] && export PGDATABASE="$(xc_urldecode "$db")"
  if [[ "$query" =~ (^|&)sslmode=([a-z-]+) ]]; then export PGSSLMODE="${BASH_REMATCH[2]}"; fi
  return 0
}

xc_urldecode() {
  local s="$1"
  printf '%b' "${s//%/\\x}"
}

# Đếm số dòng MỌI bảng schema public (một dòng `tên|số`). Dùng \gexec nên phải gửi qua stdin của psql.
XC_COUNTS_SQL="SELECT format('SELECT %L, count(*) FROM public.%I', tablename, tablename) FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename COLLATE \"C\" \\gexec"
# Đầu chuỗi audit theo từng chain_key: `chain_key|hash` của dòng seq lớn nhất.
XC_AUDIT_HEADS_SQL="SELECT chain_key || '|' || hash FROM (SELECT DISTINCT ON (chain_key) chain_key, hash FROM audit_event ORDER BY chain_key, seq DESC) h;"
# Phiên bản migration: `số bản đã áp|tên lớn nhất`.
XC_MIGRATION_SQL="SELECT count(*) || '|' || coalesce(max(name), '') FROM schema_migrations;"

# xc_snapshot_lines <thư mục>: ghi counts.txt, audit_heads.txt, migration.txt (đã sắp theo LC_ALL=C) cho DB hiện hành (PG*).
xc_snapshot_files() {
  local dir="$1"
  printf '%s\n' "$XC_COUNTS_SQL" | psql -X -qAt -v ON_ERROR_STOP=1 | LC_ALL=C sort >"$dir/counts.txt"
  psql -X -qAt -v ON_ERROR_STOP=1 -c "$XC_AUDIT_HEADS_SQL" | LC_ALL=C sort >"$dir/audit_heads.txt"
  psql -X -qAt -v ON_ERROR_STOP=1 -c "$XC_MIGRATION_SQL" >"$dir/migration.txt"
}
