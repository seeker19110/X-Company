#!/usr/bin/env bash
# pre-bash-guard.sh — PreToolUse hook (matcher: Bash). Ba việc, theo thứ tự:
#  1) DENY lệnh phá huỷ / không đảo ngược (deny chặn cả ở bypassPermissions).
#  2) ASK lệnh "hành động đối ngoại" hoặc nới hàng rào (điểm dừng bắt buộc của khung — 11-autonomous-loop).
#  3) Khi là `git commit`: chạy cổng chất lượng qua scripts/dev-task.sh gate; đỏ → chặn (exit 2).
# Tách lệnh nối (; && | ||) TRƯỚC khi so khớp để không bị né bằng "ls; rm -rf /" (stored 12 §4 quy tắc 6).
set -uo pipefail
. "$(dirname "$0")/_lib.sh"

payload="$(cat)"
cmd="$(json_field "$payload" tool_input.command)"
[ -n "$cmd" ] || exit 0

# curl|sh / wget|sh phải kiểm trên CHUỖI GỐC (vì bước tách bên dưới cắt ở dấu |).
if printf '%s' "$cmd" | grep -Eq '(curl|wget)[^|]*\|[[:space:]]*(sudo[[:space:]]+)?(ba|z|da)?sh([[:space:]]|$)'; then
  pretool_decision deny "Cấm cài qua curl|sh (chuỗi cung ứng): tải về, kiểm checksum rồi mới chạy. Lệnh: $cmd"
fi

# Tách thành từng lệnh con, bỏ khoảng trắng đầu.
mapfile -t parts < <(printf '%s' "$cmd" | sed -E 's/\|\||&&|;|\|/\n/g' | sed -E 's/^[[:space:]]+//')

for p in "${parts[@]}"; do
  [ -n "$p" ] || continue
  # ---- 1) DENY ---------------------------------------------------------------
  if printf '%s' "$p" | grep -Eq '^(sudo[[:space:]]|rm[[:space:]]+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)[[:space:]]+(/|~|\$HOME|\.\.|\*|\.)([[:space:]]|$)|dd[[:space:]]+if=|mkfs|chmod[[:space:]]+(-R[[:space:]]+)?777|curl[^|]*\|[[:space:]]*(ba)?sh|wget[^|]*\|[[:space:]]*(ba)?sh)'; then
    pretool_decision deny "Lệnh bị khung chặn (phá huỷ/không đảo ngược hoặc curl|sh): $p"
  fi
  if printf '%s' "$p" | grep -Eq '^git[[:space:]]+(push[[:space:]].*(--force|-f([[:space:]]|$)|\+[a-zA-Z])|reset[[:space:]]+--hard|clean[[:space:]]+-[a-zA-Z]*[fdx]|branch[[:space:]]+-D[[:space:]]+(main|master)|checkout[[:space:]]+--[[:space:]]+\.)'; then
    # --force-with-lease trên nhánh của CHÍNH mình vẫn cần người xác nhận (P8: đảo ngược được).
    pretool_decision deny "Git phá lịch sử/làm mất thay đổi bị khung chặn: $p. Muốn làm thật thì người dùng tự chạy."
  fi
  # ---- 2) ASK — hành động đối ngoại / nới hàng rào -----------------------------
  if printf '%s' "$p" | grep -Eq '^(gh[[:space:]]+(release|repo[[:space:]]+delete|secret|pr[[:space:]]+merge)|npm[[:space:]]+publish|pnpm[[:space:]]+publish|yarn[[:space:]]+publish|twine[[:space:]]+upload|cargo[[:space:]]+publish|docker[[:space:]]+push|kubectl[[:space:]]+(apply|delete)|terraform[[:space:]]+(apply|destroy)|tofu[[:space:]]+(apply|destroy)|pulumi[[:space:]]+(up|destroy)|vercel[[:space:]]+(--prod|deploy)|fly[[:space:]]+deploy|aws[[:space:]]|gcloud[[:space:]]|az[[:space:]])'; then
    pretool_decision ask "Hành động đối ngoại/triển khai thật (điểm dừng bắt buộc của khung): $p"
  fi
  if printf '%s' "$p" | grep -Eq '(^|[[:space:]])(git[[:space:]]+push[[:space:]]+[^[:space:]]+[[:space:]]+(main|master)([[:space:]]|$)|git[[:space:]]+push[[:space:]]+(origin[[:space:]]+)?(HEAD:)?(main|master)([[:space:]]|$))'; then
    pretool_decision ask "Push thẳng nhánh chính — khung yêu cầu đi qua PR: $p"
  fi
done

# ---- 3) Cổng trước commit ------------------------------------------------------
if printf '%s' "$cmd" | grep -Eq '(^|[^-])git[[:space:]]+([^|&;]*[[:space:]])?commit([[:space:]]|$)'; then
  if printf '%s' "$cmd" | grep -Eq '(--no-verify|[[:space:]]-n[[:space:]]|--no-gate)'; then
    echo "[pre-bash-guard] --no-verify → bỏ qua cổng commit (ghi lý do vào commit message)." >&2
    exit 0
  fi
  gate=""
  for g in "$XS_ROOT/scripts/dev-task.sh" "$XS_ROOT/.xstored/scripts/dev-task.sh"; do
    [ -x "$g" ] && { gate="$g"; break; }
  done
  if [ -n "$gate" ]; then
    if ! "$gate" gate; then
      echo "❌ Cổng trước commit ĐỎ (build/typecheck/lint/test). Sửa rồi commit lại; bỏ qua có chủ đích: --no-verify." >&2
      exit 2
    fi
  fi
  # Nhắc (không chặn) khi diff lớn: cổng máy chỉ bắt lỗi cú pháp, không bắt lỗi logic.
  lines="$(git -C "$XS_ROOT" diff --cached --numstat 2>/dev/null | awk '{a+=$1; d+=$2} END{print a+d+0}')"
  files="$(git -C "$XS_ROOT" diff --cached --name-only 2>/dev/null | grep -c . || true)"
  if [ "${lines:-0}" -ge 300 ] || [ "${files:-0}" -ge 10 ]; then
    echo "💡 Diff staged lớn (${files} file, ~${lines} dòng). Cân nhắc chia nhỏ commit hoặc chạy /review trước." >&2
  fi
fi
exit 0
