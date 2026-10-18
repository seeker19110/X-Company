---
title: SPEC-pwa
features: [F-011]
status: approved
approved_by: "autopilot D-006"
approved_at: 2026-10-18
updated: 2026-10-18
---

# SPEC — PWA, Hôm nay, ngoại tuyến, đăng xuất (F-011)

Trạng thái: Approved for implementation (D-006)

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

## Tiêu chí chấp nhận

Mỗi tiêu chí `AC-<MIỀN>-NN` ánh xạ 1-1 tới một kịch bản `S-*` ở mục Kịch bản; test mang mã `S-*` trong `tests/` hoặc `e2e/` (script `npm run -s check:docs` đối chiếu AC → S-ID → test, WF-SDD-003). Loại: chuẩn · lỗi (ca lỗi) · biên.

| ID | Loại | Tiêu chí (Given/When/Then) | Kịch bản (S-ID) |
|---|---|---|---|
| AC-PWA-01 | chuẩn | Given mất mạng, When bấm Vào ca, Then bản ghi `pending` hiển thị "Đã lưu trên thiết bị"; có mạng Then `confirmed`, server đúng 1 sự kiện dù client gửi 2 lần | S-PWA-01 |
| AC-PWA-02 | lỗi | Given người A đăng xuất, người B đăng nhập cùng trình duyệt, Then B không thấy dữ liệu/hàng chờ của A | S-PWA-02 |
| AC-PWA-03 | lỗi | Given server trả 403 cho bản chờ (quyền bị thu hồi), Then `rejected`, hiển thị lý do, không thử lại | S-PWA-03 |
| AC-PWA-04 | chuẩn | Given manifest và service worker, Then manifest hợp lệ (installable), SW phạm vi `/app/` | S-PWA-04 |

## Ca biên

Nhóm theo PM-SPEC-003 (8 nhóm). "Phủ bởi" nêu test đã có; "chưa có test" là nợ ghi rõ, không phải đã phủ.

| Nhóm | Ca biên | Hành vi mong đợi | Phủ bởi |
|---|---|---|---|
| Rỗng/null | lô đồng bộ rỗng hoặc sai kiểu; đăng xuất khi không còn bản chờ | 400; thoát ngay không hộp thoại | `tests/http/sync.test.ts`, `tests/unit/device-data.test.ts` |
| Cực đại | lô quá 50 bản; IndexedDB đầy quota | 400, chia lô 50; quota đầy: lỗi rõ ràng, không im lặng | `tests/http/sync.test.ts`, `tests/unit/offline-queue.test.ts`; quota đầy: chưa có test |
| Trùng lặp/idempotency | client gửi lại do timeout | `id` = `Idempotency-Key`, server đúng 1 sự kiện | S-PWA-01 |
| Song song | hai lần đồng bộ cùng lúc cùng `id` | server vẫn một sự kiện (khoá `idempotency_key`) | `tests/http/attendance-events.test.ts` |
| Mất mạng giữa chừng | mất phản hồi sau khi server đã ghi; nâng cấp SW giữa lúc còn bản chờ | gửi lại cùng id → `confirmed`; hàng chờ còn nguyên | S-PWA-01, `tests/unit/manifest.test.ts` |
| Thời gian/múi giờ | bản chờ quá 72 giờ; phiên hết hạn khi đồng bộ | `needs_review`; 401 cả lô, client giữ `pending` | `tests/http/sync.test.ts` |
| Quyền | quyền bị thu hồi khi bản đang chờ | 403 → `rejected` | S-PWA-03 |
| Tiền/đơn vị | không áp dụng: việc liên quan tiền không cho ngoại tuyến (P0 không xử lý tiền) | — | — |

## Câu hỏi mở

- Dịch vụ Web Push — Đã quyết: D-005 (VAPID tự host).
- Chạy trên thiết bị thật (AT13, Q02) cần người; ngoài phạm vi spec này.
