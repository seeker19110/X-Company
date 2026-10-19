#!/usr/bin/env bash
# backup.sh — sao lưu logical PostgreSQL cục bộ (DB-BACKUP-*, OPS-DR-*). Chạy: `npm run -s backup`.
#
# Đầu vào (biến môi trường; KHÔNG bao giờ in giá trị DATABASE_URL / BACKUP_PASSPHRASE):
#   DATABASE_URL               bắt buộc (postgres://…)
#   BACKUP_DIR                 thư mục đích (mặc định .data/backups — đã .gitignore)
#   BACKUP_KEEP                số bản gần nhất giữ lại (mặc định 7, ≥ 1)
#   BACKUP_PASSPHRASE          có đặt (≥ 16 ký tự) → mã hoá AES-256-CBC (openssl, PBKDF2 600k vòng, muối ngẫu nhiên)
#   BACKUP_REQUIRE_ENCRYPTION  =1 → thiếu BACKUP_PASSPHRASE thì từ chối chạy (exit 2) thay vì sao lưu không mã hoá
# Mỗi bản = 3 tệp: xc-<UTC>.dump[.enc] · xc-<UTC>.sha256 (định dạng sha256sum) · xc-<UTC>.manifest.json
# (thời điểm UTC, sha256, số dòng MỌI bảng public, đầu chuỗi audit theo chain_key, phiên bản migration). Số liệu manifest
# lấy trong CÙNG snapshot với pg_dump (pg_export_snapshot) nên khớp từng dòng dù ứng dụng đang ghi.
# Exit: 0 xong · 1 lỗi khi sao lưu · 2 cấu hình sai/thiếu khoá/công cụ.
# Giới hạn (nêu thật): bản sao nằm CÙNG máy (không off-site), khoá nằm trong biến môi trường (không KMS/escrow),
# openssl enc không xác thực bản mã (toàn vẹn dựa vào sha256 + diễn tập khôi phục + chuỗi audit).
set -euo pipefail
umask 077
export LC_ALL=C
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/pg-env.sh
source "$ROOT/scripts/lib/pg-env.sh"

die() {
  local code="$1"
  shift
  echo "backup: $*" >&2
  exit "$code"
}

[ -n "${DATABASE_URL:-}" ] || die 2 "thiếu DATABASE_URL"
xc_pg_env "$DATABASE_URL" || die 2 "DATABASE_URL không phải URL postgres(ql)://"
unset DATABASE_URL # tiến trình con chỉ dùng biến PG*; URL không đi vào argv

BACKUP_DIR="${BACKUP_DIR:-$ROOT/.data/backups}"
BACKUP_KEEP="${BACKUP_KEEP:-7}"
[[ "$BACKUP_KEEP" =~ ^[1-9][0-9]*$ ]] || die 2 "BACKUP_KEEP phải là số nguyên ≥ 1"
PASS="${BACKUP_PASSPHRASE:-}"
unset BACKUP_PASSPHRASE
if [ -z "$PASS" ] && [ "${BACKUP_REQUIRE_ENCRYPTION:-0}" = "1" ]; then
  die 2 "BACKUP_REQUIRE_ENCRYPTION=1 nhưng thiếu BACKUP_PASSPHRASE — từ chối sao lưu không mã hoá"
fi
if [ -n "$PASS" ] && [ "${#PASS}" -lt 16 ]; then die 2 "BACKUP_PASSPHRASE phải dài ≥ 16 ký tự"; fi
for tool in pg_dump psql sha256sum jq flock; do command -v "$tool" >/dev/null || die 2 "thiếu công cụ: $tool"; done
if [ -n "$PASS" ]; then command -v openssl >/dev/null || die 2 "thiếu công cụ: openssl"; fi

mkdir -p "$BACKUP_DIR"
exec 9>"$BACKUP_DIR/.lock"
flock -n 9 || die 1 "đang có một lần sao lưu khác chạy (khoá $BACKUP_DIR/.lock)"

