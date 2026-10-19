#!/usr/bin/env bash
# restore-drill.sh — diễn tập khôi phục bản sao lưu vào CSDL TẠM rồi đối chiếu (DB-BACKUP-003, OPS-DR-*).
# Chạy: `npm run -s backup:drill [-- --file <manifest|dump>] [--keep-db] [--compare-live] [--report <tệp.json>]`.
#
# Các bước: (1) chọn bản (mặc định bản mới nhất trong BACKUP_DIR) → (2) kiểm sha256: thực tế = manifest = tệp .sha256
# → (3) giải mã nếu bản có mã hoá (cần BACKUP_PASSPHRASE) → (4) tạo DB tạm trên cùng máy chủ của DATABASE_URL,
# pg_restore → (5) so số dòng MỌI bảng, đầu chuỗi audit và phiên bản migration với manifest → (6) chạy
# scripts/verify-audit-chain.ts trên bản khôi phục → (7) đo thời gian (RTO thật) và tuổi bản sao lưu (RPO thật)
# → (8) xoá DB tạm + tệp giải mã (trừ --keep-db). --compare-live: thêm bảng chênh lệch giữa DB đang chạy và manifest
# (chỉ báo, không làm đỏ — chính là phần dữ liệu sẽ mất nếu khôi phục bản này).
# Biến: DATABASE_URL (bắt buộc; role cần quyền CREATE DATABASE) · BACKUP_DIR · BACKUP_PASSPHRASE ·
#       DRILL_RPO_SECONDS / DRILL_RTO_SECONDS (tuỳ chọn: vượt ngưỡng → exit 1).
# Stdout: một đối tượng JSON báo cáo; tiến trình ghi ra stderr. Không bao giờ in DATABASE_URL / khoá.
# Exit: 0 khớp hết · 1 lệch dữ liệu/chuỗi audit/vượt RPO-RTO · 2 cấu hình sai, thiếu hoặc sai khoá · 3 bản sao lưu hỏng (checksum).
set -euo pipefail
umask 077
export LC_ALL=C
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/pg-env.sh
source "$ROOT/scripts/lib/pg-env.sh"

log() { echo "restore-drill: $*" >&2; }
die() {
  local code="$1"
  shift
  echo "restore-drill: $*" >&2
  exit "$code"
}

FILE_ARG=""
KEEP_DB=0
COMPARE_LIVE=0
REPORT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --file) FILE_ARG="${2:-}"; shift 2 ;;
    --keep-db) KEEP_DB=1; shift ;;
    --compare-live) COMPARE_LIVE=1; shift ;;
    --report) REPORT="${2:-}"; shift 2 ;;
    *) die 2 "tham số lạ: $1" ;;
  esac
done

[ -n "${DATABASE_URL:-}" ] || die 2 "thiếu DATABASE_URL"
BASE_URL="$DATABASE_URL"
xc_pg_env "$BASE_URL" || die 2 "DATABASE_URL không phải URL postgres(ql)://"
unset DATABASE_URL
LIVE_DB="${PGDATABASE:-}"
[ -n "$LIVE_DB" ] || die 2 "DATABASE_URL thiếu tên CSDL"
PASS="${BACKUP_PASSPHRASE:-}"
unset BACKUP_PASSPHRASE
for tool in pg_restore psql sha256sum jq awk; do command -v "$tool" >/dev/null || die 2 "thiếu công cụ: $tool"; done
for v in DRILL_RPO_SECONDS DRILL_RTO_SECONDS; do
  [[ -z "${!v:-}" || "${!v}" =~ ^[0-9]+$ ]] || die 2 "$v phải là số nguyên giây"
done

BACKUP_DIR="${BACKUP_DIR:-$ROOT/.data/backups}"
if [ -z "$FILE_ARG" ]; then
  mapfile -t found < <(printf '%s\n' "$BACKUP_DIR"/xc-*.manifest.json | LC_ALL=C sort)
  FILE_ARG="${found[${#found[@]} - 1]}"
