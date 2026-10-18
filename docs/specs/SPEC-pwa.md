# SPEC — PWA, Hôm nay, ngoại tuyến, đăng xuất (F-011)

> Nguồn: kế hoạch §3 (PWA), §10. Nghiệm thu: AT05, AT12, AT13. Cập nhật 2026-10-18.

## Cài đặt & điều hướng
- `app/manifest.ts` (tên, `start_url=/app/today`, `scope=/app/`, `display=standalone`, biểu tượng 192/512 + maskable), HTTPS, trang hướng dẫn cài theo thiết bị (iOS: Chia sẻ → Thêm vào MH chính).
- Điều hướng di động 4 mục: Hôm nay, Công việc, Chấm công, Cá nhân. Vùng bấm ≥ 44×44 px; màu luôn kèm nhãn.
- Màn hình Hôm nay: ca hôm nay (giờ, địa điểm), nút Vào/Ra ca, việc ưu tiên (≤ 5), trở ngại, yêu cầu đang chờ, trạng thái đồng bộ (số bản chờ, lần đồng bộ cuối).

## Service worker
- Cache tĩnh (bản build có băm) cache-first; HTML `/app/**` network-first, fallback trang ngoại tuyến; **không cache** response API chứa dữ liệu cá nhân trong Cache Storage — dữ liệu xem ngoại tuyến nằm ở IndexedDB theo người dùng.
- Nâng cấp SW không xoá hàng chờ: lược đồ IndexedDB có `schema_version`, nâng cấp chuyển đổi bản ghi chờ, không drop store.

## Hàng chờ ngoại tuyến
- Thao tác cho phép ngoại tuyến (P0): đề nghị chấm công, cập nhật trạng thái/báo cáo tiến độ task, nháp biểu mẫu. **Không** ngoại tuyến: phê duyệt, đổi quyền, khoá kỳ, việc liên quan tiền.
- Mỗi lệnh: `{id (=idempotency_key, UUID), user_id, kind, payload, created_at (device), attempts, last_error, state: pending|sent|confirmed|rejected}`.
- Trạng thái hiển thị (§6): "Đã lưu trên thiết bị" (pending) → "Đã gửi" (sent, đã nhận 2xx) → "Đã xác nhận" (confirmed, server trả `accepted`); `needs_review` hiển thị "Chờ xác minh" + lý do.
- Đồng bộ khi: mở app, trở lại foreground, sự kiện `online`, bấm Đồng bộ; Background Sync chỉ bổ sung nếu có. Thử lại lùi luỹ thừa (1 s → 5 phút), lỗi 4xx (trừ 408/429) = `rejected` không thử lại, hiển thị lý do.
- Server kiểm lại khi nhận bản muộn: tài khoản còn hiệu lực, phạm vi, phiên bản dữ liệu (`version`), trạng thái kỳ (AT05).

## Đăng xuất & thiết bị dùng chung (AT12)
- Đăng xuất: nếu còn bản `pending` → hộp thoại hiển thị số bản, chọn "Đồng bộ rồi đăng xuất" hoặc "Xoá và đăng xuất" (xác nhận lần 2). Sau đăng xuất: xoá IndexedDB của người dùng, gọi `Clear-Site-Data: "cache", "storage"` cho `/app`.
- IndexedDB đặt tên theo `user_id`; khởi động với phiên của người khác → không đọc DB cũ, xoá DB không thuộc phiên hiện tại.
- Chế độ "thiết bị dùng chung" (tuỳ chọn khi đăng nhập): không lưu dữ liệu xem ngoại tuyến.

## Kịch bản
- S-PWA-01 (AT05): mất mạng, bấm Vào ca → bản ghi `pending`, giao diện "Đã lưu trên thiết bị"; có mạng → `confirmed`, server có đúng 1 sự kiện dù client gửi 2 lần do timeout.
- S-PWA-02 (AT12): người A đăng xuất, người B đăng nhập cùng trình duyệt → không thấy dữ liệu/hàng chờ của A.
- S-PWA-03: server trả 403 cho bản chờ (quyền bị thu hồi) → `rejected`, hiển thị lý do, không thử lại.
- S-PWA-04: manifest hợp lệ (Lighthouse installable), SW đăng ký thành công trên `/app`.
- Ca biên: IndexedDB bị trình duyệt thu hồi → hiển thị cảnh báo mất dữ liệu cục bộ chưa gửi (số bản lần cuối biết); quota đầy → lỗi rõ ràng, không im lặng.
