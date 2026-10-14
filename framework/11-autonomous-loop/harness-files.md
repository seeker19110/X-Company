---
title: File harness: PLAN · PROGRESS · BLUEPRINT · evidence · state
kind: module
prefix: LOOP-HARNESS
applies_to: [all]
updated: 2026-10-14
---

# File harness: PLAN · PROGRESS · BLUEPRINT · evidence · state

> Harness của khung là **một bộ file trên đĩa** mà cả người, hook và `xs.py` cùng đọc. Module này quy định từng file
> chứa gì, ai được ghi, máy kiểm thế nào, và cái gì commit vào repo. Áp dụng cho mọi dự án chạy agent theo khung.

## Nguyên tắc

1. **Mỗi loại sự thật có một file gốc** (P5): phạm vi chất lượng = `BLUEPRINT.md`; việc = `PLAN.md`; trạng thái phiên =
   `PROGRESS.md`; bằng chứng = `.autopilot/evidence/`; vòng chạy = `.autopilot/state.json`; luật agent = `AGENTS.md`.
2. **Code điền trường "đã làm"**: `exit_code`, `cmd`, `head`, `started/finished` do `xs.py loop record` ghi. Model chỉ
   đổi dấu `[ ]`→`[x]` sau khi code đã ghi bằng chứng (stored 23 §3.1 `verified_by`).
3. **Lệnh chạy không suy diễn từ văn xuôi**: `xs.yaml` (YAML phẳng `task: lệnh`) là nguồn cho `dev-task.sh`, `/gate`
   và Gate của PLAN. Agent từng suy diễn lệnh từ README và bị `unverified` 11 lần liên tiếp (stored 23 §3.3).
4. **Tài liệu trạng thái phải tươi bằng máy**: SHA ghi trong `PROGRESS.md` phải là tổ tiên của HEAD; README chỉ là tuyên bố.
5. **Nhỏ và có cấu trúc**: `PROGRESS.md` ≤ 8 KB, 4 mục; SessionStart chỉ nạp các mục Đang làm/Tiếp theo/Quyết định/Bàn giao.

## Quyết định

### Bộ file và quyền ghi

| File | Chứa gì | Ai ghi | Commit? | Máy kiểm |
|---|---|---|---|---|
| `PROJECT.md` | Vấn đề, người dùng, chỉ số, "không làm" (G0) | Người + agent ở G0 | Có | Cổng G0 có ≥ 1 chỉ số đo được |
| `BLUEPRINT.md` | Mục có ID ghép từ khung (G1) | `xs.py compose` sinh; chỉ đổi trạng thái tick | Có | `blueprint-status --strict` |
| `docs/autopilot/PLAN.md` | Task `T-NNN` + Gate; 4 con số; điểm dừng dự kiến | Agent soạn, **người duyệt** một lần | Có | `parse_plan` (regex `- [ ] \`T-\d{3,}\``, `Gate:`) |
| `PROGRESS.md` | 4 mục: Đang làm · Tiếp theo · Quyết định · Bàn giao phiên | Agent, cuối mỗi task/phiên | Có | ≤ 8 KB; SHA là tổ tiên HEAD |
| `.autopilot/state.json` | `active, plan, blueprint, max_iterations, iterations, deadline, same_failure_count, last_failure_signature, blocked` | `xs.py loop` (ghi atomic qua `.tmp`) | **Không** (gitignore, theo máy) | `loop status` |
| `.autopilot/evidence/T-NNN.json` | `task, cmd, exit_code, started, finished, head, output_tail` (40 dòng) | `xs.py loop record` | Không (bằng chứng cục bộ); bằng chứng chia sẻ = link CI/PR | `loop_verdict` so `cmd` với Gate |
| `xs.yaml` | `lint/test/typecheck/build/format: <lệnh>` | Người/agent ở G5 | Có | `dev-task.sh gate` đọc được |
| `AGENTS.md` (+ `CLAUDE.md` chứa `@AGENTS.md`) | Luật agent, lệnh, cấu trúc, điểm dừng | Người | Có | Script so bản gốc trong `docs/` |
| `.claude/settings.json` + `.claude/hooks/*.sh` | Quyền allow/ask/deny, 4 hook | Người; agent sửa phải qua `ask` | Có | `bash -n`, test hook |
| `docs/adr/`, `docs/SPEC-*.md`, `THREAT-MODEL.md` | Quyết định, đặc tả, mối đe doạ | Agent soạn, người duyệt | Có | Link từ PR `feat:` |
| `TRAPS.md` (tuỳ chọn) | Bẫy đã mắc thật: triệu chứng → cách rà → chốt chặn → ngày/PR | Agent sau mỗi lỗi lặp | Có | Mỗi `fix:` lặp lại phải trỏ TRAPS |

