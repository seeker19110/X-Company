#!/usr/bin/env bash
# backup-offsite.sh — đẩy bản sao lưu MỚI NHẤT của scripts/backup.sh vào kho restic ở đích khác (OPS-DR-003/004, DB-BACKUP-004; D-040).
# Chạy: `npm run -s backup:offsite`. restic = kho mã hoá (AES-256 + Poly1305) + toàn vẹn + snapshot; cài bằng
# `node scripts/tools/install-tool.mjs install restic` (ghim phiên bản + sha256).
#
# Biến môi trường (KHÔNG bao giờ in mật khẩu/khoá):
#   RESTIC_REPOSITORY        đích: đường dẫn cục bộ (thư mục/ổ KHÁC BACKUP_DIR) | sftp:user@host:/đường/dẫn | s3:https://host/bucket | rest:https://…
#                            URL không được nhúng mật khẩu/khoá (khoá S3 = AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY của môi trường) — vi phạm → exit 2.
#   RESTIC_PASSWORD | RESTIC_PASSWORD_FILE | RESTIC_PASSWORD_COMMAND   mật khẩu kho (do NGƯỜI giữ riêng, tách khỏi máy chủ) — thiếu → exit 2
#   BACKUP_DIR               thư mục sao lưu cục bộ (mặc định .data/backups)
#   BACKUP_OFFSITE_KEEP_LAST|DAILY|WEEKLY|MONTHLY   chính sách giữ (mặc định LAST=7, DAILY=7, WEEKLY=4, MONTHLY=6; `0` bỏ một mức)
#   BACKUP_OFFSITE_CHECK_SUBSET   `--read-data-subset` của restic check (mặc định 10%; `all` = đọc toàn bộ dữ liệu)
#   RESTIC_BIN               đường dẫn nhị phân (mặc định .tools/bin/restic)
# Các bước: bản mới nhất + kiểm sha256 sidecar → (init kho nếu chưa có) → restic backup → restic check (+ --read-data-subset) →
# forget --prune theo chính sách → ghi BACKUP_DIR/offsite-status.json (đọc bởi cảnh báo `XCLocalOffsiteBackupStale`) kèm bảng đếm 3-2-1.
# Bảng 3-2-1 nói THẬT: đích dạng đường dẫn cục bộ KHÔNG chứng minh "địa điểm khác" (meets_321=false); chỉ sftp/s3/rest mới có thể.
# Exit: 0 xong · 1 lỗi khi chạy/restic check đỏ · 2 cấu hình sai/thiếu mật khẩu/công cụ.
set -euo pipefail
umask 077
export LC_ALL=C
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/restic-env.sh
source "$ROOT/scripts/lib/restic-env.sh"

die() {
  local code="$1"
  shift
  echo "backup-offsite: $*" >&2
  exit "$code"
}
log() { echo "backup-offsite: $*" >&2; }

REPO="${RESTIC_REPOSITORY:-}"
[ -n "$REPO" ] || die 2 "thiếu RESTIC_REPOSITORY"
if xc_repo_has_embedded_secret "$REPO"; then
  die 2 "RESTIC_REPOSITORY không được nhúng mật khẩu/khoá trong URL — dùng biến môi trường của nhà cung cấp"
fi
xc_have_repo_password || die 2 "thiếu mật khẩu kho (RESTIC_PASSWORD, RESTIC_PASSWORD_FILE hoặc RESTIC_PASSWORD_COMMAND) — từ chối chạy"
RESTIC="$(xc_restic_bin "$ROOT")" || die 2 "chưa cài restic — chạy: node scripts/tools/install-tool.mjs install restic"
for tool in jq sha256sum; do command -v "$tool" >/dev/null || die 2 "thiếu công cụ: $tool"; done
export RESTIC_CACHE_DIR="${RESTIC_CACHE_DIR:-$ROOT/.data/restic-cache}"
mkdir -p "$RESTIC_CACHE_DIR"

BACKUP_DIR="${BACKUP_DIR:-$ROOT/.data/backups}"
KEEP_LAST="${BACKUP_OFFSITE_KEEP_LAST:-7}"
KEEP_DAILY="${BACKUP_OFFSITE_KEEP_DAILY:-7}"
KEEP_WEEKLY="${BACKUP_OFFSITE_KEEP_WEEKLY:-4}"
KEEP_MONTHLY="${BACKUP_OFFSITE_KEEP_MONTHLY:-6}"
for v in KEEP_LAST KEEP_DAILY KEEP_WEEKLY KEEP_MONTHLY; do
  [[ "${!v}" =~ ^[0-9]+$ ]] || die 2 "BACKUP_OFFSITE_${v} phải là số nguyên ≥ 0"
