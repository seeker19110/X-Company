@AGENTS.md

<!-- Claude Code chỉ đọc CLAUDE.md khi có cả hai file; dòng import trên nạp AGENTS.md (nguồn sự thật duy nhất, dùng chung mọi harness). Chỉ thêm vào đây những gì RIÊNG cho Claude Code. -->

## Riêng cho Claude Code
- Hook trong `.claude/settings.json`: SessionStart nạp PROGRESS + trạng thái autopilot; PreToolUse chặn lệnh phá huỷ/`curl|sh`, hỏi khi deploy/publish/push nhánh chính hoặc sửa cấu hình cổng/CI/migration đã có; PostToolUse format file vừa sửa; Stop đọc bằng chứng autopilot (`xs.py loop hook-stop`) để quyết cho dừng hay làm tiếp.
- `permissions.defaultMode` trong settings dự án **bị Claude Code bỏ qua** với `auto`/`bypassPermissions`; muốn chạy không hỏi quyền hãy bật ở settings người dùng hoặc `--permission-mode`. Hook `deny` vẫn chặn kể cả ở bypass.
- Skill gọi bằng `/autopilot`, `/blueprint`, `/gate`, `/research`, `/audit`, `/review`, `/adr`, `/handover` (định nghĩa ở `.claude/skills/*/SKILL.md`).
- Chạy headless cho CI: **không** dùng `--bare` (mất hook/skill/CLAUDE.md).
