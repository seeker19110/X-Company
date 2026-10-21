#!/usr/bin/env bash
# kms-dev.sh — OpenBao (Transit) TỰ HOST chạy THẬT cục bộ để thử KMS (T-052, D-039; SEC-SECRET-013, DB-SEC-009, CMP-PRIV-007).
# Không phải production: chỉ nghe 127.0.0.1, TLS tự ký (CA = tệp cert.pem trong thư mục trạng thái), niêm phong bằng MỘT khoá mở
# (1 phần/ngưỡng 1) và khoá mở + root token nằm trong thư mục trạng thái (0600) — production dùng nhiều phần khoá chia cho nhiều
# người hoặc auto-unseal (docs/ops/kms-deploy.md). Lưu trữ raft trên đĩa → dừng/chạy lại + mở niêm phong vẫn giữ nguyên khoá và dữ liệu.
#
# Dùng:
#   scripts/kms-dev.sh start [--dir D]        dựng/chạy lại + mở niêm phong; lần đầu: bật audit file, mount transit, tạo khoá xc-data,
#                                             policy xc-app (chỉ encrypt/decrypt/rewrap + đọc khoá) và xc-ops (+ rotate), cấp 2 token
#   scripts/kms-dev.sh stop [--dir D] [--purge]   dừng (--purge: xoá cả thư mục trạng thái)
#   scripts/kms-dev.sh status [--dir D]       exit 0 = đang chạy và đã mở niêm phong
#   scripts/kms-dev.sh seal|unseal [--dir D]  niêm phong/mở niêm phong (mô phỏng sự cố KMS)
#   scripts/kms-dev.sh env [--dir D]          in các dòng `export …` để `eval` (token đọc từ tệp lúc eval — KHÔNG in token)
#   scripts/kms-dev.sh run [--] <lệnh…>       dựng KMS tạm, chạy lệnh với KMS_* trong môi trường (token chỉ ở môi trường của lệnh),
#                                             luôn dừng + xoá thư mục tạm khi xong/lỗi/bị ngắt
# Thư mục trạng thái mặc định: .data/kms-dev (gitignore) hoặc KMS_DEV_DIR. Nhị phân: .tools/bin/bao (scripts/tools/install-tool.mjs).
# Exit: 0 xong · 1 lỗi chạy · 2 thiếu công cụ/tham số sai.
set -euo pipefail
umask 077
export LC_ALL=C
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BAO="${BAO_BIN:-$ROOT/.tools/bin/bao}"
KEY_NAME="${KMS_DEV_KEY:-xc-data}"

die() {
  local code="$1"
  shift
  echo "kms-dev: $*" >&2
  exit "$code"
}
log() { echo "kms-dev: $*" >&2; }

for tool in curl jq openssl; do command -v "$tool" >/dev/null || die 2 "thiếu công cụ: $tool"; done
[ -x "$BAO" ] || die 2 "chưa cài OpenBao ($BAO) — chạy: node scripts/tools/install-tool.mjs install openbao"

CMD="${1:-}"
[ -n "$CMD" ] || die 2 "dùng: kms-dev.sh start|stop|status|seal|unseal|env|run …"
shift
DIR="${KMS_DEV_DIR:-$ROOT/.data/kms-dev}"
PURGE=0
RUN_ARGS=()
if [ "$CMD" = "run" ]; then
  [ "${1:-}" = "--" ] && shift
  [ $# -gt 0 ] || die 2 "run cần lệnh để chạy"
  RUN_ARGS=("$@")
else
  while [ $# -gt 0 ]; do
    case "$1" in
      --dir) DIR="${2:-}"; shift 2 ;;
      --purge) PURGE=1; shift ;;
      *) die 2 "tham số lạ: $1" ;;
    esac
  done
fi

port_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
alive() { [ -f "$DIR/pid" ] && kill -0 "$(cat "$DIR/pid")" 2>/dev/null; }
addr() { echo "https://127.0.0.1:$(cat "$DIR/port")"; }

