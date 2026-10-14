#!/usr/bin/env bash
# pre-bash-guard.sh — PreToolUse hook (matcher: Bash). Ba việc, theo thứ tự:
#  1) DENY lệnh phá huỷ / không đảo ngược (deny chặn cả ở bypassPermissions).
#  2) ASK lệnh "hành động đối ngoại", nới hàng rào, ghi file cổng/bí mật qua Bash (điểm dừng bắt buộc — 11-autonomous-loop).
#  3) Khi là `git commit`: chạy cổng chất lượng qua dev-task.sh gate; đỏ → chặn (exit 2).
# Phân tích lệnh nằm ở guard.py (tách theo token shell, chuẩn hoá wrapper/tuỳ chọn git — audit AUD-SEC-001…010).
# Payload đi qua stdin, không qua argv. guard.py lỗi/thiếu python3 → cho qua (fail-open về luồng).
set -uo pipefail
. "$(dirname "$0")/_lib.sh"

payload="$(cat)"
res="$(printf '%s' "$payload" | CLAUDE_PROJECT_DIR="$XS_ROOT" python3 "$(dirname "$0")/guard.py" bash 2>/dev/null)" || exit 0
[ -n "$res" ] || exit 0
decision="$(json_field "$res" decision)"
if [ "$decision" = "deny" ] || [ "$decision" = "ask" ]; then
  pretool_decision "$decision" "$(json_field "$res" reason)"
fi

# ---- 3) Cổng trước commit ------------------------------------------------------
if [ "$(json_field "$res" commit)" = "true" ]; then
  gate=""
  for g in "$XS_ROOT/scripts/dev-task.sh" "$XS_ROOT/.xstored/scripts/dev-task.sh"; do
    [ -x "$g" ] && { gate="$g"; break; }
  done
  if [ -n "$gate" ]; then
    if ! CLAUDE_PROJECT_DIR="$XS_ROOT" "$gate" gate; then
      echo "❌ Cổng trước commit ĐỎ (build/typecheck/lint/test). Sửa rồi commit lại." >&2
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