done
[ "$KEEP_LAST$KEEP_DAILY$KEEP_WEEKLY$KEEP_MONTHLY" != "0000" ] || die 2 "chính sách giữ không được toàn 0 (sẽ xoá hết)"
SUBSET="${BACKUP_OFFSITE_CHECK_SUBSET:-10%}"
[[ "$SUBSET" =~ ^([0-9]+%|all|[0-9]+/[0-9]+)$ ]] || die 2 "BACKUP_OFFSITE_CHECK_SUBSET dạng 10%, n/t hoặc all"

KIND="$(xc_repo_kind "$REPO")"
SAFE_REPO="$(xc_repo_redact "$REPO")"
if [ "$KIND" = "local" ]; then
  REPO_PATH="${REPO#local:}"
  mkdir -p "$REPO_PATH"
  REAL_REPO="$(cd "$REPO_PATH" && pwd -P)"
  REAL_BACKUP="$(mkdir -p "$BACKUP_DIR" && cd "$BACKUP_DIR" && pwd -P)"
  case "$REAL_REPO/" in
    "$REAL_BACKUP"/*) die 2 "kho off-site nằm TRONG thư mục sao lưu — không phải đích khác" ;;
  esac
  case "$REAL_BACKUP/" in
    "$REAL_REPO"/*) die 2 "thư mục sao lưu nằm trong kho off-site — cấu hình sai" ;;
  esac
  export RESTIC_REPOSITORY="$REAL_REPO"
fi

# --- bản sao lưu mới nhất, đã kiểm sha256 -----------------------------------------------------------------------------
mapfile -t manifests < <(printf '%s\n' "$BACKUP_DIR"/xc-*.manifest.json | LC_ALL=C sort)
M="${manifests[${#manifests[@]} - 1]}"
[ -f "$M" ] || die 2 "chưa có bản sao lưu trong $BACKUP_DIR — chạy backup trước"
BASE="$(basename "$M" .manifest.json)"
FILE="$(jq -r .file "$M")"
[ "$FILE" = "$(basename "$FILE")" ] && [ -f "$BACKUP_DIR/$FILE" ] && [ -f "$BACKUP_DIR/$BASE.sha256" ] || die 2 "bản sao lưu mới nhất thiếu tệp dữ liệu/.sha256"
(cd "$BACKUP_DIR" && sha256sum --check --status "$BASE.sha256") || die 1 "bản sao lưu cục bộ hỏng checksum — không đẩy bản hỏng lên off-site"
[ "$(jq -r .sha256 "$M")" = "$(cut -d' ' -f1 "$BACKUP_DIR/$BASE.sha256")" ] || die 1 "manifest và .sha256 không khớp"
ENCRYPTED="$(jq -r .encrypted "$M")"

START="$(date +%s.%N)"
# --- kho: tạo nếu chưa có ----------------------------------------------------------------------------------------------
if ! "$RESTIC" cat config >/dev/null 2>&1; then
  if [ "$KIND" = "local" ] && [ -z "$(ls -A "$RESTIC_REPOSITORY" 2>/dev/null)" ]; then
    "$RESTIC" init --quiet >/dev/null || die 1 "restic init thất bại"
    log "đã tạo kho mới ($SAFE_REPO)"
  else
    die 1 "không mở được kho $SAFE_REPO (sai mật khẩu hoặc kho hỏng/không tới được)"
  fi
fi

# --- đẩy: đường dẫn tương đối trong BACKUP_DIR, gắn thẻ xc-db ----------------------------------------------------------
(cd "$BACKUP_DIR" && "$RESTIC" backup --quiet --tag xc-db --host xc-offsite "$FILE" "$BASE.sha256" "$BASE.manifest.json") >/dev/null ||
  die 1 "restic backup thất bại"
T_PUSH="$(date +%s.%N)"
log "đã đẩy $BASE lên $SAFE_REPO"

# --- toàn vẹn: cấu trúc + đọc một phần dữ liệu (hoặc toàn bộ) ----------------------------------------------------------
CHECK_ARGS=()
[ "$SUBSET" = "all" ] && CHECK_ARGS=(--read-data) || CHECK_ARGS=(--read-data-subset="$SUBSET")
"$RESTIC" check --quiet "${CHECK_ARGS[@]}" >/dev/null 2>&1 || die 1 "restic check ĐỎ — kho off-site hỏng hoặc không đọc được (không cập nhật trạng thái off-site)"
T_CHECK="$(date +%s.%N)"

# --- chính sách giữ -----------------------------------------------------------------------------------------------------
# "host,tags" là MỘT đối số của restic --group-by (dấu phẩy có chủ đích), không phải lỗi tách phần tử mảng.
# shellcheck disable=SC2054
FORGET=(--tag xc-db --host xc-offsite --group-by host,tags --prune --quiet)
[ "$KEEP_LAST" != 0 ] && FORGET+=(--keep-last "$KEEP_LAST")
[ "$KEEP_DAILY" != 0 ] && FORGET+=(--keep-daily "$KEEP_DAILY")
[ "$KEEP_WEEKLY" != 0 ] && FORGET+=(--keep-weekly "$KEEP_WEEKLY")
[ "$KEEP_MONTHLY" != 0 ] && FORGET+=(--keep-monthly "$KEEP_MONTHLY")
"$RESTIC" forget "${FORGET[@]}" >/dev/null || die 1 "restic forget --prune thất bại"

# --- bảng đếm 3-2-1 -----------------------------------------------------------------------------------------------------
SNAPS_JSON="$("$RESTIC" snapshots --tag xc-db --json)"
SNAPS="$(jq 'length' <<<"$SNAPS_JSON")"
NEWEST="$(jq -r 'map(.time) | max' <<<"$SNAPS_JSON")"
LOCAL_COPIES="$(printf '%s\n' "$BACKUP_DIR"/xc-*.manifest.json | grep -c . || true)"
LOCAL_DEV="$(stat -c %d "$BACKUP_DIR")"
if [ "$KIND" = "local" ]; then
  REPO_DEV="$(stat -c %d "$RESTIC_REPOSITORY")"
  LOCATION="local-path"
else
  REPO_DEV="remote"
  LOCATION="remote"
fi
SYSTEMS=1
[ "$REPO_DEV" != "$LOCAL_DEV" ] && SYSTEMS=2
COPIES=$((LOCAL_COPIES > 0 ? 1 : 0))
[ "$SNAPS" -gt 0 ] && COPIES=$((COPIES + 1))
MEETS=false
[ "$KIND" != "local" ] && [ "$COPIES" -ge 2 ] && [ "$SYSTEMS" -ge 2 ] && MEETS=true
END="$(date +%s.%N)"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
jq -n --arg now "$NOW" --arg kind "$KIND" --arg repo "$SAFE_REPO" --arg base "$BASE" --arg newest "$NEWEST" \
  --argjson snaps "$SNAPS" --argjson local "$LOCAL_COPIES" --argjson copies "$COPIES" --argjson systems "$SYSTEMS" \
  --argjson meets "$MEETS" --arg loc "$LOCATION" --argjson enc "$ENCRYPTED" --arg subset "$SUBSET" \
  --argjson push "$(awk -v a="$START" -v b="$T_PUSH" 'BEGIN{printf "%.2f",b-a}')" \
  --argjson chk "$(awk -v a="$T_PUSH" -v b="$T_CHECK" 'BEGIN{printf "%.2f",b-a}')" \
  --argjson tot "$(awk -v a="$START" -v b="$END" 'BEGIN{printf "%.2f",b-a}')" \
  --argjson keep "$(jq -n --argjson l "$KEEP_LAST" --argjson d "$KEEP_DAILY" --argjson w "$KEEP_WEEKLY" --argjson m "$KEEP_MONTHLY" '{last:$l,daily:$d,weekly:$w,monthly:$m}')" '
  { format: 1, last_success_utc: $now, repo_kind: $kind, repo: $repo, pushed: $base, newest_snapshot_utc: $newest,
    snapshots: $snaps, db_dump_encrypted: $enc, check_read_data: $subset, keep: $keep,
    seconds: { push: $push, check: $chk, total: $tot },
    three_two_one: { local_backups: $local, copies_distinct_stores: $copies, systems: $systems, offsite_location: $loc,
                     meets_321: $meets,
                     note: "meets_321 chỉ đúng khi đích là dịch vụ ngoài (sftp/s3/rest) VÀ ≥ 2 bản trên ≥ 2 hệ thống; đích đường dẫn cục bộ không chứng minh địa điểm khác" } }' \
  >"$BACKUP_DIR/offsite-status.json.tmp"
mv "$BACKUP_DIR/offsite-status.json.tmp" "$BACKUP_DIR/offsite-status.json"
echo "backup-offsite: xong repo=$SAFE_REPO kind=$KIND snapshots=$SNAPS newest=$NEWEST seconds=$(jq -r .seconds.total "$BACKUP_DIR/offsite-status.json") meets_321=$MEETS"
