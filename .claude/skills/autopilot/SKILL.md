---
name: autopilot
description: Chạy tự động từ yêu cầu đến khi hoàn thành theo khung X-stored — lập kế hoạch (G0–G4), MỘT cổng duyệt, rồi vòng lặp có bằng chứng máy (xs.py loop) tới khi done/blocked/budget. Dùng khi người dùng mô tả dự án mới, muốn "làm tự động đến khi xong", hoặc gõ /autopilot.
argument-hint: "[mô tả yêu cầu hoặc đường dẫn PROJECT.md]"
---

# /autopilot — tự động đến khi hoàn thành, dừng đúng chỗ

Đọc trước: `AGENTS.md` (gốc dự án) và `<FW>/11-autonomous-loop/README.md` (giao thức đầy đủ).
`<FW>` = `.xstored/framework` trong dự án đích, hoặc `framework` trong repo khung. `<XS>` = `python3 .xstored/scripts/xs.py` (hoặc `python3 scripts/xs.py`).

## Pha 1 — Lập kế hoạch (G0–G4), KHÔNG code

1. **Đọc repo trước, hỏi sau.** Dự án có sẵn: tự dò stack/CI/test từ file thật; không hỏi điều đã có trong code.
2. **G0 Frame** → viết/cập nhật `PROJECT.md` (mẫu `<FW>/templates/PROJECT.md`): vấn đề, người dùng, ≥1 chỉ số đo được, phạm vi "không làm".
3. **G1 Classify** → chọn hồ sơ (`<XS> list profiles`), gói ngành (`<XS> list industries`), quy mô S/M/L (bảng ở `<FW>/00-method/composition.md`), rồi
   `<XS> compose --profile <p> [--industry <i>] --scale <S|M|L> [--add <module>] --out BLUEPRINT.md`.
4. **G2 Research** → giao subagent `researcher` xác minh phiên bản/chuẩn/luật từ nguồn sống (ghi ngày); viết ADR chọn stack (mẫu `<FW>/templates/ADR.md`).
5. **G3 Specify** → `SPEC-<tính-năng>.md` cho từng tính năng MVP: Given/When/Then + ca biên. Spec hở → **dừng và hỏi**, không tự lấp.
6. **G4 Design** → sơ đồ C4 mức 1–2, schema, `API-CONTRACT.md`, `THREAT-MODEL.md` (mức ≥ M).
7. **PLAN.md** (mẫu `<FW>/templates/PLAN.md`): task `T-001…` ≤ 1 ngày/task, mỗi task một **Gate** là lệnh máy kiểm; 4 con số ngân sách (max vòng, giờ, chi phí, hạn); danh sách **điểm dừng bắt buộc**.
8. Trình **MỘT cổng duyệt**: tóm tắt ≤ 30 dòng (blueprint: số MUST/SHOULD; stack + phiên bản; task; rủi ro; điểm dừng). Chờ người duyệt. **Sau khi duyệt, không hỏi lại trừ điểm dừng bắt buộc.**

## Pha 2 — Vòng lặp có bằng chứng (G5–G7)

9. `<XS> loop init --plan docs/autopilot/PLAN.md --blueprint BLUEPRINT.md --max-iterations <N> --hours <H>`.
10. Mỗi vòng: `<XS> loop status` → làm task đầu tiên còn `[ ]` → chạy Gate qua `<XS> loop record --task T-xxx -- <lệnh Gate y nguyên>` → xanh thì tick `[x]` trong PLAN, commit (`feat/fix/...: ...`, nhỏ, qua cổng commit) + push nhánh làm việc → cập nhật `PROGRESS.md` (≤ 8 KB).
11. Gate đỏ: sửa; cùng một lỗi **lần 2 → đổi cách tiếp cận** (ghi vào PROGRESS), **lần 3 → máy tự BLOCKED** (dừng để người xem). Không skip/disable test, không nới cấu hình cổng để xanh (hook sẽ hỏi).
12. Blueprint: tick `[x]` **chỉ khi có bằng chứng** (CI/test/scan/file) ghi ở PR; mục không áp dụng → `[~] — Miễn: <lý do>`.
13. Giao việc: `executor` cho task rõ phạm vi; `reviewer` (model khác) review diff trước khi merge PR; phiên chính điều phối, **subagent không lồng subagent**.
14. **Điểm dừng bắt buộc** (gọi `<XS> loop block --reason "..."` rồi dừng): thao tác không đảo ngược (xoá dữ liệu, drop/alter phá vỡ), tiền thật/thanh toán, dữ liệu người dùng thật, publish/deploy production/gửi email-thông báo ra ngoài, đổi quyền hoặc cấu hình cổng, mâu thuẫn spec không tự giải, bảo mật/pháp lý mơ hồ.
15. Gần hết ngân sách (≥ 80% vòng/giờ) hoặc context lớn: ghi **Bàn giao phiên** vào PROGRESS.md (việc dở ở đâu, bước kế tiếp cụ thể, SHA), commit + push, rồi để Stop hook kết thúc.

## Kết thúc

- `done`: mọi task có bằng chứng xanh + `<XS> blueprint-status BLUEPRINT.md --strict` = 0 MUST mở → viết `GO-NO-GO.md`, mở PR cuối, báo cáo ≤ 20 dòng (đã làm / bằng chứng / còn treo / đề xuất).
- `blocked`/`budget`: báo rõ lý do + bước kế tiếp; không tự khai "xong".
- Không bao giờ: force-push, rewrite history nhánh người khác, empty commit để kích CI, merge khi CI đỏ.
