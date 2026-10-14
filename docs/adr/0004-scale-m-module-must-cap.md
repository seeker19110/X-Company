# ADR-0004: Ở quy mô M mỗi module tối đa 4 MUST — phần vượt là MUST@L

- **Trạng thái:** Đã chấp nhận
- **Trạng thái triển khai:** Đã triển khai (`scripts/xs.py` `MAX_MUST_AT_M` trong `validate`, `tests/test_xs.py::test_module_must_at_m_capped`)
- **Ngày:** 2026-10-14

## Bối cảnh

ADR-0003 làm blueprint S khả thi (~75 MUST) nhưng để lại nợ: blueprint M vẫn rất lớn. Đo bằng `xs.py compose` ngày
2026-10-14: `web-app` M **1.094 MUST**, `monorepo` 1.095, `ai-agent` 1.026, `static-site` 849 — gấp ~15 lần S. Đội 3–10 người
không thể chứng minh nghìn mục, nên autopilot không bao giờ "xong" và người dùng sẽ miễn trừ hàng loạt, làm mất giá trị MUST.

Nguyên nhân đo được: 107/108 file `module`/`standard` có từ 5 đến 18 MUST hiệu lực ở M (trung vị 10). Lọc theo tính năng
(AI, OSS, i18n) chỉ bớt ~70 mục, không phải gốc vấn đề.

## Quyết định

1. Mỗi file `kind: module` hoặc `kind: standard` có **tối đa 4** mục hiệu lực MUST ở quy mô M (`MUST` trơn + `MUST@M`).
   `xs.py validate` báo lỗi khi vượt, nên trần không trôi khi thêm mục.
2. Phần vượt chuyển thành `MUST@L`: ở M máy hạ thành SHOULD (bỏ phải ghi lý do), ở L vẫn là MUST. ID và nội dung giữ nguyên.
3. Bốn mục giữ chọn theo thứ tự: (a) thiếu thì gây hại khó đảo ngược — lộ/mất/hỏng dữ liệu, chiếm quyền, mất tiền,
   vi phạm luật bắt buộc, sập không khôi phục; (b) mục nền móng mà mục khác dựa vào; (c) kiểm rẻ bằng máy.
4. Sàn (`baseline`, `profile`, `industry`) không bị trần — nghĩa vụ cứng của cả loại phần mềm/ngành đặt ở đó.

## Lý do

- Trần cục bộ theo file dễ hiểu với tác giả và máy kiểm được; ngân sách tổng theo hồ sơ thì không ai sở hữu.
- Chỉ đổi sang `MUST@L` nên blueprint L không đổi và ADR-0003 vẫn đúng ở S: thay đổi chỉ chạm quy mô M, đảo ngược được theo ID.
- 4 mục/module: ~90 module của `web-app` × 4 + sàn ≈ 480 MUST — lớn nhưng khả thi cho production đội nhỏ; 3 làm rơi
  cả mục bảo mật cốt lõi ở module rộng (xác thực, AppSec), 6 vẫn để ~660.
- Kết quả đo sau thay đổi (671 mục chuyển `MUST@L`): `web-app` M 470 MUST, `monorepo` 471, `ai-agent` 450, `api-service` 402,
  `static-site` 381, `cli-tool` 271. Blueprint S và L của cả 14 hồ sơ không đổi một mục.

## Các phương án đã cân nhắc

- **Ngân sách tổng cho mỗi hồ sơ:** không chỉ ra mục nào phải hạ; mỗi lần thêm module lại phải đàm phán lại. Loại.
- **Hạ theo tính năng (module AI/OSS/i18n chỉ vào khi khai báo):** đúng nhưng chỉ bớt ~70 mục và thêm cờ CLI. Để sau,
  khi audit dự án thật cho thấy cần.
- **Chờ dữ liệu miễn trừ từ dự án thật (như ADR-0003 dự kiến):** chưa có dự án thật; trong lúc chờ, khung không dùng được ở M.
  Trần này không chặn việc đó — dữ liệu thật sẽ quyết mục nào đổi chỗ trong bốn mục giữ.

## Hệ quả

- Tốt: blueprint M khả thi; MUST lấy lại nghĩa "thiếu là chưa đạt"; tác giả thêm mục MUST thứ 5 phải chọn hạ mục khác.
- Xấu: chọn 4 mục là phán đoán; nhiều nghĩa vụ pháp lý có điều kiện (trẻ em, chuyển dữ liệu ra nước ngoài, người dùng EU)
  nằm ở `MUST@L`. Mức trong blueprint không phải miễn trừ pháp lý — ghi rõ ở `16-compliance-privacy/README.md`; nghĩa vụ
  cứng của cả ngành thuộc gói ngành (sàn, không bị trần).
- Theo dõi: khi audit dự án thật, mục `MUST@L` nào hay bị thiếu gây sự cố → đổi chỗ vào bốn mục giữ (giữ ID, ghi CHANGELOG).
