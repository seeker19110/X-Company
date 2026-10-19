#!/usr/bin/env bash
# restic-env.sh — dùng chung cho backup-offsite.sh / restore-offsite-drill.sh (source, không chạy trực tiếp).

# Nhị phân restic: RESTIC_BIN, rồi .tools/bin/restic (scripts/tools/install-tool.mjs), rồi PATH.
xc_restic_bin() {
  local root="$1"
  if [ -n "${RESTIC_BIN:-}" ]; then echo "$RESTIC_BIN"; return 0; fi
  if [ -x "$root/.tools/bin/restic" ]; then echo "$root/.tools/bin/restic"; return 0; fi
  command -v restic
}

# Loại kho: local (đường dẫn) | sftp | s3 | rest | b2 | azure | gs | swift | rclone | other
xc_repo_kind() {
  case "$1" in
    sftp:*) echo sftp ;;
    s3:*) echo s3 ;;
    rest:*) echo rest ;;
    b2:*) echo b2 ;;
    azure:*) echo azure ;;
    gs:*) echo gs ;;
    swift:*) echo swift ;;
    rclone:*) echo rclone ;;
    local:*) echo local ;;
    /*|./*|../*) echo local ;;
    *) echo other ;;
  esac
}

# Che userinfo `user:pass@` trong URL kho (rest:https://u:p@host/…, s3:https://…); đường dẫn cục bộ giữ nguyên.
xc_repo_redact() {
  printf '%s' "$1" | sed -E 's#(://)[^/@]*@#\1***@#'
}

# URL kho KHÔNG được nhúng khoá/mật khẩu (khoá truy cập đi qua biến môi trường của nhà cung cấp, không qua URL/argv/log).
xc_repo_has_embedded_secret() {
  [[ "$1" =~ ://[^/@]*:[^/@]*@ ]] || [[ "$1" =~ ://[^/@]+@ && "$(xc_repo_kind "$1")" != sftp ]]
}

# Yêu cầu có mật khẩu kho từ env/tệp/lệnh; không bao giờ hỏi tương tác (restic sẽ treo chờ nhập).
xc_have_repo_password() {
  [ -n "${RESTIC_PASSWORD:-}" ] || { [ -n "${RESTIC_PASSWORD_FILE:-}" ] && [ -f "$RESTIC_PASSWORD_FILE" ]; } || [ -n "${RESTIC_PASSWORD_COMMAND:-}" ]
}
