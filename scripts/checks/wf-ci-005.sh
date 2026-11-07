#!/usr/bin/env bash
# Lệnh Kiểm của BLUEPRINT WF-CI-005 (action ghim SHA 40 ký tự kèm chú thích phiên bản; dependabot theo dõi github-actions).
# Tách thành tệp vì guard của khung (3.31) chặn `$(…)` lồng chạy thẳng — nội dung y nguyên lệnh cũ.
set -euo pipefail
cd "$(dirname "$0")/../.."
bad="$(grep -hE "^\s*(- )?uses:" .github/workflows/*.yml | grep -vE "@[0-9a-f]{40} # v[0-9]" || true)"
if [ -n "$bad" ]; then
  printf 'WF-CI-005: action chưa ghim SHA + # vX:\n%s\n' "$bad" >&2
  exit 1
fi
grep -q "package-ecosystem: github-actions" .github/dependabot.yml || {
  echo "WF-CI-005: dependabot chưa theo dõi github-actions" >&2
  exit 1
}
echo "WF-CI-005: đạt"
