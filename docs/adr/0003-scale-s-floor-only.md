# ADR-0003: Ở quy mô S chỉ "sàn" là MUST — module chuyên sâu hạ thành SHOULD

- **Trạng thái:** Đã chấp nhận
- **Trạng thái triển khai:** Đã triển khai (`scripts/xs.py` `effective_level`, `tests/test_xs.py::test_compose_scale_s_keeps_floor_demotes_modules`)
- **Ngày:** 2026-10-13

## Bối cảnh

Sau khi viết đủ 18 mảng, khung có 2.622 mục, trong đó 1.545 MUST. Đo bằng `xs.py compose` ngày 2026-10-13: blueprint
`web-app` quy mô **S** (prototype) có **859 MUST**, gần bằng quy mô M (1.133). Điều này trái với
`00-method/lifecycle.md` ("S làm nhẹ đi chứ không bỏ") và làm autopilot không thể "xong" một prototype trong thời gian hợp lý.
Nguyên nhân: tác giả module đánh MUST cho yêu cầu "thiếu là chưa đạt ở production" nhưng ít dùng `MUST@M`.

## Quyết định

Ở quy mô S, `xs.py compose` hạ mọi MUST của tài liệu `kind: module` và `kind: standard` thành SHOULD. MUST của
`baseline`, `profile` và `industry` giữ nguyên — đó là **sàn** mà mọi phần mềm (baseline), mọi phần mềm cùng loại (hồ sơ)
và mọi phần mềm trong ngành bị quản lý (gói ngành) phải có ngay cả khi còn nhỏ. M và L không đổi.

## Lý do

- Một quy tắc ở máy thay vì sửa tay ~1.000 mục: ít rủi ro, đảo ngược được, giữ ID và mức gốc trong khung.
- Ngành bị quản lý (tiền, y tế, trẻ em) vẫn giữ MUST ở S — luật không miễn cho prototype có dữ liệu thật.
- Kết quả đo sau thay đổi: `web-app` S 78 MUST, `api-service` S 82, `ai-agent` S 84, `cli-tool` S 81.

## Các phương án đã cân nhắc

- **Rà tay đổi MUST → MUST@M ở từng module:** chính xác hơn từng mục nhưng tốn công, dễ lệch giữa tác giả. Vẫn nên làm dần
  (xem Hệ quả) nhưng không chặn phát hành.
- **Thêm mức `MUST@S` cho mục bắt buộc kể cả prototype:** đổi hợp đồng định dạng, mọi tác giả phải học thêm ký hiệu. Loại;
  yêu cầu như vậy thuộc `01-baseline/`.
- **Giữ nguyên:** blueprint S vô dụng cho prototype. Loại.

## Hệ quả

- Tốt: prototype có checklist khả thi; lên M chỉ cần ghép lại, các mục tự trở về MUST theo ID.
- Xấu/nợ: blueprint M vẫn lớn (~1.000 MUST). Theo dõi khi audit dự án thật: mục MUST nào thường bị miễn trừ hợp lý →
  hạ `MUST@L` hoặc SHOULD trong khung (giữ ID).
- Quy ước mới: yêu cầu mà prototype cũng phải có thì đặt ở `01-baseline/` (đã ghi vào `conventions.md`).
