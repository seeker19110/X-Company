#!/usr/bin/env bash
# pre-edit-guard.sh — PreToolUse hook (matcher: Edit|Write|MultiEdit).
# Chống "làm cổng xanh bằng cách nới cấu hình" (stored 12 §3, 23 §4.3):
#  - ASK khi sửa file cấu hình cổng/CI/quyền (workflow, lint/type/coverage config, settings của harness, ruleset).
#  - ASK khi sửa migration ĐÃ TỒN TẠI (migration đã áp thì không được sửa — tạo migration mới).
#  - DENY ghi file bí mật (.env*, *.pem, *.key, secrets/).
# Luôn cho phép tạo file MỚI trong thư mục migration (đó là cách đúng).
set -uo pipefail
. "$(dirname "$0")/_lib.sh"

payload="$(cat)"
path="$(json_field "$payload" tool_input.file_path)"
[ -n "$path" ] || exit 0
rel="${path#"$XS_ROOT"/}"

case "$rel" in
  .env|.env.*|*/.env|*/.env.*|*.pem|*.key|*.p12|*.pfx|secrets/*|*/secrets/*|*id_rsa*|*id_ed25519*)
    pretool_decision deny "Không ghi file bí mật qua agent: $rel (dùng secret manager/biến môi trường)." ;;
esac

case "$rel" in
  .github/workflows/*|.github/rulesets/*|.github/dependabot.yml|\
  .claude/settings.json|.claude/settings.local.json|.claude/hooks/*|\
  .xstored/*|\
  eslint.config.*|.eslintrc*|biome.json*|.oxlintrc*|tsconfig*.json|jsconfig*.json|\
  vitest.config.*|jest.config.*|playwright.config.*|lighthouserc*|.lighthouserc*|\
  pyproject.toml|setup.cfg|mypy.ini|pyrightconfig.json|ruff.toml|.coveragerc|codecov.yml|.codecov.yml|\
  .pre-commit-config.yaml|.husky/*|lefthook.yml|.lintstagedrc*|commitlint.config.*|\
  xs.yaml|scripts/dev-task.sh|Makefile|justfile|.gitleaks.toml|.gitleaksignore|.semgrep*|sonar-project.properties)
    pretool_decision ask "Sửa cấu hình cổng/CI/harness ($rel). Khung coi đây là điểm dừng: nói rõ lý do trước khi nới hàng rào." ;;
esac

# Migration đã tồn tại → ask; file mới trong thư mục migration → cho qua.
case "$rel" in
  *migrations/*|*migration/*|*/migrate/*|db/schema.*|prisma/schema.prisma)
    if [ -f "$path" ]; then
      pretool_decision ask "Sửa migration/schema ĐÃ TỒN TẠI ($rel). Migration đã áp không được sửa — tạo migration mới. Nếu chưa áp ở đâu, xác nhận rồi tiếp."
    fi ;;
esac
exit 0