# api <phương thức> <đường dẫn> [tệp JSON thân] [tệp tiêu đề token]: in thân phản hồi; mã HTTP ≥ 400 → trả 1.
# Token luôn đi qua TỆP tiêu đề (curl -H @tệp) — không bao giờ nằm trong argv (ps).
api() {
  local method="$1" path="$2" body="${3:-}" hdr="${4:-}" code
  local args=(-sS --max-time 20 --cacert "$DIR/tls/cert.pem" -X "$method" -o "$DIR/.resp" -w '%{http_code}')
  [ -n "$hdr" ] && args+=(-H "@$hdr")
  [ -n "$body" ] && args+=(-H 'content-type: application/json' --data "@$body")
  code="$(curl "${args[@]}" "$(addr)/v1/$path" 2>/dev/null)" || return 1
  cat "$DIR/.resp"
  if [ "$code" -ge 400 ]; then
    echo "kms-dev: HTTP $code $path: $(head -c 300 "$DIR/.resp")" >&2
    rm -f "$DIR/.resp"
    return 1
  fi
  rm -f "$DIR/.resp"
}
# token_header <tên tệp token|root> → in đường dẫn tệp tiêu đề tạm
token_header() {
  local h="$DIR/.hdr.$$"
  if [ "$1" = "root" ]; then
    printf 'X-Vault-Token: %s\n' "$(jq -r .root_token "$DIR/init.json")" >"$h"
  else
    printf 'X-Vault-Token: %s\n' "$(cat "$DIR/$1")" >"$h"
  fi
  echo "$h"
}
json_file() {
  local f="$DIR/.body.$$.$RANDOM"
  printf '%s' "$1" >"$f"
  echo "$f"
}
cleanup_tmp() { rm -f "$DIR"/.hdr.* "$DIR"/.body.* "$DIR/.resp" 2>/dev/null || true; }
# Sau unseal, raft một node còn phải tự bầu leader rồi mới thành active; gọi API ghi trước lúc đó → HTTP 500 "internal
# error" (runner CI chậm). Chờ sys/health = 200 (đã init, mở niêm phong, active); 429/5xx = chưa sẵn sàng.
wait_active() {
  local code=000
  for _ in $(seq 1 150); do
    alive || die 1 "OpenBao dừng khi chờ active"
    code="$(curl -s --max-time 2 --cacert "$DIR/tls/cert.pem" -o /dev/null -w '%{http_code}' "$(addr)/v1/sys/health" 2>/dev/null)" || code=000
    [ "$code" = "200" ] && return 0
    sleep 0.2
  done
  die 1 "OpenBao chưa active sau 30 giây (sys/health=$code)"
}

write_config() {
  cat >"$DIR/config.hcl" <<HCL
storage "raft" {
  path    = "$DIR/data"
  node_id = "xc-kms-dev"
}
listener "tcp" {
  address         = "127.0.0.1:$PORT"
  cluster_address = "127.0.0.1:$((PORT + 1))"
  tls_cert_file   = "$DIR/tls/cert.pem"
  tls_key_file    = "$DIR/tls/key.pem"
}
api_addr      = "https://127.0.0.1:$PORT"
cluster_addr  = "https://127.0.0.1:$((PORT + 1))"
disable_mlock = true
ui            = false
log_level     = "warn"
# Audit device khai báo trong cấu hình (OpenBao ≥ 2.5 không cho bật qua API); băm giá trị nhạy cảm bằng HMAC, không ghi bản rõ.
audit "file" "file" {
  description = "xc-kms-dev"
  options {
    file_path = "$DIR/audit.log"
  }
}
HCL
}

