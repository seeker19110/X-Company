#!/usr/bin/env bash
# restore-offsite-drill.sh — diễn tập khôi phục TỪ KHO OFF-SITE (restic) rồi chạy scripts/restore-drill.sh trên bản khôi phục
# (OPS-DR-003/004/007, DB-BACKUP-004; D-040). Chạy: `npm run -s backup:offsite:drill [-- --report <tệp.json>]`.
# Các bước: restic check (cấu trúc + đọc dữ liệu) → restic restore bản mới nhất (thẻ xc-db) vào thư mục tạm → restore-drill.sh trên đó
# (checksum, giải mã, pg_restore vào DB tạm, số dòng mọi bảng, chuỗi audit) → đo thời gian từng bước → ghi BACKUP_DIR/offsite-drill.json
# (khi ĐẠT; cảnh báo `XCLocalOffsiteDrillStale` đọc tệp này). Kho hỏng (cắt cụt/sửa khối) → restic check đỏ → drill ĐỎ (exit 3).
# Biến: RESTIC_REPOSITORY, RESTIC_PASSWORD|_FILE|_COMMAND (thiếu → exit 2), DATABASE_URL, BACKUP_PASSPHRASE (nếu bản mã hoá),
#       BACKUP_DIR (nơi ghi trạng thái), BACKUP_OFFSITE_CHECK_SUBSET (mặc định `all` cho drill), RESTIC_BIN.
# Stdout: một đối tượng JSON; tiến trình ở stderr. Không in mật khẩu/DATABASE_URL.
# Exit: 0 khớp hết · 1 lệch dữ liệu · 2 cấu hình sai/thiếu mật khẩu · 3 kho off-site hỏng (restic check đỏ) hoặc không mở được kho.
set -euo pipefail
umask 077
export LC_ALL=C
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/restic-env.sh
source "$ROOT/scripts/lib/restic-env.sh"

log() { echo "restore-offsite-drill: $*" >&2; }
die() {
  local code="$1"
  shift
  echo "restore-offsite-drill: $*" >&2
  exit "$code"
}

REPORT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --report) REPORT="${2:-}"; shift 2 ;;
    *) die 2 "tham số lạ: $1" ;;
  esac
done
REPO="${RESTIC_REPOSITORY:-}"
[ -n "$REPO" ] || die 2 "thiếu RESTIC_REPOSITORY"
xc_repo_has_embedded_secret "$REPO" && die 2 "RESTIC_REPOSITORY không được nhúng mật khẩu/khoá trong URL"
xc_have_repo_password || die 2 "thiếu mật khẩu kho (RESTIC_PASSWORD, RESTIC_PASSWORD_FILE hoặc RESTIC_PASSWORD_COMMAND)"
RESTIC="$(xc_restic_bin "$ROOT")" || die 2 "chưa cài restic — chạy: node scripts/tools/install-tool.mjs install restic"
command -v jq >/dev/null || die 2 "thiếu công cụ: jq"
[ -n "${DATABASE_URL:-}" ] || die 2 "thiếu DATABASE_URL"
export RESTIC_CACHE_DIR="${RESTIC_CACHE_DIR:-$ROOT/.data/restic-cache}"
mkdir -p "$RESTIC_CACHE_DIR"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/.data/backups}"
SUBSET="${BACKUP_OFFSITE_CHECK_SUBSET:-all}"
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
log "restic check xanh ($SUBSET)"

mkdir -p "$WORK/restored"
"$RESTIC" restore latest --tag xc-db --target "$WORK/restored" --quiet >/dev/null 2>&1 || die 3 "restic restore thất bại"
T_RESTORE="$(now)"
mapfile -t found < <(find "$WORK/restored" -name 'xc-*.manifest.json' | LC_ALL=C sort)
[ "${#found[@]}" -ge 1 ] || die 1 "snapshot không chứa manifest sao lưu"
MAN="${found[${#found[@]} - 1]}"
RDIR="$(dirname "$MAN")"
log "đã khôi phục từ off-site: $(basename "$MAN")"

# Bản khôi phục phải GIỐNG HỆT bản cục bộ (nếu còn): so sha256 từng tệp.
LOCAL_MATCH=null
BASE="$(basename "$MAN" .manifest.json)"
if [ -f "$BACKUP_DIR/$BASE.manifest.json" ]; then
  LOCAL_MATCH=true
  for f in "$BASE.manifest.json" "$BASE.sha256" "$(jq -r .file "$MAN")"; do
    [ -f "$BACKUP_DIR/$f" ] && [ "$(sha256sum <"$BACKUP_DIR/$f")" = "$(sha256sum <"$RDIR/$f")" ] || LOCAL_MATCH=false
  done
fi

set +e
BACKUP_DIR="$RDIR" "$ROOT/scripts/restore-drill.sh" --file "$MAN" >"$WORK/drill.json" 2>"$WORK/drill.err"
RC=$?
set -e
cat "$WORK/drill.err" >&2
T_DRILL="$(now)"
OK=false
[ "$RC" -eq 0 ] && OK=true
DRILL_JSON="$(jq -c . "$WORK/drill.json" 2>/dev/null || echo null)"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
OUT="$(jq -n --argjson ok "$OK" --argjson rc "$RC" --arg repo "$SAFE_REPO" --arg kind "$(xc_repo_kind "$REPO")" --arg now "$NOW" \
  --arg manifest "$(basename "$MAN")" --argjson local_match "$LOCAL_MATCH" --argjson drill "$DRILL_JSON" --arg subset "$SUBSET" \
  --argjson chk "$(secs "$T0" "$T_CHECK")" --argjson res "$(secs "$T_CHECK" "$T_RESTORE")" \
  --argjson dr "$(secs "$T_RESTORE" "$T_DRILL")" --argjson tot "$(secs "$T0" "$T_DRILL")" '
  { ok: $ok, drill_exit: $rc, repo: $repo, repo_kind: $kind, backup: $manifest, matches_local_copy: $local_match,
    check_read_data: $subset, seconds: { restic_check: $chk, restic_restore: $res, restore_drill: $dr, total_rto: $tot },
    drill: $drill, finished_utc: $now }')"
printf '%s\n' "$OUT"
[ -z "$REPORT" ] || printf '%s\n' "$OUT" >"$REPORT"
if [ "$OK" = "true" ] && [ "$LOCAL_MATCH" != "false" ]; then
  mkdir -p "$BACKUP_DIR"
  jq '{format: 1, last_success_utc: .finished_utc, backup: .backup, seconds: .seconds, repo_kind: .repo_kind}' <<<"$OUT" >"$BACKUP_DIR/offsite-drill.json.tmp"
  mv "$BACKUP_DIR/offsite-drill.json.tmp" "$BACKUP_DIR/offsite-drill.json"
  log "ĐẠT — RTO off-site $(secs "$T0" "$T_DRILL")s"
  exit 0
fi
[ "$LOCAL_MATCH" = "false" ] && echo "restore-offsite-drill: LỆCH — bản khôi phục khác bản cục bộ" >&2
exit 1
