# ADR-0005: Audit có máy đỡ — sổ máy đọc, `xs.py audit plan/check`, 13 nhóm

- **Trạng thái:** Đã chấp nhận
- **Trạng thái triển khai:** Đã triển khai (`scripts/xs.py` `audit_plan`/`audit_check`, `framework/00-method/audit.md`,
  `framework/templates/AUDIT-STATUS.md`, `.claude/skills/audit/SKILL.md`; test `tests/test_xs.py` `AuditPlanTest`, `AuditCheckTest`)
- **Ngày:** 2026-10-14

## Bối cảnh

Đến 2026-10-14, audit chỉ là văn xuôi trong skill `/audit`: không có nhà trong khung, không mẫu báo cáo, tiến độ ghi tự do.
Hệ quả đo được khi audit chính repo khung cùng ngày:
- Miễn trừ `BASE-DEP-002` ghi "CI không cài gói nào" trong khi `ci.yml` đã `pip install ruff mypy` từ PR sau đó — không gì báo
  bằng chứng blueprint đã cũ.
- Hai subagent rà song song trả 44 phát hiện với định dạng, thang mức và ID khác nhau; gộp tay dễ mất hoặc trùng.
- Không có tiêu chí máy cho "audit xong", nên audit không thể là cổng phát hành hay vòng hội tụ của autopilot.

## Quyết định

1. Phương pháp có một nhà: `framework/00-method/audit.md` (13 nhóm — thêm nhóm 13 *Harness & quy trình agent* — mỗi nhóm
   trỏ module chứa yêu cầu; thang 🔴/🟠/🟢; bằng chứng `đo được:`/`suy luận:`/`chưa biết:`; xác minh đối kháng; quét lại theo diff).
2. Sổ máy đọc `docs/ops/AUDIT-STATUS.md` theo mẫu: bảng *Nhóm* (trạng thái + SHA quét) và bảng *Phát hiện* (`AUD-<MÃ>-NNN`).
3. `xs.py audit plan` (chỉ đọc): tín hiệu repo → nhóm áp dụng/rút gọn/N/A kèm lý do; công cụ có/thiếu; mục blueprint `[x]`/`[~]`
   trích file đã đổi **sau** commit ghi dòng đó (`git blame` so `git log`); nhóm cần quét lại theo `git diff <SHA>..HEAD`.
4. `xs.py audit check STATUS [--strict]`: schema + SHA tổ tiên HEAD + chấp nhận rủi ro có chủ/hạn; `--strict` là Definition of Complete.
5. Chỉ thư viện chuẩn Python, như mọi lệnh `xs.py` (ADR-0001).

## Lý do

- Bảng Markdown đọc được cho người và máy, review được trong PR; JSON/YAML riêng sẽ tách sổ khỏi báo cáo người đọc.
- Phát hiện bằng chứng cũ qua thời điểm commit là tín hiệu rẻ, không cần hiểu ngữ nghĩa: nó chỉ đánh dấu để người/agent
  xác minh lại, không tự kết luận sai.
- `--strict` cho audit cùng hình dạng với `blueprint-status --strict`: một exit code mà CI, Stop hook và GO-NO-GO dùng được.

## Các phương án đã cân nhắc

- **Giữ skill văn xuôi, chỉ thêm mẫu báo cáo:** không bắt được bằng chứng cũ hay sổ sai định dạng. Loại.
- **Lưu phát hiện dạng JSON (`findings.json`):** máy dễ đọc hơn nhưng người phải đọc hai nơi, diff PR khó xem. Loại.
- **Dùng công cụ ngoài (DefectDojo, SARIF tổng hợp):** mạnh với SAST nhưng nặng, cần dịch vụ, không phủ tài liệu/harness;
  có thể nhập SARIF làm bằng chứng của nhóm 2/3 về sau.

## Hệ quả

- Tốt: audit lặp lại được, có điểm dừng máy kiểm, quét lại rẻ; dự án đích nhận cùng công cụ qua `install.py`.
- Xấu: ánh xạ file → nhóm và dò stack là heuristic; repo lạ có thể bị xếp sai nhóm — `audit plan` chỉ gợi ý, người quyết N/A.
- Nợ: chưa nhập SARIF/JUnit tự động vào sổ; chưa có lệnh kiểm "tên file/lệnh trong tài liệu phải tồn tại" (gợi ý từ audit 2026-10-14).