policy_json() { # <khoá> <có rotate: 0|1>
  jq -nc --arg k "$1" --argjson rot "$2" '{policy: (
    "path \"transit/encrypt/" + $k + "\" { capabilities = [\"update\"] }\n" +
    "path \"transit/decrypt/" + $k + "\" { capabilities = [\"update\"] }\n" +
    "path \"transit/rewrap/" + $k + "\" { capabilities = [\"update\"] }\n" +
    "path \"transit/keys/" + $k + "\" { capabilities = [\"read\"] }\n" +
    (if $rot == 1 then "path \"transit/keys/" + $k + "/rotate\" { capabilities = [\"update\"] }\n" else "" end))}'
}

setup_first() {
  local h b
  h="$(token_header root)"
  b="$(json_file '{"type":"transit"}')"
  api POST sys/mounts/transit "$b" "$h" >/dev/null || die 1 "không mount được transit"
  b="$(json_file '{"type":"aes256-gcm96"}')"
  api POST "transit/keys/$KEY_NAME" "$b" "$h" >/dev/null || die 1 "không tạo được khoá $KEY_NAME"
  # Policy tối thiểu cho ỨNG DỤNG: chỉ encrypt/decrypt/rewrap + đọc siêu dữ liệu khoá (latest_version). KHÔNG rotate/xoá/xuất khoá.
  b="$(json_file "$(policy_json "$KEY_NAME" 0)")"
  api PUT sys/policies/acl/xc-app "$b" "$h" >/dev/null || die 1 "không tạo được policy xc-app"
  b="$(json_file "$(policy_json "$KEY_NAME" 1)")"
  api PUT sys/policies/acl/xc-ops "$b" "$h" >/dev/null || die 1 "không tạo được policy xc-ops"
  local who
  for who in app ops; do
    b="$(json_file "{\"policies\":[\"xc-$who\"],\"no_default_policy\":true,\"ttl\":\"768h\",\"renewable\":false,\"display_name\":\"xc-$who\"}")"
    api POST auth/token/create "$b" "$h" | jq -r .auth.client_token >"$DIR/$who.token"
    [ -s "$DIR/$who.token" ] || die 1 "không cấp được token $who"
    chmod 600 "$DIR/$who.token"
  done
}

do_stop() {
  local purge="${1:-$PURGE}"
  if alive; then
    local pid
    pid="$(cat "$DIR/pid")"
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 50); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.2
    done
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$DIR/pid"
  cleanup_tmp
  if [ "$purge" = "1" ]; then rm -rf "$DIR"; fi
}

do_start() {
  mkdir -p "$DIR" "$DIR/tls" "$DIR/data"
  chmod 700 "$DIR"
  local first=0
  if alive; then
    log "đã chạy ($(addr))"
  else
    if [ ! -f "$DIR/tls/cert.pem" ]; then
      openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 30 -subj "/CN=localhost" \
        -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" -keyout "$DIR/tls/key.pem" -out "$DIR/tls/cert.pem" 2>/dev/null ||
        die 1 "không tạo được chứng chỉ TLS tự ký"
    fi
    PORT=""
    if [ -f "$DIR/port" ] && port_free "$(cat "$DIR/port")" && port_free "$(($(cat "$DIR/port") + 1))"; then
      PORT="$(cat "$DIR/port")"
    fi
    if [ -z "$PORT" ]; then
      local cand
      for _ in $(seq 1 30); do
        cand=$(((RANDOM % 9000) + 30000))
        if port_free "$cand" && port_free "$((cand + 1))"; then
          PORT="$cand"
          break
        fi
      done
    fi
    [ -n "$PORT" ] || die 1 "không tìm được cổng trống"
    echo "$PORT" >"$DIR/port"
    write_config
    # Môi trường tối thiểu: bao in TÊN mọi biến môi trường ở banner khởi động; không đưa môi trường của dự án vào tiến trình KMS.
    env -i PATH="$PATH" HOME="$DIR" setsid "$BAO" server -config="$DIR/config.hcl" >"$DIR/server.log" 2>&1 &
    echo $! >"$DIR/pid"
    local ok=0
    for _ in $(seq 1 100); do
      alive || break
      if curl -sS --max-time 2 --cacert "$DIR/tls/cert.pem" -o /dev/null "$(addr)/v1/sys/health" 2>/dev/null; then
        ok=1
        break
      fi
      sleep 0.2
    done
    if [ "$ok" -ne 1 ]; then
      tail -n 15 "$DIR/server.log" >&2 || true
      do_stop 0
      die 1 "OpenBao không khởi động được (xem log ở trên)"
    fi
  fi
  if [ ! -f "$DIR/init.json" ]; then
    local b
    b="$(json_file '{"secret_shares":1,"secret_threshold":1}')"
    api PUT sys/init "$b" >"$DIR/init.json" || die 1 "init thất bại"
    chmod 600 "$DIR/init.json"
    first=1
  fi
  if [ "$(api GET sys/seal-status | jq -r .sealed)" = "true" ]; then
    local b
    b="$(json_file "$(jq -c '{key: .keys_base64[0]}' "$DIR/init.json")")"
    api PUT sys/unseal "$b" >/dev/null || die 1 "mở niêm phong thất bại"
    wait_active
  fi
  if [ "$first" = "1" ]; then setup_first; fi
  cleanup_tmp
  log "sẵn sàng addr=$(addr) ca=$DIR/tls/cert.pem key=$KEY_NAME (token ở $DIR/*.token, không in)"
}

