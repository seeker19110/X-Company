# PROGRESS.md — Khung X-stored

> Giai đoạn hiện tại: G8 Vận hành & tiến hoá (khung v2 đã phát hành) · Cập nhật: 2026-10-14 · Nhánh: claude/gracious-ritchie-kqb5fy

## Đang làm
- Trần 4 MUST mỗi module ở quy mô M (ADR-0004): 671 mục → `MUST@L`; PR chờ CI → squash-merge.

## Tiếp theo
1. Thử khung trên một dự án sản phẩm thật (web/api, quy mô M) để đo mục MUST hay bị miễn trừ — repo khung đã dogfood xong ở S.
2. Việc của admin (5 MUST còn mở trong BLUEPRINT.md): import `.github/rulesets/main.json`, bật Private Vulnerability Reporting, tạo tag `v2.0.0`.

## Quyết định
- 2026-10-13 Khung v2 = thư viện yêu cầu có ID + máy ghép blueprint + máy kiểm "xong" — ADR-0001.
- 2026-10-13 Harness: hook fail-open về luồng, fail-closed về hành động nguy hiểm; Stop hook đọc bằng chứng — ADR-0002.
- 2026-10-13 Quy mô S chỉ giữ MUST của baseline/hồ sơ/ngành — ADR-0003.
- 2026-10-13 Luật dữ liệu VN hiện hành: Luật 91/2025/QH15 + NĐ 356/2025 (thay NĐ 13/2023 từ 01/01/2026); Luật ANM 116/2025 (01/07/2026).
- 2026-10-14 OWASP LLM Top 10 ấn bản 2026 (04/08/2026); EU AI Act Đ.50 áp dụng 02/08/2026; bản đồ "một chủ đề một nhà" ghi vào conventions.
- 2026-10-14 Dogfood: compose giữ trạng thái theo ID; sàn Python 3.11; CI chạy đúng `dev-task.sh gate`; ruff + mypy ghim.
- 2026-10-14 Quy mô M: tối đa 4 MUST mỗi module/chuẩn, phần vượt `MUST@L`; web-app M 1.094 → 470 — ADR-0004.
- 2026-10-13 Mặc định OSI: OpenTofu (MPL-2.0) thay Terraform (BUSL-1.1), Valkey thay Redis 8; Lighthouse CI giữ có cảnh báo, ghi phương án thay.
- Nợ kỹ thuật chấp nhận: chọn 4 MUST/module là phán đoán, chờ dữ liệu miễn trừ từ dự án thật; số điều cụ thể của NĐ 356/2025 chưa đối chiếu bản gốc — trả khi audit dự án thật.

## Bàn giao phiên
- Commit cuối trên `main`: `55de4d1` (#14 dogfood) · CI xanh (quality, protection-guard, gitleaks, codeql, macos-bash32).
- Lệnh kiểm nhanh: `scripts/dev-task.sh gate` (đọc `xs.yaml`).
- Đang chặn: không.
- Câu hỏi cần người: không.
