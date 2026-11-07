#!/usr/bin/env bash
# restore-files-drill.sh — diễn tập khôi phục kho TỆP S3 từ kho off-site restic (T-126; OPS-DR-003/004/007, D-040, D-073).
# Chạy: `npm run -s backup:files:drill [-- --report <tệp.json>]`.
# Các bước: restic check (mặc định đọc toàn bộ dữ liệu) → restic restore bản chụp mới nhất (thẻ xc-files) vào THƯ MỤC TẠM →
# scripts/files-s3.ts verify trên đó: sha256 bản mã từng đối tượng khớp manifest + đọc lại qua ĐÚNG đường giải mã của ứng dụng
# (objectStorage.get) ra bản rõ có sha256 khớp manifest (= file_object.sha256) → ghi BACKUP_DIR/files-offsite-drill.json khi ĐẠT.
# Không ghi vào bucket thật (khôi phục thật: docs/ops/runbooks/restore-files.md §B).
# Biến: RESTIC_REPOSITORY, RESTIC_PASSWORD|_FILE|_COMMAND (thiếu → exit 2), khoá giải mã như ứng dụng (DATA_ENCRYPTION_KEYS | KMS_*),
#       BACKUP_DIR (nơi ghi trạng thái), BACKUP_OFFSITE_CHECK_SUBSET (mặc định `all`), RESTIC_BIN.
# Stdout: một đối tượng JSON; tiến trình ở stderr. Không in mật khẩu/khoá.
# Exit: 0 khớp hết · 1 lệch dữ liệu/không đọc được · 2 cấu hình sai/thiếu mật khẩu · 3 kho off-site hỏng hoặc không mở/khôi phục được.
set -euo pipefail
umask 077
export LC_ALL=C
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/restic-env.sh
source "$ROOT/scripts/lib/restic-env.sh"

log() { echo "restore-files-drill: $*" >&2; }
die() {
  local code="$1"
  shift
  echo "restore-files-drill: $*" >&2
  exit "$code"
}

REPORT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --report)
      [ $# -ge 2 ] || die 2 "--report cần đường dẫn tệp"
      REPORT="$2"
      shift 2
      ;;
    *) die 2 "tham số lạ: $1" ;;
  esac
done
REPO="${RESTIC_REPOSITORY:-}"
[ -n "$REPO" ] || die 2 "thiếu RESTIC_REPOSITORY"
if xc_repo_has_embedded_secret "$REPO"; then die 2 "RESTIC_REPOSITORY không được nhúng mật khẩu/khoá trong URL"; fi
xc_have_repo_password || die 2 "thiếu mật khẩu kho (RESTIC_PASSWORD, RESTIC_PASSWORD_FILE hoặc RESTIC_PASSWORD_COMMAND)"
RESTIC="$(xc_restic_bin "$ROOT")" || die 2 "chưa cài restic — chạy: node scripts/tools/install-tool.mjs install restic"
TSX="$ROOT/node_modules/.bin/tsx"
[ -x "$TSX" ] || die 2 "thiếu tsx (chạy npm ci)"
command -v jq >/dev/null || die 2 "thiếu công cụ: jq"
export RESTIC_CACHE_DIR="${RESTIC_CACHE_DIR:-$ROOT/.data/restic-cache}"
mkdir -p "$RESTIC_CACHE_DIR"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/.data/backups}"
SUBSET="${BACKUP_OFFSITE_CHECK_SUBSET:-all}"
[[ "$SUBSET" =~ ^([0-9]+%|all|[0-9]+/[0-9]+)$ ]] || die 2 "BACKUP_OFFSITE_CHECK_SUBSET dạng 10%, n/t hoặc all"
SAFE_REPO="$(xc_repo_redact "$REPO")"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
now() { date +%s.%N; }
secs() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.2f", b - a }'; }

T0="$(now)"
"$RESTIC" cat config >/dev/null 2>&1 || die 3 "không mở được kho off-site $SAFE_REPO (sai mật khẩu, kho hỏng hoặc không tới được)"
CHECK_ARGS=(--read-data-subset="$SUBSET")
[ "$SUBSET" = "all" ] && CHECK_ARGS=(--read-data)
if ! "$RESTIC" check --quiet "${CHECK_ARGS[@]}" >"$WORK/check.out" 2>&1; then
  head -c 400 "$WORK/check.out" >&2 || true
  die 3 "restic check ĐỎ — kho off-site hỏng; KHÔNG khôi phục từ kho này"
fi
T_CHECK="$(now)"

mkdir -p "$WORK/restored"
"$RESTIC" restore latest --tag xc-files --target "$WORK/restored" --quiet >/dev/null 2>&1 ||
  die 3 "restic restore thất bại (chưa có bản chụp thẻ xc-files?)"
T_RESTORE="$(now)"
mapfile -t found < <(find "$WORK/restored" -name files-manifest.json -type f | LC_ALL=C sort)
[ "${#found[@]}" -eq 1 ] || die 1 "bản chụp phải chứa đúng một files-manifest.json (thấy ${#found[@]})"
SNAP="$(dirname "${found[0]}")"
log "đã khôi phục bản chụp tệp vào thư mục tạm ($(jq -r .objects "${found[0]}") đối tượng)"

set +e
"$TSX" "$ROOT/scripts/files-s3.ts" verify "$SNAP" >"$WORK/verify.json"
RC=$?
set -e
T_VERIFY="$(now)"
OK=false
[ "$RC" -eq 0 ] && OK=true
VERIFY_JSON="$(jq -c . "$WORK/verify.json" 2>/dev/null || echo null)"
OUT="$(jq -n --argjson ok "$OK" --argjson rc "$RC" --arg repo "$SAFE_REPO" --arg kind "$(xc_repo_kind "$REPO")" \
  --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson verify "$VERIFY_JSON" --arg subset "$SUBSET" \
  --arg created "$(jq -r .created_at_utc "${found[0]}")" \
  --argjson chk "$(secs "$T0" "$T_CHECK")" --argjson res "$(secs "$T_CHECK" "$T_RESTORE")" \
  --argjson ver "$(secs "$T_RESTORE" "$T_VERIFY")" --argjson tot "$(secs "$T0" "$T_VERIFY")" '
  { ok: $ok, verify_exit: $rc, repo: $repo, repo_kind: $kind, snapshot_created_utc: $created, check_read_data: $subset,
    seconds: { restic_check: $chk, restic_restore: $res, verify: $ver, total_rto: $tot }, verify: $verify, finished_utc: $now }')"
printf '%s\n' "$OUT"
[ -z "$REPORT" ] || printf '%s\n' "$OUT" >"$REPORT"
if [ "$OK" = "true" ]; then
  mkdir -p "$BACKUP_DIR"
  jq '{format: 1, last_success_utc: .finished_utc, objects: .verify.checked, seconds: .seconds, repo_kind: .repo_kind}' \
    <<<"$OUT" >"$BACKUP_DIR/files-offsite-drill.json.tmp"
  mv "$BACKUP_DIR/files-offsite-drill.json.tmp" "$BACKUP_DIR/files-offsite-drill.json"
  log "ĐẠT — RTO tệp $(secs "$T0" "$T_VERIFY")s"
  exit 0
fi
[ "$RC" -eq 2 ] && die 2 "cấu hình khoá giải mã sai/thiếu (xem lỗi ở trên)"
log "LỆCH — bản khôi phục không khớp/không đọc được (xem verify.problems)"
exit 1
