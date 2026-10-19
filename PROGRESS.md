# PROGRESS.md — X-Company

> Giai đoạn hiện tại: G7 — lát 9 (hạ tầng chạy cục bộ) xong, chờ người cho phần production thật · Cập nhật: 2026-10-19 · Nhánh: claude/focused-cannon-3iu4lk

## Đang làm
- Lát 9 (T-044…T-051) xong trên nhánh: luật VN → cấu hình (hạn DSAR theo loại, lưu trữ, trần OT), sao lưu/khôi phục thử, cảnh báo, DAST, đo tải, mã hoá lúc lưu, cổng GPS ở server. Chờ mở PR.
- `GO-NO-GO.md` = NO-GO production; 93 mục blueprint đã `loop defer` chờ người/hạ tầng thật.

## Tiếp theo
1. Chủ dự án: merge PR lát 9; import `.github/rulesets/main.json`; bật Private Vulnerability Reporting; LICENSE chủ sở hữu; nộp DPIA trong 60 ngày kể từ ngày xử lý thật
2. Luật sư: đối chiếu Luật 91/2025, NĐ 356/2025, BLLĐ 2019, NĐ 145/2020 với giá trị đã cài (mức B); HR chốt nội quy ca/OT và thời gian chờ xoá liên hệ nhân viên nghỉ việc
3. Hạ tầng thật: KMS/HSM, sao lưu off-site, Prometheus/Alertmanager, staging có TLS (ZAP, RUM/CrUX, k6) rồi `loop resume`

## Quyết định
- D-014…D-038 ở `docs/autopilot/DECISIONS.md`; D-029…D-035 là giá trị pháp lý tự quyết (nguồn mức B, chưa có xác nhận pháp chế); D-036 sửa lỗi DAST; D-037/D-038 mã hoá và cổng GPS
- Bằng chứng lát 9 mang nhãn faithful-fixture (máy dev), không phải production
- `merge-check` đã sửa phân trang trong repo (xt.py, FB-077); lệnh kiểm lỗi thời đã chỉnh theo chủ dự án cho phép

## Bàn giao phiên
- Commit cuối trên nhánh chính: `e5793ac` (main sau #14/#16) · lát 9 ở nhánh làm việc, chưa có PR
- Lệnh kiểm nhanh: `.xtemplates/scripts/dev-task.sh gate` · `npm run -s e2e` 31/31 · `check:arch` xanh · `dast`, `perf:load`, `alerts:drill`, `backup:drill` chạy cục bộ
- Đang chặn: không · Việc dở chưa commit: không
- Câu hỏi cần người: merge PR lát 9; xác nhận pháp chế; hạ tầng production
