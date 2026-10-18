---
title: Ứng phó sự cố — X-Company
updated: 2026-10-18
owner: seeker19110
---

# Ứng phó sự cố (OPS-IR-001/004/006/010)

> Thời gian phản ứng bên dưới là **số đề xuất**, chủ dự án chốt; chưa có trực 24/7 (`<chủ dự án điền: người trực, kênh>`). Runbook lệnh: [RUNBOOK.md](RUNBOOK.md). Mẫu post-mortem: [incidents/README.md](incidents/README.md).

## 1. Mức sự cố
Ai được tuyên bố: bất kỳ ai phát hiện có thể tuyên bố tạm một mức; **người chỉ huy sự cố** (mặc định chủ dự án @seeker19110, hoặc người trực `<chủ dự án điền>`) xác nhận/đổi mức.

| Mức | Định nghĩa | Ví dụ của dự án (≥ 2) | Xác nhận | Giảm thiệt hại |
|---|---|---|---|---|
| SEV1 | lộ/mất/sai dữ liệu nhân sự, định vị hoặc bảng công đã khoá; mất toàn bộ dịch vụ | (1) IDOR làm nhân viên đọc được công/hồ sơ người khác; (2) `SESSION_SECRET`, `QR_SIGNING_KEYS` hoặc mật khẩu DB lộ; (3) `npm run audit:verify` báo đứt chuỗi hoặc kỳ công đã khoá bị đổi; (4) web sập đúng giờ chốt công | ≤ 15 phút | ≤ 1 giờ |
| SEV2 | chức năng chính hỏng cho nhiều người, không có cách vòng | (1) nhiều nhân viên không chấm công được lúc vào ca (QR/ghi sự kiện lỗi); (2) xuất CSV bảng công sai số hoặc checksum không khớp; (3) đăng nhập lỗi hàng loạt | ≤ 1 giờ | ≤ 4 giờ |
| SEV3 | một chức năng hỏng, có cách vòng | (1) CMS không xuất bản được, khách vẫn gọi điện; (2) hộp liên hệ không tạo hồ sơ nhưng form báo lỗi rõ; (3) thông báo/outbox trễ > 1 giờ | ≤ 1 ngày làm việc | ≤ 2 ngày làm việc |
| SEV4 | lỗi nhỏ, ảnh hưởng ít | (1) chữ/bố cục sai ở một trang; (2) cảnh báo `dep-audit` mức thấp; (3) một nhân viên không đồng bộ được hàng chờ (có thể sửa công thủ công) | ≤ 5 ngày làm việc | theo lịch |

Sự cố bảo mật (lộ dữ liệu, lộ bí mật, xâm nhập) luôn là **SEV1** (OPS-IR-010) → mục 4.

## 2. Thứ tự xử lý cố định
1. **Phát hiện** — ghi giờ phát hiện (UTC) ở timeline.
2. **Phân mức** — theo bảng trên; nghi ngờ thì chọn mức cao hơn.
3. **Giảm thiệt hại** — *trước khi tìm nguyên nhân*: rollback mã (RUNBOOK mục 1), vô hiệu tài khoản/thu hồi quyền, xoay bí mật, dừng tiến trình, khôi phục từ sao lưu. Ghi mốc "đã giảm thiệt hại".
4. **Liên lạc** — người dùng bị ảnh hưởng, chủ dự án, (SEV1 dữ liệu cá nhân) đầu mối pháp lý → [runbooks/data-breach.md](runbooks/data-breach.md).
5. **Khắc phục triệt để** — qua cổng thường: nhánh, test tái hiện đỏ→xanh, PR, CI. Không sửa nóng bỏ qua cổng.
6. **Đóng** — xác minh bằng lệnh/đo (không bằng lời), đóng khi hết ảnh hưởng.
7. **Post-mortem** — không đổ lỗi, ≤ 5 ngày làm việc, mẫu ở [incidents/README.md](incidents/README.md); mỗi lỗi lặp → thêm một hàng rào (test/lint/checklist).

Timeline sự cố phải có mốc "giảm thiệt hại" **trước** mốc "tìm ra nguyên nhân gốc".

## 3. Trước khi chạy lệnh lên dữ liệu
Áp dụng cho mọi lệnh ghi/xoá/sửa trên dữ liệu thật lúc sự cố (OPS-IR-006):
1. **Snapshot ngay trước**: `pg_dump -Fc "$DATABASE_URL" -f incident-<ID>-pre.dump` (hoặc snapshot của nhà cung cấp); ghi tên/id snapshot vào timeline.
2. **Viết sẵn lệnh hoàn tác** và dán vào timeline trước khi chạy lệnh chính.
3. Chạy trong giao dịch: `begin; …; -- kiểm số dòng, dữ liệu mẫu; commit/rollback`.
4. Thao tác **không thể hoàn tác** (xoá vĩnh viễn, ghi đè): cần **hai người xác nhận** (người chạy + người đọc lệnh), ghi tên cả hai.
5. Không `UPDATE`/`DELETE` sự kiện chấm công gốc hay `audit_event` (chỉ thêm); sửa công đi qua `attendance_adjustment`.
6. Thao tác tay không qua `audit.append` → ghi lại ai/lúc nào/lý do ở timeline và bổ sung bản ghi audit khi có thể.
7. Xoá/xuất/migration phá vỡ trên dữ liệu người dùng thật là điểm dừng bắt buộc theo AGENTS.md §6 — người quyết, không agent.

## 4. Nhánh sự cố bảo mật (SEV1)
Kích hoạt thêm ba việc, song song với mục 2:
- [ ] **Bảo toàn chứng cứ**: snapshot DB, xuất `pm2 logs`, log truy cập, `audit_event`, `session`, `login_attempt` ra nơi chỉ đọc *trước* khi sửa/xoá; không xoá log; ghi băm SHA-256 của tệp chứng cứ.
- [ ] **Thu hồi/xoay bí mật liên quan**: [RUNBOOK.md mục 3 "Lộ bí mật"](RUNBOOK.md); vô hiệu tài khoản bị chiếm; `delete from session` nếu cần.
- [ ] **Đánh giá nghĩa vụ thông báo**: dữ liệu cá nhân bị ảnh hưởng? → [runbooks/data-breach.md](runbooks/data-breach.md) (mốc 72 giờ kể từ khi phát hiện; đồng hồ không dừng chờ điều tra xong). Đầu mối pháp lý: `<chủ dự án điền: tên, liên hệ — chưa chỉ định>`.

## 5. Hậu sự cố
Tạo tệp `docs/ops/incidents/YYYY-MM-DD-<slug>.md` theo mẫu; thêm hàng rào chống lặp lại; cập nhật [../THREAT-MODEL.md](../THREAT-MODEL.md) nếu lộ ranh giới mới.
