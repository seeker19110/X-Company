# PROGRESS.md — Khung X-Templates

> Giai đoạn hiện tại: G8 Vận hành & tiến hoá (khung v2 đã phát hành) · Cập nhật: 2026-10-15 · Nhánh: claude/inspiring-darwin-k9eaud

## Đang làm
- Không có việc dở. Audit delta 2026-10-15 khép lại (#36–#39) + delta `b32e2a6` (2 🟢: AUD-HAR-019 bằng chứng blueprint trích file đổi mỗi phiên, AUD-DOC-022 ghi chú sổ lệch SHA) sửa ở #41 (PLAN T-501…T-503): `audit check --strict` exit 0, 0 phát hiện mở; blueprint repo khung 0 MUST mở.

## Tiếp theo
1. Cần người chọn: một dự án sản phẩm thật (web/api, quy mô M) để thử khung, đo mục MUST hay bị miễn trừ.
2. Dự án đã cài khung: chạy lại `install.py` từ X-Templates để nhận tên mới + guard/hook mới (#35, #36) + `changelog-check`.
3. Admin: tự kiểm Dependabot security updates (proxy chặn API); ô "extra approval for unattributed changes" của ruleset `main` còn bật — khác `.github/rulesets/main.json`, vô hại khi 0 approval.
4. Giới hạn đã biết, chưa sửa: guard không thấy lệnh trong `eval`/alias/biến chứa cờ (CHANGELOG); `xs.py` có thể lấy `$HOME` dotfiles (`.git`) làm gốc khi dự án chưa có dấu hiệu khung (README).
5. Giữ cổng: C901 ≤ 10, `mypy --strict`, coverage dòng + nhánh 100%, `changelog-check` — hàm mới vượt thì tách, không `noqa`/pragma.

## Quyết định
- 2026-10-13 Khung v2 = thư viện yêu cầu có ID + máy ghép blueprint + máy kiểm "xong" — ADR-0001.
- 2026-10-13 Harness: hook fail-open về luồng, fail-closed về hành động nguy hiểm; Stop hook đọc bằng chứng — ADR-0002.
- 2026-10-13 Quy mô S chỉ giữ MUST của baseline/hồ sơ/ngành — ADR-0003.
- 2026-10-13 Luật dữ liệu VN hiện hành: Luật 91/2025/QH15 + NĐ 356/2025 (thay NĐ 13/2023 từ 01/01/2026); Luật ANM 116/2025 (01/07/2026).
- 2026-10-14 OWASP LLM Top 10 ấn bản 2026 (04/08/2026); EU AI Act Đ.50 áp dụng 02/08/2026; bản đồ "một chủ đề một nhà" ghi vào conventions.
- 2026-10-14 Dogfood: compose giữ trạng thái theo ID; sàn Python 3.11; CI chạy đúng `dev-task.sh gate`; ruff + mypy ghim.
- 2026-10-14 Quy mô M: tối đa 4 MUST mỗi module/chuẩn, phần vượt `MUST@L`; web-app M 1.094 → 470 — ADR-0004.
- 2026-10-13 Mặc định OSI: OpenTofu (MPL-2.0) thay Terraform (BUSL-1.1), Valkey thay Redis 8; Lighthouse CI giữ có cảnh báo, ghi phương án thay.
- 2026-10-14 PROGRESS chỉ ghi SHA trên `main`: squash-merge làm SHA của nhánh PR không còn là tổ tiên HEAD — `xs.py progress-check` trong cổng `lint` sẽ đỏ.
- 2026-10-14 Audit có máy đỡ: sổ `docs/ops/AUDIT-STATUS.md` máy đọc, `audit check --strict` = Definition of Complete — ADR-0005.
- Nợ kỹ thuật chấp nhận: chọn 4 MUST/module là phán đoán, chờ dữ liệu miễn trừ từ dự án thật; số điều cụ thể của NĐ 356/2025 chưa đối chiếu bản gốc — trả khi audit dự án thật.
- 2026-10-14 Sửa audit 5 đợt (#20–#24): `dev-task.sh` lấy gốc dự án đúng ở `.xstored/`; hook phân tích lệnh bằng `guard.py` (shlex); install gộp hook + manifest hash; công cụ cổng khoá hash + `dep-audit`; WF-DOC-004 bỏ điều kiện "nhánh còn trên remote" (xung đột squash).
- 2026-10-14 9 mục trùng chủ đề chuyển `MAY` "gộp vào" nhà (ID giữ, CHANGELOG).
- 2026-10-14 Repo khung: cổng `typecheck` = `mypy --strict`; cổng `test` đòi coverage dòng + nhánh 100% (cả subprocess) — mã chết thì xoá, không dùng `pragma: no cover` trừ khi không thể chạy tới.
- 2026-10-14 Repo đổi tên X-stored → X-Templates; giữ `.xstored/`, `xs.py`, `XS_*` (đổi = phá dự án đã cài) — ADR-0006.
- 2026-10-14 `LOOP-HARNESS-012` → 018: không biến tắt hook riêng; tắt có chủ đích qua `disableAllHooks` của Claude Code; test fail-open 5 hook.
- 2026-10-15 Commit/PR không ghi tên model hay URL phiên AI (giữ AGENTS.md §3; AUD-HAR-017).
- 2026-10-15 Tag phát hành tạo bằng workflow `release-tag.yml` (proxy chặn push tag từ phiên agent); `v2.0.0` → `55de4d1`.
- 2026-10-15 Guard hỏi khi mở phiên Claude bỏ qua hook (`--bare`, `--settings`, `disableAllHooks`…); cổng commit chạy trước khi hỏi người.
- 2026-10-15 `xs.py changelog-check` trong cổng `lint`; gốc dự án: `CLAUDE_PROJECT_DIR` → cha `.xstored` → dấu hiệu khung → `.git` → cwd.
- 2026-10-15 Bằng chứng blueprint trích máy kiểm/test, không trích file trạng thái viết lại mỗi phiên (PROGRESS.md, PLAN) — nếu không `audit plan` cờ cũ sau mọi phiên (AUD-HAR-019).

## Bàn giao phiên
- 2026-10-15 · Commit cuối trên `main`: `b32e2a6` (#39); tag `v2.0.0` → `55de4d1`; SHA quét audit `05ec95d` (DOC/HAR `b32e2a6`).
- Lệnh kiểm nhanh: `scripts/dev-task.sh gate` (đọc `xs.yaml`; `pip install --require-hashes -r requirements-dev.txt`, cần shellcheck).
- Autopilot: PLAN T-501…T-503 `done` (`xs.py loop status`). Đang chặn: không.
- Câu hỏi cần người: Tiếp theo 1 (dự án thật để thử khung).
