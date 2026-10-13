#!/usr/bin/env bash
# session-start.sh — SessionStart hook (startup|resume|clear|compact).
# Nạp NGẮN GỌN trạng thái để phiên tiếp tục đúng chỗ: 4 mục của PROGRESS.md (tối đa 8 KB),
# verdict autopilot (từ bằng chứng trên đĩa), git branch/dirty/3 commit, và nhắc đọc AGENTS.md.
# Chỉ đọc, không đổi gì. Fail-open.
set -uo pipefail
. "$(dirname "$0")/_lib.sh"

ctx=""
if [ -f "$XS_ROOT/PROGRESS.md" ]; then
  # Chỉ lấy các mục "Đang làm / Tiếp theo / Quyết định / Bàn giao" (và tiêu đề), cắt 8 KB.
  prog="$(awk '
    /^## /{keep = ($0 ~ /Đang làm|Tiếp theo|Quyết định|Bàn giao|Kế hoạch/)}
    NR==1 || keep {print}
  ' "$XS_ROOT/PROGRESS.md" | head -c 8192)"
  [ -n "$prog" ] || prog="$(head -c 8192 "$XS_ROOT/PROGRESS.md")"
  ctx+="===== PROGRESS.md (trạng thái phiên trước) =====
$prog

"
fi

XS="$(xs_py)" || true
if [ -n "${XS:-}" ] && [ -f "$XS_ROOT/.autopilot/state.json" ]; then
  ctx+="===== Autopilot =====
$(python3 "$XS" loop status 2>/dev/null || echo 'không đọc được trạng thái')

"
fi

if git -C "$XS_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  ctx+="===== Git =====
Branch: $(git -C "$XS_ROOT" branch --show-current 2>/dev/null)
Chưa commit: $(git -C "$XS_ROOT" status --short 2>/dev/null | wc -l | tr -d ' ') file
$(git -C "$XS_ROOT" log --oneline -3 2>/dev/null)

"
fi

ctx+="Luật vận hành: đọc AGENTS.md ở gốc dự án (và .xstored/framework/11-autonomous-loop/README.md khi chạy autopilot). Khi người dùng nhắn \"tiếp tục\": nối tiếp mục Đang làm/Bàn giao ở trên, không hỏi lại điều đã có trong file."

context_output SessionStart "$ctx"
exit 0