fi
[ -f "$FILE_ARG" ] || die 2 "không tìm thấy bản sao lưu (manifest) — chạy backup trước"
MANIFEST="${FILE_ARG%.dump.enc}"; MANIFEST="${MANIFEST%.dump}"; MANIFEST="${MANIFEST%.manifest.json}.manifest.json"
[ -f "$MANIFEST" ] || die 2 "thiếu manifest: $(basename "$MANIFEST")"
jq -e '.format == 1 and (.file | type == "string") and (.sha256 | test("^[0-9a-f]{64}$"))' "$MANIFEST" >/dev/null ||
  die 2 "manifest không hợp lệ"
DIR="$(dirname "$MANIFEST")"
BASE="$(basename "$MANIFEST" .manifest.json)"
M_FILE="$(jq -r .file "$MANIFEST")"
[ "$M_FILE" = "$(basename "$M_FILE")" ] || die 2 "manifest trỏ tệp ngoài thư mục sao lưu"
M_SHA="$(jq -r .sha256 "$MANIFEST")"
ENCRYPTED="$(jq -r .encrypted "$MANIFEST")"
CREATED="$(jq -r .created_at_utc "$MANIFEST")"

WORK="$(mktemp -d)"
TMPDB=""
cleanup() {
  if [ -n "$TMPDB" ] && [ "$KEEP_DB" -eq 0 ]; then
    PGDATABASE="$LIVE_DB" psql -X -qAt -c "DROP DATABASE IF EXISTS \"$TMPDB\" WITH (FORCE)" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

problems=()
now() { date +%s.%N; }
secs() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.2f", b - a }'; }

T0="$(now)"
# --- (2) checksum ------------------------------------------------------------------------------------------------
[ -f "$DIR/$M_FILE" ] || die 3 "bản sao lưu mất tệp dữ liệu ($M_FILE)"
SIDECAR=""
[ -f "$DIR/$BASE.sha256" ] && SIDECAR="$(cut -d' ' -f1 "$DIR/$BASE.sha256")"
ACTUAL="$(sha256sum "$DIR/$M_FILE" | cut -d' ' -f1)"
if [ "$ACTUAL" != "$M_SHA" ]; then die 3 "checksum KHÔNG khớp manifest — bản sao lưu hỏng hoặc bị sửa ($M_FILE)"; fi
if [ "$SIDECAR" != "$M_SHA" ]; then die 3 "tệp .sha256 thiếu hoặc không khớp manifest"; fi
log "checksum khớp ($M_FILE)"
T_CHECK="$(now)"

# --- (3) giải mã -------------------------------------------------------------------------------------------------
DUMP="$DIR/$M_FILE"
if [ "$ENCRYPTED" = "true" ]; then
  [ -n "$PASS" ] || die 2 "bản sao lưu được mã hoá nhưng thiếu BACKUP_PASSPHRASE"
  command -v openssl >/dev/null || die 2 "thiếu công cụ: openssl"
  DUMP="$WORK/restore.dump"
  if ! XC_BACKUP_PASS="$PASS" openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:XC_BACKUP_PASS \
    -in "$DIR/$M_FILE" -out "$DUMP" 2>/dev/null; then
    die 2 "giải mã thất bại (sai BACKUP_PASSPHRASE?)"
  fi
  pg_restore -l "$DUMP" >/dev/null 2>&1 || die 2 "giải mã ra dữ liệu không đọc được (sai BACKUP_PASSPHRASE?)"
  log "đã giải mã"
fi
unset PASS
T_DECRYPT="$(now)"

# --- (4) khôi phục vào DB tạm ------------------------------------------------------------------------------------
TMPDB="xc_drill_$(date -u +%Y%m%d%H%M%S)_$RANDOM"
PGDATABASE="$LIVE_DB" psql -X -qAt -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$TMPDB\"" >/dev/null ||
  die 2 "không tạo được CSDL tạm (thiếu quyền CREATE DATABASE?)"
ACL_FLAG=()
if [ "$(PGDATABASE="$LIVE_DB" psql -X -qAt -c "SELECT count(*) FROM pg_roles WHERE rolname = 'xc_app_rw'")" != "1" ]; then
  ACL_FLAG=(--no-acl) # cụm đích chưa có role nhóm xc_app_rw (migration 0001) → bỏ GRANT; quyền cấp lại theo restore-db.md
fi
export PGDATABASE="$TMPDB"
if ! pg_restore --no-owner --exit-on-error "${ACL_FLAG[@]}" -d "$TMPDB" "$DUMP" 2>"$WORK/restore.err"; then
  head -c 600 "$WORK/restore.err" >&2
  problems+=("pg_restore thất bại")
fi
rm -f "$WORK/restore.dump"
T_RESTORE="$(now)"
log "đã khôi phục vào CSDL tạm"

# --- (5) đối chiếu -----------------------------------------------------------------------------------------------
mkdir -p "$WORK/got"
if [ "${#problems[@]}" -eq 0 ]; then
  xc_snapshot_files "$WORK/got" || problems+=("không đọc được số liệu từ bản khôi phục")
fi
jq -r '.tables | to_entries[] | "\(.key)|\(.value)"' "$MANIFEST" | LC_ALL=C sort >"$WORK/want_counts.txt"
jq -r '.audit.heads | to_entries[] | "\(.key)|\(.value)"' "$MANIFEST" | LC_ALL=C sort >"$WORK/want_audit_heads.txt"
jq -r '"\(.migration.applied)|\(.migration.latest)"' "$MANIFEST" >"$WORK/want_migration.txt"
ROWS_TOTAL="$(awk -F'|' '{ s += $2 } END { print s + 0 }' "$WORK/want_counts.txt")"
if [ "${#problems[@]}" -eq 0 ]; then
  # Mỗi dòng lệch: `bảng: manifest N, khôi phục M`.
  mismatch="$(awk -F'|' 'NR == FNR { w[$1] = $2; next } { g[$1] = $2 }
    END { for (t in w) if (!(t in g)) print t ": manifest " w[t] ", khôi phục thiếu bảng";
          else if (g[t] != w[t]) print t ": manifest " w[t] ", khôi phục " g[t];
          for (t in g) if (!(t in w)) print t ": bảng lạ trong bản khôi phục (" g[t] " dòng)" }' \
    "$WORK/want_counts.txt" "$WORK/got/counts.txt" | LC_ALL=C sort)"
  if [ -n "$mismatch" ]; then
    while IFS= read -r l; do problems+=("lệch số dòng — $l"); done <<<"$mismatch"
  fi
  cmp -s "$WORK/want_audit_heads.txt" "$WORK/got/audit_heads.txt" || problems+=("đầu chuỗi audit khác manifest")
  cmp -s "$WORK/want_migration.txt" "$WORK/got/migration.txt" || problems+=("phiên bản migration khác manifest")
fi

# --- (6) chuỗi audit trên bản khôi phục --------------------------------------------------------------------------
AUDIT_OK=false
AUDIT_MSG=""
if [ "${#problems[@]}" -eq 0 ]; then
  NEW_URL="${BASE_URL%%\?*}"
  QUERY=""
  [[ "$BASE_URL" == *\?* ]] && QUERY="?${BASE_URL#*\?}"
  NEW_URL="${NEW_URL%/*}/$TMPDB$QUERY"
  if AUDIT_MSG="$(cd "$ROOT" && DATABASE_URL="$NEW_URL" npx --no-install tsx scripts/verify-audit-chain.ts 2>&1)"; then
    AUDIT_OK=true
  else
    problems+=("chuỗi audit của bản khôi phục không hợp lệ")
  fi
  AUDIT_MSG="$(printf '%s' "$AUDIT_MSG" | tail -n 1 | head -c 300)"
fi
T_VERIFY="$(now)"

# --- (7) RPO/RTO + so với DB đang chạy ---------------------------------------------------------------------------
AGE=$(($(date -u +%s) - $(date -u -d "$CREATED" +%s)))
[ "$AGE" -ge 0 ] || AGE=0
T_DECRYPT_S="$(secs "$T_CHECK" "$T_DECRYPT")"
T_RESTORE_S="$(secs "$T_DECRYPT" "$T_RESTORE")"
T_VERIFY_S="$(secs "$T_RESTORE" "$T_VERIFY")"
T_TOTAL_S="$(secs "$T0" "$T_VERIFY")"
if [ -n "${DRILL_RPO_SECONDS:-}" ] && [ "$AGE" -gt "$DRILL_RPO_SECONDS" ]; then
  problems+=("tuổi bản sao lưu ${AGE}s vượt RPO mục tiêu ${DRILL_RPO_SECONDS}s")
fi
if [ -n "${DRILL_RTO_SECONDS:-}" ] && awk -v a="$T_TOTAL_S" -v b="$DRILL_RTO_SECONDS" 'BEGIN { exit !(a > b) }'; then
  problems+=("thời gian khôi phục ${T_TOTAL_S}s vượt RTO mục tiêu ${DRILL_RTO_SECONDS}s")
fi

: >"$WORK/drift.txt"
if [ "$COMPARE_LIVE" -eq 1 ]; then
  mkdir -p "$WORK/live"
  if (PGDATABASE="$LIVE_DB" xc_snapshot_files "$WORK/live"); then
    awk -F'|' 'NR == FNR { w[$1] = $2; next } { l[$1] = $2 }
      END { for (t in w) if (!(t in l) || (l[t] + 0) != w[t]) printf "%s|%s|%s\n", t, w[t], (t in l) ? l[t] : "-" }' \
      "$WORK/want_counts.txt" "$WORK/live/counts.txt" | LC_ALL=C sort >"$WORK/drift.txt"
  else
    log "không đọc được DB đang chạy để so sánh (bỏ qua)"
  fi
fi

OK=true
[ "${#problems[@]}" -eq 0 ] || OK=false
KEPT=null
[ "$KEEP_DB" -eq 1 ] && KEPT="\"$TMPDB\""
REPORT_JSON="$(jq -n \
  --argjson ok "$OK" --arg manifest "$(basename "$MANIFEST")" --arg created "$CREATED" \
  --argjson encrypted "$ENCRYPTED" --argjson age "$AGE" --argjson size "$(jq .size_bytes "$MANIFEST")" \
  --argjson rows "$ROWS_TOTAL" --argjson tables "$(wc -l <"$WORK/want_counts.txt")" \
  --argjson dec "$T_DECRYPT_S" --argjson res "$T_RESTORE_S" --argjson ver "$T_VERIFY_S" --argjson tot "$T_TOTAL_S" \
  --argjson backup_seconds "$(jq '.backup_seconds // null' "$MANIFEST")" \
  --argjson audit_ok "$AUDIT_OK" --arg audit_msg "$AUDIT_MSG" --argjson kept "$KEPT" \
  --argjson problems "$(printf '%s\n' "${problems[@]+"${problems[@]}"}" | jq -Rn '[inputs | select(length > 0)]')" \
  --argjson drift "$(jq -Rn '[inputs | split("|") | {table: .[0], manifest: (.[1] | tonumber), live: (.[2] | if . == "-" then null else tonumber end)}]' <"$WORK/drift.txt")" '
  { ok: $ok, backup: { manifest: $manifest, created_at_utc: $created, encrypted: $encrypted, size_bytes: $size,
                       tables: $tables, rows: $rows, backup_seconds: $backup_seconds },
    rpo_seconds: $age,
    rto_seconds: { decrypt: $dec, restore: $res, verify: $ver, total: $tot },
    audit_chain: { ok: $audit_ok, message: $audit_msg },
    live_drift: $drift, problems: $problems, kept_db: $kept }')"
printf '%s\n' "$REPORT_JSON"
if [ -n "$REPORT" ]; then printf '%s\n' "$REPORT_JSON" >"$REPORT"; fi

if [ "$OK" = "true" ]; then
  log "ĐẠT — khôi phục ${T_TOTAL_S}s, bản sao lưu cũ ${AGE}s"
  exit 0
fi
for p in "${problems[@]}"; do echo "restore-drill: LỆCH — $p" >&2; done
exit 1
