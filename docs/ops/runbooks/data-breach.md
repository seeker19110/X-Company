---
title: Rò rỉ dữ liệu cá nhân — thông báo vi phạm
updated: 2026-10-18
last_tabletop: chưa diễn tập
status: nháp — pháp chế xác minh số điều, mẫu và thời hạn trước khi dùng thật
---

# Runbook rò rỉ dữ liệu cá nhân (CMP-VN-006, CMP-INTL-006)

> **Pháp chế xác minh** mọi nội dung pháp lý ở đây (nguồn khung X-Templates 2026-10-13; số điều lệch giữa các bản chép). Không thay tư vấn pháp lý.
> Kích hoạt khi dữ liệu cá nhân có thể đã bị truy cập/lộ/mất trái phép. Chạy song song với nhánh bảo mật của [../INCIDENT-RESPONSE.md](../INCIDENT-RESPONSE.md).

## Mốc thời gian
Đồng hồ chạy **từ khi phát hiện** (không phải từ khi điều tra xong). Gửi thông báo sơ bộ rồi bổ sung.

| Mốc | Việc | Hạn |
|---|---|---|
| T0 | phát hiện; ghi giờ UTC; tuyên bố SEV1 | ngay |
| T0 + 1 giờ | giảm thiệt hại (thu hồi, vô hiệu, ngắt); bảo toàn chứng cứ; báo đầu mối pháp lý `<chủ dự án điền>` | ≤ 1 giờ |
| T0 + 24 giờ | đánh giá: dữ liệu nào, bao nhiêu người, có nhạy cảm (định vị) không, khả năng gây hại | ≤ 24 giờ (đề xuất nội bộ) |
| **T0 + 72 giờ** | thông báo Bộ Công an (**Mẫu 08**, NĐ 356/2025/NĐ-CP — pháp chế xác minh) khi vi phạm có thể gây hại; thông báo chủ thể dữ liệu | **≤ 72 giờ** |
| Sau đó | bổ sung thông tin; post-mortem; cập nhật hồ sơ ĐGTĐ ([../../DPIA.md](../../DPIA.md)) | theo luật |

## Thời hạn theo vùng (lấy thời hạn ngắn nhất áp dụng cho chủ thể dữ liệu)
| Vùng | Thời hạn | Ghi chú |
|---|---|---|
| Việt Nam (Luật 91/2025/QH15, NĐ 356/2025) | 72 giờ | áp dụng cho nhân viên, ứng viên, khách ở Việt Nam |
| EU (GDPR) | 72 giờ tới cơ quan giám sát | chỉ khi có chủ thể ở EU (hiện không dự kiến) |
| Thái Lan (PDPA) | 72 giờ | chỉ khi có chủ thể ở Thái Lan (hiện không dự kiến) |
| Singapore (PDPA) | 3 ngày lịch sau khi xác định | chỉ khi có chủ thể ở Singapore (hiện không dự kiến) |

**SLA kỹ thuật của dự án = 72 giờ** kể từ phát hiện. Bảng vùng cần pháp chế xác nhận.

## Các bước
1. **Giảm thiệt hại**: [../RUNBOOK.md](../RUNBOOK.md) mục 3; vô hiệu tài khoản, xoay khoá, ngắt đường lộ.
2. **Bảo toàn chứng cứ**: snapshot DB, log; không xoá.
3. **Xác định phạm vi** (truy vấn mẫu, chạy chỉ đọc):
   ```bash
   psql "$DATABASE_URL" -c "select occurred_at, actor_user_id, action, object_type from audit_event where occurred_at between '<từ>' and '<đến>' order by occurred_at"
   ```
   Đối chiếu loại dữ liệu với [../../privacy/data-map.yaml](../../privacy/data-map.yaml) (cột nào, nhạy cảm hay không).
4. **Quyết định thông báo** (người chỉ huy + pháp chế): có khả năng gây hại → thông báo; ghi quyết định và lý do dù không thông báo.
5. **Thông báo** theo mẫu dưới; Bộ Công an dùng **Mẫu 08** chính thức (`<pháp chế điền: cổng/địa chỉ nộp>`).
6. **Hậu kiểm**: post-mortem, hàng rào mới, cập nhật DPIA, THREAT-MODEL.

## Mẫu thông báo cho chủ thể dữ liệu (nháp)
> Kính gửi `<tên>`,
> Ngày `<ngày>` chúng tôi phát hiện sự cố an ninh có thể ảnh hưởng tới dữ liệu cá nhân của bạn: `<loại dữ liệu>`. Hậu quả có thể xảy ra: `<…>`. Chúng tôi đã `<biện pháp đã làm>`. Bạn nên `<khuyến nghị: đổi mật khẩu…>`. Liên hệ: `<đầu mối — chủ dự án điền>`. Chúng tôi sẽ cập nhật khi có thêm thông tin.

## Mẫu thông báo sơ bộ cho cơ quan (nháp — thay bằng Mẫu 08 chính thức)
Thời điểm phát hiện · mô tả sự cố · loại và số lượng chủ thể/bản ghi (ước lượng) · hậu quả có thể · biện pháp đã/đang làm · đầu mối liên hệ.

## Diễn tập tabletop
Ít nhất 1 lần/năm, có biên bản ở [../incidents/README.md](../incidents/README.md). `last_tabletop: chưa diễn tập`.
