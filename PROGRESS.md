# PROGRESS.md — Khung X-stored

> Giai đoạn hiện tại: G8 Vận hành & tiến hoá (khung v2 đã phát hành) · Cập nhật: 2026-10-14 · Nhánh: claude/gracious-ritchie-kqb5fy

## Đang làm
- Không có việc dở. Khung v2 đã merge vào `main` qua seeker19110/X-stored#11 (`af20ba9`): 2.622 mục, 14 hồ sơ, 8 ngành, harness autopilot.

## Tiếp theo
1. Đợt rà sau: hạ dần MUST ít dùng ở quy mô M (blueprint web-app M ~1.100 MUST).
2. Thử khung trên một dự án thật: `install.py` → `compose` → `/autopilot`; ghi mục MUST thường bị miễn trừ để hạ mức (ADR-0003, Hệ quả).
3. Import `.github/rulesets/main.json` trong Settings → Rules (ruleset cũ đã bị xoá); muốn ép buộc thì đổi cảnh báo `protection-guard` thành lỗi.

## Quyết định
- 2026-10-13 Khung v2 = thư viện yêu cầu có ID + máy ghép blueprint + máy kiểm "xong" — ADR-0001.
- 2026-10-13 Harness: hook fail-open về luồng, fail-closed về hành động nguy hiểm; Stop hook đọc bằng chứng — ADR-0002.
- 2026-10-13 Quy mô S chỉ giữ MUST của baseline/hồ sơ/ngành — ADR-0003.
- 2026-10-13 Luật dữ liệu VN hiện hành: Luật 91/2025/QH15 + NĐ 356/2025 (thay NĐ 13/2023 từ 01/01/2026); Luật ANM 116/2025 (01/07/2026).
- 2026-10-14 OWASP LLM Top 10 ấn bản 2026 (04/08/2026); EU AI Act Đ.50 áp dụng 02/08/2026; bản đồ "một chủ đề một nhà" ghi vào conventions.
- 2026-10-13 Mặc định OSI: OpenTofu (MPL-2.0) thay Terraform (BUSL-1.1), Valkey thay Redis 8; Lighthouse CI giữ có cảnh báo, ghi phương án thay.
- Nợ kỹ thuật chấp nhận: blueprint M khoảng 1.000 MUST; số điều cụ thể của NĐ 356/2025 chưa đối chiếu bản gốc — trả khi audit dự án thật.

## Bàn giao phiên
- Commit cuối trên `main`: `af20ba9` · CI xanh (quality, protection-guard, gitleaks, codeql).
- Lệnh kiểm nhanh: `scripts/dev-task.sh gate` (đọc `xs.yaml`).
- Đang chặn: không.
- Câu hỏi cần người: không.
