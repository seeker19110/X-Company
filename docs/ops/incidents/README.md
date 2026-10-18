# Post-mortem sự cố

Mỗi sự cố SEV1–SEV2 (và mọi vụ lộ bí mật) có một tệp `YYYY-MM-DD-<slug>.md` ở thư mục này trong ≤ 5 ngày làm việc. Chưa có sự cố nào được ghi.
Quy trình: [../INCIDENT-RESPONSE.md](../INCIDENT-RESPONSE.md). Không đổ lỗi cho cá nhân; không dán dữ liệu cá nhân hay bí mật.

## Mẫu

```markdown
# <ID> — <tiêu đề ngắn> (SEVn)

- Ngày/giờ phát hiện (UTC): · Giờ giảm thiệt hại: · Giờ đóng:
- Người chỉ huy: · Người tham gia:
- Ảnh hưởng: ai, bao nhiêu, dữ liệu nào (không dán dữ liệu thật)

## Timeline (UTC) — mốc "giảm thiệt hại" phải đứng trước mốc "nguyên nhân gốc"
| Giờ | Sự kiện | Snapshot id / lệnh hoàn tác |
|---|---|---|

## Nguyên nhân gốc (5 câu hỏi vì sao)

## Điều đã làm tốt / chưa tốt

## Việc tiếp theo
| Việc | Người | Hạn | Hàng rào mới (test/lint/checklist) |
|---|---|---|---|

## Nghĩa vụ thông báo (nếu dữ liệu cá nhân): đã đánh giá ngày … bởi … kết luận …
```