### Định dạng PLAN (parser thật trong `xs.py`)

```markdown
- [ ] `T-001` Dựng CI lint/type/test — Gate: `scripts/dev-task.sh gate`
- [ ] `T-002` API tạo đơn hàng theo SPEC-order — Gate: `python3 -m pytest tests/order -q`
```

Dòng task khớp `^- \[( |x|~)\] \`T-\d{3,}\``; Gate lấy từ `Gate:\s*\`...\`` (chuỗi phải **y nguyên** khi `loop record`).
Mẫu đầy đủ: [`../templates/PLAN.md`](../templates/PLAN.md); PROGRESS: [`../templates/PROGRESS.md`](../templates/PROGRESS.md).

### Context vs memory vs tài liệu

| Loại | Sống ở đâu | Ai sửa | Ví dụ |
|---|---|---|---|
| Context phiên | Cửa sổ model, compaction | Harness | Hội thoại, tool output |
| Trạng thái việc | `PLAN.md`, `PROGRESS.md`, `.autopilot/` | Code + agent | Task nào xong, chữ ký lỗi |
| Memory dài hạn | File trong repo (`docs/`, `TRAPS.md`, ADR) qua đề xuất → người duyệt → ghi | Người duyệt | Quy ước, bẫy, quyết định |
| Tài liệu tham chiếu | `.xstored/framework/` | Chỉ qua PR vào khung | Checklist có ID |

## Checklist

