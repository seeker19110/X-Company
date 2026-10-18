<!-- Tích thật, có bằng chứng; mục không áp dụng ghi N/A + lý do. -->

## Mô tả

<!-- Vấn đề · hành vi mới · task PLAN (T-NNN) · spec/kịch bản (S-…) · quyết định D-NNN/ADR liên quan. -->

## Bằng chứng

- [ ] Gate của task chạy xanh (`python3 .xtemplates/scripts/xt.py loop record …`) — lệnh:
- [ ] CI job `quality` xanh (gate + coverage)
- [ ] Mục blueprint đã tick kèm `— Kiểm:` chạy lại được (liệt kê ID) hoặc ghi "không có"

## Rủi ro

- [ ] Chạm auth / mật mã / dữ liệu người dùng / bí mật / tiền? (có → ngoại lệ cứng, người merge)
- [ ] Migration mới: append-only, có đường lùi, không phá dữ liệu
- [ ] Route mới: kiểm quyền ở server + test 401/403
- [ ] Phụ thuộc mới: tên · phiên bản ghim · license · lý do — hoặc "không có"
- [ ] Không bí mật, không dữ liệu cá nhân thật trong mã/test/log