WORK="$(mktemp -d "$BACKUP_DIR/.work.XXXXXX")"
cleanup() {
  if [ -n "${PSQL_PID:-}" ]; then kill "$PSQL_PID" 2>/dev/null || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

START="$(date +%s.%N)"
STAMP="$(date -u +%Y%m%dT%H%M%S%3NZ)"
CREATED="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
BASE="xc-$STAMP"
DUMP="$BASE.dump"

# --- Một phiên REPEATABLE READ giữ snapshot; số liệu manifest + pg_dump dùng chung snapshot đó ---------------------
coproc PSQL { psql -X -q -A -t -v ON_ERROR_STOP=1 2>&1; }
SEND="${PSQL[1]}"
RECV="${PSQL[0]}"
# psql_ask <sql>: gửi, đọc tới dấu kết thúc; in các dòng kết quả.
psql_ask() {
  printf '%s\nSELECT \x27__END__\x27;\n' "$1" >&"$SEND"
  local line
  while IFS= read -r -t 300 line <&"$RECV"; do
    [ "$line" = "__END__" ] && return 0
    printf '%s\n' "$line"
  done
  return 1
}
printf '%s\n' "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;" >&"$SEND"
# Không dùng $(…) hay đường ống quanh psql_ask: bash đóng fd của coproc trong subshell.
psql_ask "SELECT pg_export_snapshot();" >"$WORK/snap.txt" || die 1 "không mở được snapshot (kết nối DB lỗi?)"
SNAP="$(cat "$WORK/snap.txt")"
[[ "$SNAP" =~ ^[0-9A-Fa-f-]+$ ]] || die 1 "snapshot không hợp lệ"

psql_ask "$XC_COUNTS_SQL" >"$WORK/counts.raw" || die 1 "không đếm được số dòng các bảng"
psql_ask "$XC_AUDIT_HEADS_SQL" >"$WORK/audit_heads.raw" || die 1 "không đọc được đầu chuỗi audit"
psql_ask "$XC_MIGRATION_SQL" >"$WORK/migration.txt" || die 1 "không đọc được phiên bản migration"
LC_ALL=C sort "$WORK/counts.raw" >"$WORK/counts.txt"
LC_ALL=C sort "$WORK/audit_heads.raw" >"$WORK/audit_heads.txt"

pg_dump -Fc --no-owner --snapshot="$SNAP" -f "$WORK/$DUMP" || die 1 "pg_dump thất bại"
printf 'ROLLBACK;\n\\q\n' >&"$SEND" || true
wait "$PSQL_PID" 2>/dev/null || true
PSQL_PID=""

FILE="$DUMP"
ENCRYPTED=false
if [ -n "$PASS" ]; then
  FILE="$DUMP.enc"
  XC_BACKUP_PASS="$PASS" openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass env:XC_BACKUP_PASS \
    -in "$WORK/$DUMP" -out "$WORK/$FILE" || die 1 "mã hoá thất bại"
  rm -f "$WORK/$DUMP"
  ENCRYPTED=true
fi
unset PASS

(cd "$WORK" && sha256sum "$FILE") >"$WORK/$BASE.sha256"
SHA="$(cut -d' ' -f1 "$WORK/$BASE.sha256")"
SIZE="$(stat -c %s "$WORK/$FILE")"
END="$(date +%s.%N)"
DURATION="$(awk -v a="$START" -v b="$END" 'BEGIN { printf "%.2f", b - a }')"

jq -n \
  --arg created "$CREATED" --arg file "$FILE" --arg sha "$SHA" --argjson size "$SIZE" \
  --argjson encrypted "$ENCRYPTED" --arg dbname "${PGDATABASE:-}" --argjson dur "$DURATION" \
  --arg pgdump "$(pg_dump --version | awk '{print $NF}')" \
  --argjson tables "$(jq -Rn '[inputs | split("|") | {(.[0]): (.[1] | tonumber)}] | add // {}' <"$WORK/counts.txt")" \
  --argjson audit "$(jq -Rn '[inputs | split("|") | {(.[0]): .[1]}] | add // {}' <"$WORK/audit_heads.txt")" \
  --arg migrations "$(cat "$WORK/migration.txt")" '
  ($migrations | split("|")) as $m
  | { format: 1, created_at_utc: $created, database: $dbname, file: $file, sha256: $sha, size_bytes: $size,
      encrypted: $encrypted, cipher: (if $encrypted then "aes-256-cbc/pbkdf2-600000" else null end),
      pg_dump_version: $pgdump, backup_seconds: $dur, tables: $tables,
      audit: { rows: ($tables.audit_event // 0), heads: $audit },
      migration: { applied: ($m[0] | tonumber), latest: $m[1] } }' >"$WORK/$BASE.manifest.json"

# Đặt vào thư mục đích: tệp dữ liệu → checksum → manifest CUỐI (chưa có manifest thì bản chưa được tính là hoàn chỉnh).
mv "$WORK/$FILE" "$BACKUP_DIR/$FILE"
mv "$WORK/$BASE.sha256" "$BACKUP_DIR/$BASE.sha256"
mv "$WORK/$BASE.manifest.json" "$BACKUP_DIR/$BASE.manifest.json"

# Giữ BACKUP_KEEP bản gần nhất (tên có dấu thời gian UTC → sắp theo tên = theo thời gian); chỉ xoá tệp đúng mẫu xc-*.
mapfile -t manifests < <(printf '%s\n' "$BACKUP_DIR"/xc-*.manifest.json | LC_ALL=C sort)
excess=$((${#manifests[@]} - BACKUP_KEEP))
removed=0
if [ "$excess" -gt 0 ]; then
  for ((i = 0; i < excess; i++)); do
    old="${manifests[$i]%.manifest.json}"
    rm -f -- "$old.dump" "$old.dump.enc" "$old.sha256" "$old.manifest.json"
    removed=$((removed + 1))
  done
fi

echo "backup: xong file=$BACKUP_DIR/$FILE sha256=$SHA size_bytes=$SIZE encrypted=$ENCRYPTED seconds=$DURATION kept=$((${#manifests[@]} - removed)) removed=$removed"