- [ ] `LOOP-HARNESS-001` **MUST** `PLAN.md` dùng đúng cú pháp parser: mỗi task một dòng bắt đầu bằng `- [ ]` rồi mã `T-NNN` trong backtick, việc, và `Gate:` theo sau là lệnh trong backtick; không lồng danh sách con. → Kiểm: `python3 scripts/xs.py loop status` không báo "PLAN không có task"; số task parse được = số dòng `T-`.
- [ ] `LOOP-HARNESS-002` **MUST** Lệnh Gate của mỗi task lấy từ `xs.yaml`/`dev-task.sh` hoặc là lệnh test cụ thể, chạy được trên máy sạch; không ghi "kiểm tay". → Kiểm: `grep -c 'Gate: `' docs/autopilot/PLAN.md` = số task; mỗi Gate chạy được trong CI.
- [ ] `LOOP-HARNESS-003` **MUST** `PLAN.md` ghi 4 con số (trần vòng, giờ, chi phí, hạn) và danh sách điểm dừng bắt buộc dự kiến trước cổng duyệt. → Kiểm: mục "Ngân sách" và "Điểm dừng" tồn tại; giá trị khớp tham số `loop init`.
- [ ] `LOOP-HARNESS-004` **MUST@L** `PROGRESS.md` ≤ 8 KB, đúng 4 mục (Đang làm · Tiếp theo · Quyết định · Bàn giao phiên); lịch sử dài chuyển sang `CHANGELOG.md`/`docs/`. → Kiểm: `xs.py progress-check` exit 0 (≤ 8192 byte, đúng 4 mục theo thứ tự). · Nguồn: stored 23 §2.1
- [ ] `LOOP-HARNESS-005` **MUST@L** Mục Bàn giao ghi SHA commit cuối và nhánh; SHA phải là tổ tiên của HEAD. → Kiểm: `xs.py progress-check` exit 0 trong CI (mọi SHA trong mục Bàn giao là tổ tiên HEAD; checkout `fetch-depth: 0`). · Nguồn: stored 21 §8 điểm 9
- [ ] `LOOP-HARNESS-006` **MUST@L** `.autopilot/` nằm trong `.gitignore`; bằng chứng chia sẻ cho người khác là link CI run/PR, không phải file cục bộ. → Kiểm: `git check-ignore .autopilot/state.json` exit 0; PR có link run CI.
- [ ] `LOOP-HARNESS-007` **MUST@L** `BLUEPRINT.md` được sinh bằng `xs.py compose`, commit ở G1; chữ của mục không bị sửa tay, chỉ đổi trạng thái. → Kiểm: diff với bản `compose` lại chỉ khác cột trạng thái và `— Miễn:`. · Nguồn: 00-method/composition.md
- [ ] `LOOP-HARNESS-008` **MUST** `xs.yaml` khai các khoá `lint`, `test`, `typecheck`, `build` (chuỗi rỗng nếu không áp dụng); agent không suy diễn lệnh từ README. → Kiểm: `scripts/dev-task.sh gate` chạy đúng lệnh khai; `xs.yaml` tồn tại ở gốc. · Nguồn: stored 23 §3.3
- [ ] `LOOP-HARNESS-009` **MUST@L** `CLAUDE.md` chứa dòng `@AGENTS.md` (ngoài code block) vì Claude Code chỉ đọc `AGENTS.md` khi không có `CLAUDE.md`. → Kiểm: `grep -q '^@AGENTS.md' CLAUDE.md`. · Nguồn: Claude Code docs memory
- [ ] `LOOP-HARNESS-010` **SHOULD** Bản gốc `AGENTS.md` giữ thêm trong `docs/` và CI so sánh, vì công cụ dev từng ghi đè file này. → Kiểm: job CI `diff docs/AGENTS.source.md AGENTS.md`. · Nguồn: stored 04 §4
- [ ] `LOOP-HARNESS-011` **SHOULD** File bridge cho harness khác (`GEMINI.md`, `.cursor/rules/*.mdc`, `.github/copilot-instructions.md`) chỉ một dòng trỏ về `AGENTS.md`, không chép nội dung. → Kiểm: mỗi file bridge ≤ 10 dòng và chứa `AGENTS.md`.
- [ ] `LOOP-HARNESS-012` **SHOULD** Mọi hook có biến môi trường tắt có chủ đích và có test; hook fail-open khi thiếu công cụ (jq/python). → Kiểm: `tests/` có test hook; chạy hook với stdin rỗng → exit 0.
- [ ] `LOOP-HARNESS-013` **SHOULD** Bẫy đã mắc thật ghi vào `TRAPS.md` theo mẫu triệu chứng → nguyên nhân → cách rà → chốt chặn → ngày/PR; `fix:` lặp lại phải trỏ tới mục TRAPS. → Kiểm: PR `fix:` có link `TRAPS.md#...` khi lỗi tái phát. · Nguồn: stored 23 §2.4
- [ ] `LOOP-HARNESS-014` **SHOULD** Danh sách tính năng dạng máy đọc (`features.json` hoặc PLAN) chỉ cho phép agent đổi trường trạng thái, không xoá/sửa tiêu chí. → Kiểm: CI diff: số task không giảm; tiêu chí không đổi ngoài cột trạng thái. · Nguồn: Anthropic harness 2025-11-26
- [ ] `LOOP-HARNESS-015` **SHOULD** Bằng chứng chạy thật của mỗi mốc (đầu ra lệnh, ảnh, báo cáo) lưu `docs/bang-chung/<ngày>/`, tách khỏi tuyên bố trong README. → Kiểm: thư mục tồn tại cho mỗi G7; README trỏ tới.
- [ ] `LOOP-HARNESS-016` **MAY** Dùng `preflight`/`init.sh` chạy đầu phiên (cài dep, dev server, smoke test) để agent định vị lại trước khi làm. → Kiểm: `xs.yaml` có khoá `init`; SessionStart gọi được.
- [ ] `LOOP-HARNESS-017` **MAY** Mọi tool cần `jq`/Python được khai trong `AGENTS.md` mục "Công cụ cần có" để phiên cloud không thiếu. → Kiểm: SessionStart hook in cảnh báo khi thiếu.

