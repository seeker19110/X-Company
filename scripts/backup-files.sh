#!/usr/bin/env bash
# backup-files.sh — sao lưu kho TỆP trên S3 (FILE_STORAGE=s3) vào kho restic off-site (T-126; OPS-DR-003/004, D-040, D-073).
# Chạy: `npm run -s backup:files`. Kho đĩa (FILE_STORAGE=disk) KHÔNG đi đường này — xem docs/ops/runbooks/restore-files.md §A.
# Các bước: chụp mọi đối tượng (BẢN MÃ, như trên S3) + files-manifest.json vào thư mục tạm (scripts/files-s3.ts export — giải mã thử
# từng tệp, đối tượng lạ/hỏng → dừng) → (init kho nếu chưa có) → restic backup thẻ xc-files → restic check (+ --read-data-subset) →
# forget --prune theo chính sách → ghi BACKUP_DIR/files-offsite-status.json → xoá thư mục tạm.
# Biến môi trường (KHÔNG bao giờ in mật khẩu/khoá):
#   FILE_STORAGE=s3 + S3_ENDPOINT/S3_BUCKET/S3_REGION/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY   kho nguồn (như ứng dụng)
#   DATA_ENCRYPTION_KEYS | KMS_*      khoá giải mã như ứng dụng (để kiểm từng tệp đọc được trước khi đẩy)
#   RESTIC_REPOSITORY, RESTIC_PASSWORD | _FILE | _COMMAND, RESTIC_BIN      như backup-offsite.sh (URL nhúng khoá → exit 2)
#   BACKUP_DIR                        nơi ghi trạng thái + thư mục tạm (mặc định .data/backups)
#   BACKUP_FILES_KEEP_LAST|DAILY|WEEKLY|MONTHLY   chính sách giữ (mặc định 7/7/4/6; `0` bỏ một mức; toàn 0 → exit 2)
#   BACKUP_OFFSITE_CHECK_SUBSET       `--read-data-subset` của restic check (mặc định 10%; `all` = đọc toàn bộ)
# Exit: 0 xong · 1 lỗi khi chạy (đối tượng lạ/hỏng, S3 lỗi, restic lỗi/check đỏ) · 2 cấu hình sai/thiếu mật khẩu/công cụ.
set -euo pipefail
umask 077
export LC_ALL=C
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/restic-env.sh
source "$ROOT/scripts/lib/restic-env.sh"

die() {
  local code="$1"
  shift
  echo "backup-files: $*" >&2
  exit "$code"
}
log() { echo "backup-files: $*" >&2; }

[ "${FILE_STORAGE:-disk}" = "s3" ] ||
  die 2 "chỉ dùng khi FILE_STORAGE=s3 (kho đĩa: sao lưu FILE_STORAGE_DIR theo docs/ops/runbooks/restore-files.md)"
REPO="${RESTIC_REPOSITORY:-}"
[ -n "$REPO" ] || die 2 "thiếu RESTIC_REPOSITORY"
if xc_repo_has_embedded_secret "$REPO"; then
  die 2 "RESTIC_REPOSITORY không được nhúng mật khẩu/khoá trong URL — dùng biến môi trường của nhà cung cấp"
fi
xc_have_repo_password || die 2 "thiếu mật khẩu kho (RESTIC_PASSWORD, RESTIC_PASSWORD_FILE hoặc RESTIC_PASSWORD_COMMAND) — từ chối chạy"
RESTIC="$(xc_restic_bin "$ROOT")" || die 2 "chưa cài restic — chạy: node scripts/tools/install-tool.mjs install restic"
TSX="$ROOT/node_modules/.bin/tsx"
[ -x "$TSX" ] || die 2 "thiếu tsx (chạy npm ci)"
command -v jq >/dev/null || die 2 "thiếu công cụ: jq"
command -v flock >/dev/null || die 2 "thiếu công cụ: flock"
export RESTIC_CACHE_DIR="${RESTIC_CACHE_DIR:-$ROOT/.data/restic-cache}"
mkdir -p "$RESTIC_CACHE_DIR"

BACKUP_DIR="${BACKUP_DIR:-$ROOT/.data/backups}"
KEEP_LAST="${BACKUP_FILES_KEEP_LAST:-7}"
KEEP_DAILY="${BACKUP_FILES_KEEP_DAILY:-7}"
KEEP_WEEKLY="${BACKUP_FILES_KEEP_WEEKLY:-4}"
KEEP_MONTHLY="${BACKUP_FILES_KEEP_MONTHLY:-6}"
for v in KEEP_LAST KEEP_DAILY KEEP_WEEKLY KEEP_MONTHLY; do
  [[ "${!v}" =~ ^[0-9]+$ ]] || die 2 "BACKUP_FILES_${v} phải là số nguyên ≥ 0"
done
[ "$KEEP_LAST$KEEP_DAILY$KEEP_WEEKLY$KEEP_MONTHLY" != "0000" ] || die 2 "chính sách giữ không được toàn 0 (sẽ xoá hết)"
SUBSET="${BACKUP_OFFSITE_CHECK_SUBSET:-10%}"
[[ "$SUBSET" =~ ^([0-9]+%|all|[0-9]+/[0-9]+)$ ]] || die 2 "BACKUP_OFFSITE_CHECK_SUBSET dạng 10%, n/t hoặc all"