print_env() {
  printf '%s\n' \
    "export KMS_PROVIDER=transit" \
    "export KMS_TRANSIT_ADDR='$(addr)'" \
    "export KMS_TRANSIT_KEY='$KEY_NAME'" \
    "export NODE_EXTRA_CA_CERTS='$DIR/tls/cert.pem'" \
    "export KMS_TRANSIT_TOKEN=\"\$(cat '$DIR/app.token')\"" \
    "# Token vận hành (rotate): KMS_TRANSIT_TOKEN=\"\$(cat '$DIR/ops.token')\" npm run -s crypto:rotate -- --kms-rotate"
}

case "$CMD" in
  start) do_start ;;
  stop) do_stop ;;
  status) alive && [ "$(api GET sys/seal-status | jq -r .sealed 2>/dev/null)" = "false" ] ;;
  seal)
    alive || die 1 "KMS không chạy"
    h="$(token_header root)"
    api PUT sys/seal "" "$h" >/dev/null || die 1 "niêm phong thất bại"
    cleanup_tmp
    ;;
  unseal)
    alive || die 1 "KMS không chạy"
    b="$(json_file "$(jq -c '{key: .keys_base64[0]}' "$DIR/init.json")")"
    api PUT sys/unseal "$b" >/dev/null || die 1 "mở niêm phong thất bại"
    wait_active
    cleanup_tmp
    ;;
  env)
    [ -f "$DIR/port" ] || die 1 "chưa có KMS ở $DIR (chạy start)"
    print_env
    ;;
  run)
    DIR="$(mktemp -d "${TMPDIR:-/tmp}/xc-kms-run.XXXXXX")"
    trap 'do_stop 1' EXIT
    trap 'exit 130' INT TERM
    do_start
    set +e
    # Token chỉ đưa vào môi trường của lệnh con (không in, không ghi log chung).
    (
      export KMS_PROVIDER=transit KMS_TRANSIT_ADDR="$(addr)" KMS_TRANSIT_KEY="$KEY_NAME" \
        NODE_EXTRA_CA_CERTS="$DIR/tls/cert.pem" KMS_DEV_DIR="$DIR"
      KMS_TRANSIT_TOKEN="$(cat "$DIR/app.token")"
      KMS_TRANSIT_OPS_TOKEN="$(cat "$DIR/ops.token")"
      export KMS_TRANSIT_TOKEN KMS_TRANSIT_OPS_TOKEN
      "${RUN_ARGS[@]}"
    )
    rc=$?
    set -e
    exit "$rc"
    ;;
  *) die 2 "lệnh lạ: $CMD" ;;
esac
