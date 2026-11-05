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

RESOLVE_ONLY=0
if [ "${1:-}" = "--resolve-only" ]; then RESOLVE_ONLY=1; shift; fi # in tag N−1 rồi thoát (test)
TAG="${1:-}"

# Phiên bản gốc "." trong manifest ở một commit (rỗng nếu không đọc được).
manifest_version() {
  git show "$1:.release-please-manifest.json" 2>/dev/null |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s)["."]||"")}catch{}})'
}
tag_commit() { git rev-parse -q --verify "refs/tags/$1^{commit}" 2>/dev/null || true; }

if [ -z "$TAG" ]; then
  VERSION="$(manifest_version HEAD)"
  if [ -z "$VERSION" ]; then
    echo "[n-1] ✗ .release-please-manifest.json không có phiên bản gốc \".\"" >&2
    exit 2
  fi
  TAG="v$VERSION"
  # Release PR nâng manifest trước khi có tag (tag tạo sau merge); commit phát hành trên main có tag trỏ CHÍNH nó
  # (N trên N). Cả hai ca: bản trước = phiên bản trong manifest của cha thứ nhất (nhánh đích / commit main trước đó).
  head_commit="$(git rev-parse HEAD)"
  if [ "$(tag_commit "$TAG")" = "" ] || [ "$(tag_commit "$TAG")" = "$head_commit" ]; then
    PARENT_VERSION="$(manifest_version HEAD^1)"
    if [ -n "$PARENT_VERSION" ] && [ "v$PARENT_VERSION" != "$TAG" ]; then
      echo "[n-1] $TAG chưa phát hành hoặc là chính HEAD — dùng bản trước v$PARENT_VERSION (manifest của HEAD^1)" >&2
      TAG="v$PARENT_VERSION"
    fi
  fi
fi
if ! git rev-parse -q --verify "refs/tags/$TAG^{commit}" >/dev/null; then
  echo "[n-1] ✗ không có tag $TAG trong repo (checkout cần fetch-depth: 0 / git fetch --tags)" >&2
  exit 2
fi
if ! git merge-base --is-ancestor "$TAG" HEAD; then
  echo "[n-1] ✗ $TAG không phải tổ tiên của HEAD — không phải bản phát hành trước của nhánh này" >&2
  exit 2
fi
if [ "$(tag_commit "$TAG")" = "$(git rev-parse HEAD)" ]; then
  echo "[n-1] ✗ $TAG trỏ chính HEAD — không có bản trước để kiểm (N trên N)" >&2
  exit 2
fi
if [ "$RESOLVE_ONLY" = 1 ]; then
  echo "$TAG"
  exit 0
fi

# Append-only: mọi migration của bản trước còn nguyên ở cây làm việc (thứ thực sự được sao sang), cùng nội dung.
bad=0
while IFS= read -r f; do
  if [ ! -e "$f" ] || ! git diff --quiet "$TAG" -- "$f" 2>/dev/null; then
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
