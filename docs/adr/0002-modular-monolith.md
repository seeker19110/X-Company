# ADR-0002: Kiểu kiến trúc — modular monolith

- Trạng thái: Chấp nhận · Ngày: 2026-10-18 · Quyết định: D-004 (`docs/autopilot/DECISIONS.md`) · Bổ sung ADR-0001

## Bối cảnh

X-Company gồm website công khai, webapp điều hành nội bộ và PWA cho nhân viên (quy mô M, một đội nhỏ). Dữ liệu dùng chung
mạnh: một nhân viên vừa là người dùng, vừa là đối tượng chấm công, vừa được giao việc; mọi ghi nghiệp vụ phải kèm audit
trong cùng giao dịch (`AGENTS.md` §9). Ràng buộc: tự host, một cụm PostgreSQL, vận hành bằng PM2 (`ARCHITECTURE.md`).

## Phương án đã cân nhắc

1. **Modular monolith** — một ứng dụng Next.js, nghiệp vụ chia miền ở `lib/<miền>`, ranh giới kiểm bằng máy
   (`docs/architecture/domains.md`, ESLint, `npm run check:arch`). Giao dịch ACID xuyên miền; một đơn vị triển khai.
2. **Microservices theo miền** — mỗi miền một dịch vụ + CSDL riêng. Co giãn độc lập nhưng cần giao dịch phân tán/saga
   cho "ghi nghiệp vụ + audit", tăng chi phí vận hành; không có nhu cầu co giãn nào đo được.
3. **Monolith không ranh giới (kiểu "big ball of mud")** — nhanh lúc đầu, nhưng vòng phụ thuộc và import chéo làm
   khó test và khó tách sau này.

## Quyết định

Chọn phương án 1. Ranh giới là luật chạy trong CI chứ không chỉ quy ước:
- thư mục `lib/*` ⊆ miền đã khai; import chéo miền chỉ vào tệp công khai đã khai (ARC-MOD-005/008);
- không vòng phụ thuộc (`import/no-cycle`, ARC-MOD-004);
- mô-đun thuần (tính ca, tiến độ, quyền, hàng chờ offline) không import DB, `pg`, HTTP, `next/*` (ARC-MOD-003);
- `app/` chỉ vào `lib/` qua `lib/http`; `lib/` không import `next/*` hay `app/`.

## Hệ quả

- Một lần triển khai, một CSDL, giao dịch đơn giản; test dùng PostgreSQL thật.
- Tách miền thành dịch vụ sau này khả thi vì ranh giới đã được ép bằng máy (cắt theo tệp công khai).
- Mọi miền chia sẻ một tiến trình: một miền lỗi nặng có thể ảnh hưởng cả ứng dụng; giảm bằng giới hạn tài nguyên, worker riêng
  cho việc nền.
- Thêm miền = cập nhật `docs/architecture/domains.md` trong cùng PR.

## Điều kiện đọc lại

- Một miền cần co giãn/chu kỳ phát hành độc lập (vd báo cáo nặng làm chậm chấm công, đo bằng p95 nghiệp vụ lõi).
- Hơn 3 nhóm phát triển độc lập sửa cùng repo gây xung đột hợp nhất thường xuyên.
- Yêu cầu tuân thủ buộc cô lập dữ liệu một miền (vd dữ liệu GPS/ảnh) khỏi phần còn lại.
