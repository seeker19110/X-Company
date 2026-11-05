#!/usr/bin/env bash
# OPS-DEPLOY-003: code bản phát hành trước (N−1) phải chạy được trên schema của nhánh hiện tại (N) — migration chỉ được
# "expand" trong cùng deploy; "contract" (drop/rename) chờ bản sau khi code cũ không còn chạy.
# Cách kiểm: checkout tag bản phát hành gần nhất (`.release-please-manifest.json` → `v<phiên bản>`) vào worktree tạm,
# THAY thư mục migrations/ của nó bằng migrations/ của HEAD (schema N), rồi chạy test DB + HTTP của chính bản đó.
# Test unit không chạm schema nên bỏ qua. Migration cũ phải giữ nguyên byte (append-only) — kiểm trước khi chạy.
# Dùng: scripts/test-prev-release.sh [tag]   (CI: job `test`; cần lịch sử đủ để có tag — checkout fetch-depth: 0)
set -euo pipefail
export TZ=UTC LANG=C.UTF-8

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

TAG="${1:-}"
if [ -z "$TAG" ]; then
  VERSION="$(node -e 'process.stdout.write(require("./.release-please-manifest.json")["."] || "")')"
  if [ -z "$VERSION" ]; then
    echo "[n-1] ✗ .release-please-manifest.json không có phiên bản gốc \".\"" >&2
    exit 2
  fi
  TAG="v$VERSION"
fi
if ! git rev-parse -q --verify "refs/tags/$TAG^{commit}" >/dev/null; then
  echo "[n-1] ✗ không có tag $TAG trong repo (checkout cần fetch-depth: 0 / git fetch --tags)" >&2
  exit 2
fi
if ! git merge-base --is-ancestor "$TAG" HEAD; then
  echo "[n-1] ✗ $TAG không phải tổ tiên của HEAD — không phải bản phát hành trước của nhánh này" >&2
  exit 2
fi

# Append-only: mọi migration của bản trước còn nguyên ở HEAD, cùng nội dung.
bad=0
while IFS= read -r f; do
  if ! git diff --quiet "$TAG" HEAD -- "$f" 2>/dev/null || [ ! -e "$f" ]; then
    echo "[n-1] ✗ migration đã phát hành bị sửa/xoá: $f" >&2
    bad=1
  fi
done < <(git ls-tree --name-only "$TAG" migrations/ | grep -E '\.sql$')
[ "$bad" = 0 ] || exit 1

WT="$(mktemp -d)"
cleanup() {
  git worktree remove --force "$WT/prev" >/dev/null 2>&1 || true
  rm -rf "$WT"
  git worktree prune >/dev/null 2>&1 || true
}
trap cleanup EXIT

git worktree add --detach --quiet "$WT/prev" "$TAG"
rm -rf "$WT/prev/migrations"
cp -R "$ROOT/migrations" "$WT/prev/migrations"
# Công cụ ghim hash (restic, OpenBao) đã cài ở HEAD: dùng chung, không tải lại.
if [ -d "$ROOT/.tools" ]; then ln -s "$ROOT/.tools" "$WT/prev/.tools"; fi
prev_count="$(git ls-tree --name-only "$TAG" migrations/ | grep -cE '\.sql$' || true)"
added=$(($(find "$ROOT/migrations" -maxdepth 1 -name '*.sql' | wc -l) - prev_count))
echo "[n-1] code $TAG ($(git rev-parse --short "$TAG")) trên schema HEAD ($(git rev-parse --short HEAD)): $added migration mới"

cd "$WT/prev"
npm ci --no-audit --no-fund --ignore-scripts >/dev/null
# Chạy bằng with-test-db.sh của HEAD (có DATABASE_URL thì dùng thẳng, không thì dựng cụm tạm).
"$ROOT/scripts/with-test-db.sh" node --import tsx --test --test-concurrency=1 \
  "tests/db/**/*.test.ts" "tests/http/**/*.test.ts"
echo "[n-1] ✓ test DB + HTTP của $TAG xanh trên schema HEAD"
