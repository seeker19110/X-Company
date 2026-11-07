#!/usr/bin/env bash
# Lệnh Kiểm của BLUEPRINT WF-CI-004 (workflow không đọc dữ liệu PR không tin cậy vào biểu thức/shell). Tách thành tệp vì guard
# của khung (3.31) chặn chuỗi lệnh lồng `$(…)` chạy thẳng (ADR-0063 của khung) — nội dung y nguyên lệnh cũ.
set -euo pipefail
cd "$(dirname "$0")/../.."
mapfile -t F < <(ls .github/workflows/*.yml | grep -v "/pr-steward\.yml$")
if grep -nE "github\.head_ref|pull_request\.(title|body|head\.ref)|github\.event\.(issue|comment)" "${F[@]}"; then
  echo "WF-CI-004: workflow đọc trường PR/issue không tin cậy" >&2
  exit 1
fi
if grep -nE "ref: .*pull_request" .github/workflows/merge-gate.yml; then
  echo "WF-CI-004: merge-gate checkout ref của PR" >&2
  exit 1
fi
# Danh sách an toàn: giá trị do runner/GitHub sinh, hoặc output của chính job trong repo (release-please — không phải dữ liệu
# PR/issue); giá trị vào shell chỉ qua env (`[A-Z_]+:` ở trên), không nội suy thẳng vào `run:`.
bad="$(grep -h "\${{" "${F[@]}" | grep -vE "^\s*(group|[A-Z_]+):" |
  grep -vE '\$\{\{ *(github\.(run_id|sha|run_number)|runner\.(os|temp)|hashFiles\([^)]*\)|!cancelled\(\)|always\(\)|steps\.rp\.outputs\.(release_created|tag_name)|needs\.release-please\.outputs\.release_created == '"'true'"') *\}\}' || true)"
if [ -n "$bad" ]; then
  printf 'WF-CI-004: biểu thức ${{ }} ngoài danh sách an toàn:\n%s\n' "$bad" >&2
  exit 1
fi
echo "WF-CI-004: đạt"