KIND="$(xc_repo_kind "$REPO")"
SAFE_REPO="$(xc_repo_redact "$REPO")"
mkdir -p "$BACKUP_DIR"
if [ "$KIND" = "local" ]; then
  REPO_PATH="${REPO#local:}"
  mkdir -p "$REPO_PATH"
  REAL_REPO="$(cd "$REPO_PATH" && pwd -P)"
  REAL_BACKUP="$(cd "$BACKUP_DIR" && pwd -P)"
  case "$REAL_REPO/" in
    "$REAL_BACKUP"/*) die 2 "kho off-site nằm TRONG thư mục sao lưu — không phải đích khác" ;;
  esac
  export RESTIC_REPOSITORY="$REAL_REPO"
fi

exec 9>"$BACKUP_DIR/.files.lock"
flock -n 9 || die 1 "đang có một lần sao lưu tệp khác chạy (khoá $BACKUP_DIR/.files.lock)"
WORK="$(mktemp -d "$BACKUP_DIR/.files-work.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

START="$(date +%s.%N)"
# --- chụp đối tượng S3 (bản mã) + manifest; giải mã thử từng tệp --------------------------------------------------------
set +e
"$TSX" "$ROOT/scripts/files-s3.ts" export "$WORK/snap" >"$WORK/export.json"
RC=$?
set -e
[ "$RC" -eq 0 ] || die "$([ "$RC" -eq 2 ] && echo 2 || echo 1)" "chụp kho S3 thất bại (xem lỗi ở trên) — không đẩy lên off-site"
OBJECTS="$(jq -r .objects "$WORK/export.json")"
BYTES="$(jq -r .total_bytes "$WORK/export.json")"
T_EXPORT="$(date +%s.%N)"

# --- kho: tạo nếu chưa có ----------------------------------------------------------------------------------------------
if ! "$RESTIC" cat config >/dev/null 2>&1; then
  if [ "$KIND" = "local" ] && [ -z "$(ls -A "$RESTIC_REPOSITORY" 2>/dev/null)" ]; then
    "$RESTIC" init --quiet >/dev/null || die 1 "restic init thất bại"
    log "đã tạo kho mới ($SAFE_REPO)"
  else
    die 1 "không mở được kho $SAFE_REPO (sai mật khẩu hoặc kho hỏng/không tới được)"
  fi
fi

# --- đẩy: thư mục bản chụp, thẻ xc-files (tách nhóm giữ với xc-db) -------------------------------------------------------
(cd "$WORK/snap" && "$RESTIC" backup --quiet --tag xc-files --host xc-offsite files-manifest.json objects) >/dev/null ||
  die 1 "restic backup thất bại"
T_PUSH="$(date +%s.%N)"
log "đã đẩy $OBJECTS đối tượng lên $SAFE_REPO"

CHECK_ARGS=()
[ "$SUBSET" = "all" ] && CHECK_ARGS=(--read-data) || CHECK_ARGS=(--read-data-subset="$SUBSET")
"$RESTIC" check --quiet "${CHECK_ARGS[@]}" >/dev/null 2>&1 || die 1 "restic check ĐỎ — kho off-site hỏng hoặc không đọc được (không cập nhật trạng thái)"

# "host,tags" là MỘT đối số của restic --group-by (dấu phẩy có chủ đích).
# shellcheck disable=SC2054
FORGET=(--tag xc-files --host xc-offsite --group-by host,tags --prune --quiet)
[ "$KEEP_LAST" != 0 ] && FORGET+=(--keep-last "$KEEP_LAST")
[ "$KEEP_DAILY" != 0 ] && FORGET+=(--keep-daily "$KEEP_DAILY")
[ "$KEEP_WEEKLY" != 0 ] && FORGET+=(--keep-weekly "$KEEP_WEEKLY")
[ "$KEEP_MONTHLY" != 0 ] && FORGET+=(--keep-monthly "$KEEP_MONTHLY")
"$RESTIC" forget "${FORGET[@]}" >/dev/null || die 1 "restic forget --prune thất bại"

SNAPS_JSON="$("$RESTIC" snapshots --tag xc-files --json)"
SNAPS="$(jq 'length' <<<"$SNAPS_JSON")"
NEWEST="$(jq -r 'map(.time) | max' <<<"$SNAPS_JSON")"
END="$(date +%s.%N)"
secs() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.2f", b - a }'; }
jq -n --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg kind "$KIND" --arg repo "$SAFE_REPO" --arg newest "$NEWEST" \
  --argjson snaps "$SNAPS" --argjson objects "$OBJECTS" --argjson bytes "$BYTES" --arg subset "$SUBSET" \
  --argjson exp "$(secs "$START" "$T_EXPORT")" --argjson push "$(secs "$T_EXPORT" "$T_PUSH")" \
  --argjson tot "$(secs "$START" "$END")" '
  { format: 1, last_success_utc: $now, source: "s3", repo_kind: $kind, repo: $repo, objects: $objects, total_bytes: $bytes,
    snapshots: $snaps, newest_snapshot_utc: $newest, check_read_data: $subset,
    seconds: { export: $exp, push: $push, total: $tot } }' >"$BACKUP_DIR/files-offsite-status.json.tmp"
mv "$BACKUP_DIR/files-offsite-status.json.tmp" "$BACKUP_DIR/files-offsite-status.json"
echo "backup-files: xong repo=$SAFE_REPO kind=$KIND objects=$OBJECTS bytes=$BYTES snapshots=$SNAPS seconds=$(secs "$START" "$END")"
