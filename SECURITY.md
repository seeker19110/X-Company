# Chính sách bảo mật

## Phiên bản được hỗ trợ

Dự án chưa có bản phát hành. Trong giai đoạn P0, chỉ nhánh `main` được sửa lỗ hổng. Sau bản phát hành đầu tiên,
bảng này liệt kê các bản còn được vá.

| Phiên bản | Hỗ trợ bản vá bảo mật |
|---|---|
| `main` (chưa phát hành) | có |

## Báo lỗ hổng — kênh riêng tư

**Không mở issue, PR hay thảo luận công khai cho lỗ hổng bảo mật.**

1. Mở <https://github.com/seeker19110/X-Company/security/advisories/new> (GitHub Private Vulnerability Reporting).
2. Mô tả: thành phần/đường dẫn, các bước tái hiện, tác động, phiên bản/commit. Không đính kèm dữ liệu cá nhân thật.
3. Nếu nút báo cáo không hiện (tính năng chưa được bật): `<chủ dự án bật Settings → Code security → Private vulnerability reporting>`;
   trong lúc đó mở issue công khai **chỉ** với nội dung "cần kênh báo bảo mật", không nêu chi tiết, để chủ dự án liên hệ lại qua GitHub.

Tệp `/.well-known/security.txt` (RFC 9116) của website trỏ về cùng kênh này.

## Cam kết phản hồi

- Xác nhận đã nhận và phản hồi ban đầu **trong ≤ 14 ngày** kể từ khi nhận báo cáo.
- Mức nghiêm trọng và hạn vá theo [docs/ops/VULN-SLA.md](docs/ops/VULN-SLA.md); sự cố đã xảy ra xử lý theo
  [docs/ops/INCIDENT-RESPONSE.md](docs/ops/INCIDENT-RESPONSE.md) (nhánh sự cố bảo mật).
- Công bố phối hợp: chúng tôi đề nghị bên báo cáo không công bố trước khi bản vá sẵn sàng hoặc sau 90 ngày kể từ báo cáo
  (sớm hơn nếu hai bên thoả thuận). Ghi nhận công lao trong advisory nếu bên báo cáo đồng ý.

## Phạm vi

Trong phạm vi: mã trong kho này, website và webapp do dự án vận hành. Ngoài phạm vi: lỗ hổng của phụ thuộc bên thứ ba
(báo cho dự án gốc; nếu ảnh hưởng chúng tôi, vẫn báo ở đây), tấn công vật lý, kỹ thuật xã hội với nhân sự, DoS khối lượng lớn.
Chúng tôi không khởi kiện người nghiên cứu hành động thiện chí trong phạm vi trên, không truy cập hay lưu dữ liệu người khác quá mức cần để chứng minh lỗi.

## Mô hình mối đe doạ

[docs/THREAT-MODEL.md](docs/THREAT-MODEL.md). Chuẩn bảo mật nhắm tới: ASVS 5.0.0 L2 (xem [PROJECT.md](PROJECT.md)).
