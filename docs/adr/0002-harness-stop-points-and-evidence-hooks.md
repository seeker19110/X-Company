# ADR-0002: Harness `.claude/` — hook fail-open về luồng, fail-closed về hành động nguy hiểm, Stop hook đọc bằng chứng

- **Trạng thái:** Đã chấp nhận
- **Trạng thái triển khai:** Đã triển khai (`.claude/hooks/*.sh`, `.claude/settings.json`, `tests/test_hooks.py`)
- **Ngày:** 2026-10-13

## Bối cảnh

Yêu cầu "khi duyệt rồi thì tự động làm đến khi hoàn thiện, không cần hỏi" chỉ an toàn nếu (a) có **điểm dừng bắt buộc**
được **cưỡng chế bằng máy** chứ không bằng lời dặn trong prompt (catalog `stored` 02 §4b, 12 §3g: "cổng duyệt nằm trong
system prompt không phải là cổng"), và (b) tín hiệu "xong" không do model tự khai (`/goal` của Claude Code chỉ đọc hội
thoại — research `claude-code-hooks-skills.md`).

Ràng buộc kỹ thuật đã xác minh: `permissions.defaultMode: auto/bypassPermissions` bị bỏ qua ở settings dự án; hook
`deny` vẫn chặn ở bypass; Stop hook có trần 8 lần chặn liên tiếp không tool call; `claude -p --bare` bỏ qua hook.

## Quyết định

1. Năm hook bash chỉ phụ thuộc `bash` + `python3`, **fail-open về luồng** (lỗi hook không kẹt phiên) nhưng
   **fail-closed về hành động nguy hiểm**:
   - PreToolUse(Bash): `deny` lệnh phá huỷ (`rm -rf /`, `sudo`, `dd`, `curl|sh`, `git push --force`, `reset --hard`,
     `clean -f`), `ask` hành động đối ngoại/triển khai (`terraform apply`, `npm publish`, `kubectl apply`, push nhánh chính);
     tách lệnh nối trước khi so khớp; khi `git commit` chạy cổng `dev-task.sh gate` đọc `xs.yaml`, đỏ → exit 2.
   - PreToolUse(Edit|Write): `deny` ghi file bí mật; `ask` khi sửa cấu hình cổng/CI/harness/ruleset và migration đã tồn tại
     (chống "làm cổng xanh bằng nới cấu hình").
   - Stop: gọi `xs.py loop hook-stop` — verdict từ `.autopilot/state.json` + `evidence/` + PLAN, không từ lời model.
   - SessionStart: nạp 4 mục PROGRESS (≤ 8 KB) + verdict autopilot + git; PostToolUse: format file vừa sửa.
2. `AGENTS.md` là nguồn sự thật duy nhất cho mọi harness; `CLAUDE.md` chỉ `@AGENTS.md` + phần riêng Claude Code.
3. Lệnh chuẩn của dự án ở `xs.yaml` phẳng (`task: lệnh`); agent không suy diễn lệnh từ văn xuôi.
4. `install.py` copy harness **copy-if-absent** (bản mới ghi `.xstored-new`), không đè cấu hình dự án.

## Lý do

- Hook là lớp duy nhất model không thể "quên": prompt bị compaction, hook thì không.
- `ask` thay vì `deny` cho hành động đối ngoại: người vẫn làm được, chỉ là có mặt lúc quyết.
- Đọc bằng chứng trên đĩa đóng được lỗ hổng "tuyên bố xong sớm" mà mọi harness tự khai đều mắc.

## Các phương án đã cân nhắc

- **Chỉ viết luật trong CLAUDE.md**: rẻ nhưng không cưỡng chế; bị bỏ qua khi context dài. Loại (giữ làm lớp 1).
- **`permissions.deny` trong settings thay hook**: không tách được lệnh nối, không chạy được cổng commit, không hỏi có
  điều kiện. Dùng kèm, không thay thế.
- **Hook bằng Node/jq**: thêm phụ thuộc cho dự án không dùng Node; python3 đã là yêu cầu của `xs.py`.
- **Stop hook tự đếm vòng trong bash**: trùng logic với `xs.py`, khó test; gom vào `xs.py` có unit test.

## Hệ quả

- Tốt: cùng một bộ hook chạy ở repo khung và mọi dự án đích; test bằng payload giả trong CI.
- Xấu/nợ: regex deny/ask có thể có false positive (vd `rm -rf ./build` an toàn nhưng `rm -rf .` bị chặn) — chấp nhận,
  người dùng tự chạy khi cần; danh sách cấu hình cổng cần cập nhật khi thêm công cụ mới.
- Theo dõi: nếu Claude Code đổi schema hook, cập nhật `_lib.sh` một chỗ.
