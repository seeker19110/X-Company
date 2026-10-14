# PROGRESS.md — Khung X-Templates

> Giai đoạn hiện tại: G8 Vận hành & tiến hoá (khung v2 đã phát hành) · Cập nhật: 2026-10-14 · Nhánh: claude/inspiring-darwin-k9eaud

## Đang làm
- Không có việc dở. #30 (đổi tên X-Templates, ADR-0006, LOOP-HARNESS-018) đã merge; autopilot BLOCKED chờ admin (Tiếp theo 1). Sổ audit 2026-10-14 sạch nợ: AUD-CODE-001 (C901, #28), AUD-CODE-002 + AUD-TEST-001 (#26) đã trả; `audit check --strict` không còn 🟢 chấp nhận.

## Tiếp theo
1. Việc của admin (5 MUST mở trong BLUEPRINT.md: GATE-007, REPO-006/008/013, SEC-009): import `.github/rulesets/main.json` (4 required check), bật Private Vulnerability Reporting + Dependabot security updates, tạo tag phát hành (phiên agent bị proxy chặn push tag — 403).
2. Giữ cổng: C901 ≤ 10, `mypy --strict`, coverage dòng + nhánh 100% — hàm mới vượt thì tách, không `noqa`/pragma.
3. Cần người chọn: một dự án sản phẩm thật (web/api, quy mô M) để thử khung, đo mục MUST hay bị miễn trừ.
4. Dự án đã cài khung: chạy lại `install.py` từ X-Templates để nhận chuỗi tên mới.

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

## Bàn giao phiên
- Commit cuối trên `main`: `474c3fe` (#30); SHA quét audit vẫn `6490f7b` (nhóm CODE/TEST cập nhật ở #26, #28).
- Lệnh kiểm nhanh: `scripts/dev-task.sh gate` (đọc `xs.yaml`; `pip install --require-hashes -r requirements-dev.txt`, cần shellcheck).
- Đang chặn: autopilot BLOCKED — 5 MUST cần quyền admin (Tiếp theo 1); người xong chạy `xs.py loop resume --reason ...`. PLAN T-401…T-403 xong.
- Câu hỏi cần người: mục Tiếp theo 1 và 3.
