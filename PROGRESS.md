# PROGRESS.md — Khung X-stored

> Giai đoạn hiện tại: G7 Kiểm & phát hành (khung v2) · Cập nhật: 2026-10-13 · Nhánh: claude/gracious-ritchie-kqb5fy

## Đang làm
- Rà chéo nhất quán toàn khung (reviewer độc lập) → sửa phát hiện → mở PR khung v2 → CI xanh → squash-merge vào `main`.

## Tiếp theo
1. Áp phát hiện rà chéo (Gate: `python3 scripts/xs.py validate && python3 -m unittest discover -s tests && python3 scripts/check-links.py`).
2. PR vào `main`, theo dõi CI (`quality`, `protection-guard`, `gitleaks`, `codeql`), squash-merge khi xanh.
3. Thử khung trên một dự án thật: `install.py` → `compose` → `/autopilot`; ghi mục MUST thường bị miễn trừ để hạ mức (ADR-0003, Hệ quả).
4. Import `.github/rulesets/main.json` trong Settings → Rules (ruleset cũ đã bị xoá); muốn ép buộc thì đổi cảnh báo `protection-guard` thành lỗi.

## Quyết định
- 2026-10-13 Khung v2 = thư viện yêu cầu có ID + máy ghép blueprint + máy kiểm "xong" — ADR-0001.
- 2026-10-13 Harness: hook fail-open về luồng, fail-closed về hành động nguy hiểm; Stop hook đọc bằng chứng — ADR-0002.
- 2026-10-13 Quy mô S chỉ giữ MUST của baseline/hồ sơ/ngành — ADR-0003.
- 2026-10-13 Luật dữ liệu VN hiện hành: Luật 91/2025/QH15 + NĐ 356/2025 (thay NĐ 13/2023 từ 01/01/2026); Luật ANM 116/2025 (01/07/2026).
- 2026-10-13 Mặc định OSI: OpenTofu (MPL-2.0) thay Terraform (BUSL-1.1), Valkey thay Redis 8; Lighthouse CI giữ có cảnh báo, ghi phương án thay.
- Nợ kỹ thuật chấp nhận: blueprint M khoảng 1.000 MUST; số điều cụ thể của NĐ 356/2025 chưa đối chiếu bản gốc — trả khi audit dự án thật.

## Bàn giao phiên
- Commit cuối: xem `git log -1` trên nhánh trên (đã push) · CI: chạy khi mở PR.
- Lệnh kiểm nhanh: `scripts/dev-task.sh gate` (đọc `xs.yaml`).
- Đang chặn: không.
- Câu hỏi cần người: không.
