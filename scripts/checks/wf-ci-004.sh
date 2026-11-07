#!/usr/bin/env bash
# Lệnh Kiểm của BLUEPRINT WF-CI-004 (workflow không đọc dữ liệu PR không tin cậy vào biểu thức/shell). Tách thành tệp vì guard
# của khung (3.31) chặn chuỗi lệnh lồng `$(…)` chạy thẳng (ADR-0063 của khung).
set -euo pipefail
cd "$(dirname "$0")/../.."
mapfile -t F < <(ls .github/workflows/*.yml 2>/dev/null | grep -v "/pr-steward\.yml$" || true)
# Không có workflow để quét = đỏ (grep không tệp sẽ đọc stdin và báo đạt giả — review #100).
[ "${#F[@]}" -gt 0 ] || {
  echo "WF-CI-004: không có workflow *.yml để quét" >&2
  exit 1
}
if grep -nE "github\.head_ref|pull_request\.(title|body|head\.ref)|github\.event\.(issue|comment)" "${F[@]}"; then
  echo "WF-CI-004: workflow đọc trường PR/issue không tin cậy" >&2
  exit 1
fi
if grep -nE "ref: .*pull_request" .github/workflows/merge-gate.yml; then
  echo "WF-CI-004: merge-gate checkout ref của PR" >&2
  exit 1
fi
# Biểu thức an toàn: giá trị do runner/GitHub sinh. Output release-please chỉ được nhận ở dòng khai `outputs:` của job
# (release_created/tag_name:) và điều kiện `if:` so 'true' — giá trị vào shell chỉ qua env (`[A-Z_]+:`), không nội suy vào `run:`.
# XOÁ từng biểu thức an toàn trong dòng rồi mới tìm `${{` còn lại: biểu thức nguy hiểm cùng dòng với biểu thức an toàn không bị che.
SAFE='\$\{\{ *(github\.(run_id|sha|run_number)|runner\.(os|temp)|hashFiles\([^)]*\)|!cancelled\(\)|always\(\)) *\}\}'
bad="$(grep -h "\${{" "${F[@]}" | grep -vE "^\s*(group|[A-Z_]+):" |
  sed -E "s/^(\s*(release_created|tag_name):) *\\\$\{\{ *steps\.rp\.outputs\.(release_created|tag_name) *\}\} *$/\1/" |
  sed -E "s/^(\s*if:) *\\\$\{\{ *needs\.release-please\.outputs\.release_created == 'true' *\}\} *$/\1/" |
  sed -E "s/${SAFE}//g" | grep -F "\${{" || true)"
if [ -n "$bad" ]; then
  printf 'WF-CI-004: biểu thức ${{ }} ngoài danh sách an toàn:\n%s\n' "$bad" >&2
  exit 1
fi
echo "WF-CI-004: đạt"