## Bẫy thường gặp

| Bẫy | Hậu quả | Cách tránh |
|---|---|---|
| Gate trong PLAN khác chuỗi khi `loop record` (thêm cờ, đổi đường dẫn) | verdict `verify` kẹt | Chép nguyên chuỗi; đổi Gate thì sửa PLAN trước |
| PROGRESS phình thành nhật ký 300 dòng, lẫn dự án khác | SessionStart nạp rác, tốn context, sai trạng thái | 4 mục, ≤ 8 KB; lịch sử ra CHANGELOG |
| Có `CLAUDE.md` nhưng không `@AGENTS.md` | Luật trong AGENTS.md không được nạp | Dòng import; CI grep |
| Hai bản copy hàm hook (`_lib.sh` trôi nhau) | Hook sửa một nơi, nơi kia cũ | Một `_lib.sh` dùng chung, test |
| Commit `.autopilot/state.json` | Xung đột, vòng chạy của máy này đè máy kia | gitignore; mỗi máy `loop init` |
| Agent "viết lại" todo/PLAN mỗi vòng | Tốn ~30 % token, mất lịch sử | Chỉ đổi trạng thái; kế hoạch mới = PR sửa PLAN |
| `.framework-dropins`/file sinh để lại trong repo đích | Hook crash, CI đỏ khó hiểu | Script cài có bước dọn; validate repo |

## Cổng tự động

| Công cụ | Lệnh | Đặt ở | Ngưỡng |
|---|---|---|---|
| Parser PLAN | `python3 scripts/xs.py loop status --json` | SessionStart, CI | Không `blocked` vì PLAN |
| Kích thước PROGRESS | `test $(wc -c < PROGRESS.md) -le 8192` | pre-commit, CI | ≤ 8 KB, 4 mục |
| Tươi SHA | `xs.py progress-check` (bên trong: `git merge-base --is-ancestor <SHA> HEAD` cho mọi SHA ở Bàn giao) | cổng `lint` + CI | exit 0 |
| Blueprint | `python3 scripts/xs.py blueprint-status BLUEPRINT.md --strict` | CI, G7 | 0 MUST mở |
| Hợp đồng repo | script `validate_repo` (file bắt buộc, link, `xs.yaml`) | pre-commit + CI | 0 lỗi |
| Hook | `bash -n .claude/hooks/*.sh && python3 -m unittest discover -s tests` | CI | xanh |

## Nguồn

- `scripts/xs.py` (`TASK_RE`, `GATE_RE`, `parse_plan`, `read_evidence`, `write_state`, `project_dir`) và `.claude/hooks/session-start.sh`, `.gitignore` của khung — đọc 2026-10-13.
- Claude Code docs — memory/CLAUDE.md và `AGENTS.md` (chỉ đọc khi không có CLAUDE.md; import `@file`): <https://code.claude.com/docs/en/memory> — theo `research/2026-10-13-claude-code-hooks-skills.md` (xác minh 2026-10-13).
- AGENTS.md (quy ước, không phải schema; >60k dự án; Agentic AI Foundation): <https://agents.md/> — xác minh 2026-10-13.
- Anthropic, *Effective harnesses for long-running agents* (feature list JSON chỉ sửa `passes`, `claude-progress.txt`, `init.sh`): <https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents> — theo research [F].
- `seeker19110/stored` mục 21 §2, §8 điểm 9; mục 23 §2.1, §2.4, §3.3, §4.5 (`runtime.yaml`, `check_status_freshness`, `validate_repo`, TRAPS) — đọc 2026-10-13.
