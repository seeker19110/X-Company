---
title: DPIA — X-Company (bản nháp)
version: 0
updated: 2026-10-18
status: BẢN NHÁP — chờ pháp chế duyệt
---

# DPIA — X-Company · phiên bản nháp 0 · 2026-10-18

> **Chờ pháp chế duyệt.** Bản nháp kỹ thuật do nhóm phát triển lập để pháp chế/HR rà và hoàn thiện; chưa phải hồ sơ nộp cơ quan. Chưa được xử lý dữ liệu người dùng thật nào. Bắt buộc hoàn tất **trước khi bật thu GPS/ảnh trên dữ liệu thật** (PLAN.md, điểm dừng bắt buộc).
> Khung pháp lý: [../PROJECT.md](../PROJECT.md) mục 10 (Luật 91/2025/QH15; NĐ 356/2025/NĐ-CP — số điều, mẫu 09/10 và thời hạn nộp **pháp chế xác minh**). Mẫu: `.xtemplates/framework/templates/DPIA.md`.

| Trường | Giá trị |
|---|---|
| Vai trò của tổ chức | Bên Kiểm soát (công ty sử dụng) — `<pháp chế xác nhận>` |
| Tổ chức | `<tên pháp nhân, địa chỉ, người đại diện — chủ dự án điền>` |
| Người phụ trách bảo vệ dữ liệu | `<chưa chỉ định>` |
| Trạng thái nộp | chưa nộp |
| Cập nhật kế tiếp | khi có đổi mục đích/bên nhận mới; định kỳ theo quy định `<pháp chế xác nhận>` |

## 1. Mô tả xử lý
Chi tiết từng cột: [privacy/data-map.yaml](privacy/data-map.yaml), [compliance/data-inventory.csv](compliance/data-inventory.csv).

| Mục đích | Dữ liệu | Chủ thể | Nguồn | Căn cứ (đề xuất) |
|---|---|---|---|---|
| Quản lý nhân sự, chấm công, công việc | họ tên, email/SĐT công việc, ngày vào/nghỉ, ca, giờ vào/ra, nghỉ phép (lý do tự do — có thể nhạy cảm) | nhân viên (20–200 người) | nhập bởi HR, tự nhân viên chấm công | hợp đồng lao động / nghĩa vụ pháp lý |
| Đối soát vị trí chấm công | toạ độ, độ chính xác — **nhạy cảm**; **tắt mặc định** | nhân viên | thiết bị nhân viên | đồng ý riêng + ĐGTĐ — chưa bật |
| Tiếp nhận yêu cầu website | họ tên, email/SĐT, nội dung | khách truy cập | form công khai | đồng ý (lưu phiên bản thông báo) |
| Tuyển dụng | họ tên, email/SĐT, thư xin việc | ứng viên | form công khai | đồng ý |
| An ninh hệ thống | IP, user agent, email đăng nhập | người dùng | tự động | lợi ích chính đáng `<pháp chế xác nhận>` |

## 2. Luồng dữ liệu và bên nhận
Sơ đồ ở [THREAT-MODEL.md](THREAT-MODEL.md) mục 2. Bên nhận: SMTP giao dịch và Web Push (khi có, D-005; dữ liệu tối thiểu), hệ lương/kế toán nhận CSV bảng công (thủ công). **Không chuyển dữ liệu ra nước ngoài theo thiết kế**; nếu nhà cung cấp hạ tầng/SMTP ở nước ngoài thì cần hồ sơ riêng — `<chủ dự án điền khi chọn nhà cung cấp>`.

## 3. Đồng ý và quyền chủ thể
- Khách/ứng viên: đồng ý bắt buộc ở form, lưu `consent_at` + `consent_notice_version`.
- Bản ghi đồng ý (`consent_record`, **chỉ thêm**): mục đích, phiên bản thông báo, thời điểm, kênh, băm ảnh chụp văn bản hiển thị; rút đồng ý là **dòng mới** (không sửa dòng cũ). Hiện có hai mục đích dựa trên đồng ý: `inquiry_contact`, `job_application` — `<pháp chế xác định còn mục đích nào cần đồng ý riêng>`.
- Quyền chủ thể (nháp kỹ thuật T-040, **chờ pháp chế duyệt**): người phụ trách (HR, quyền `privacy.manage`) nhận yêu cầu qua kênh liên hệ rồi ghi vào `data_subject_request` (mã hồ sơ, không email/SĐT):
  - **Truy cập**: xuất JSON dữ liệu của chính chủ thể (liên hệ/ứng viên: hồ sơ + lịch sử + đồng ý; nhân viên: hồ sơ + lịch sử công tác + chấm công tóm tắt theo tháng), không kèm dữ liệu người khác.
  - **Xoá**: ẩn danh bản ghi (cùng hàm với job lưu giữ), xoá blob tệp ở kho tệp, che payload outbox chứa mã/id, xoá ghi chú tự do của người xử lý, ghi dòng rút đồng ý, dừng xử lý. **Giữ lại** bằng chứng đồng ý/rút (không định danh) và nhật ký kiểm toán (đã che). Nhân viên: hồ sơ lao động và bảng công **không xoá** — đánh dấu `retained_by_law` kèm lý do; danh mục giữ cấu hình ở `lib/privacy/retained.ts` (`<pháp chế/HR xác nhận điều luật và số năm>`).
  - **Rút đồng ý**: thêm dòng rút, liên hệ → `processing_stopped`, ứng viên → `withdrawn`; worker bỏ qua sự kiện của chủ thể đã rút (hiệu lực ngay khi hoàn tất; mục tiêu luật ≤ 72 giờ `<pháp chế xác minh số điều NĐ 356/2025>`).
  - **Hạn chế xử lý**: cờ `processing_restriction`; worker và đổi trạng thái hồ sơ bị chặn tới khi gỡ cờ (**chưa có thao tác gỡ cờ** — việc tiếp theo).
- Hạn xử lý: `DSAR_DAYS` (mặc định **30 ngày — giả định, pháp chế xác minh theo NĐ 356/2025**); danh sách quá hạn có ở `GET /api/app/privacy/requests?overdue=1`.
- Chưa làm được: xoá khỏi **bản sao lưu** (chưa có quy trình/hạ tầng — `<chủ dự án điền>`); bên thứ ba nhận dữ liệu (SMTP/Web Push khi có) chưa có cơ chế báo xoá; chủ thể tự phục vụ (hiện qua người phụ trách) và xác thực lại danh tính chủ thể trước khi xoá là thủ tục ngoài hệ thống (HR xác minh qua kênh liên hệ); bản phản hồi API được lưu ở `idempotency_record` tối đa 24 giờ (job lưu giữ dọn) — xuất dữ liệu dùng GET để không lưu bản có PII.
- Nhân viên: thông báo xử lý dữ liệu lúc vào làm — `<HR soạn>`.

## 4. Thời hạn lưu
Mặc định cấu hình thận trọng (D-016): liên hệ 24 tháng, ứng viên 12 tháng, phiên hết hạn 30 ngày, `login_attempt` 90 ngày, outbox đã gửi 30 ngày. Hồ sơ nhân sự, công, audit: **chưa chốt** — pháp chế/HR. Job xoá/ẩn danh: T-029 (đã có, bật mặc định); xoá theo yêu cầu chủ thể: T-040.

## 5. Biện pháp bảo vệ
| Biện pháp | Bằng chứng |
|---|---|
| Kiểm quyền ở server, mặc định từ chối | [THREAT-MODEL.md](THREAT-MODEL.md) T6, T11; `tests/unit/authz.test.ts` |
| Mật khẩu Argon2id, phiên băm, CSRF, giới hạn đăng nhập | `tests/http/auth.test.ts` |
| Nhật ký kiểm toán chỉ thêm, chuỗi băm | `tests/db/audit.test.ts` |
| Role DB tối thiểu quyền | `tests/db/migrate.test.ts` |
| Mã hoá at-rest, sao lưu mã hoá | chưa có — phụ thuộc hạ tầng `<chủ dự án điền>` |
| Quy trình sự cố và thông báo vi phạm | [ops/runbooks/data-breach.md](ops/runbooks/data-breach.md) (nháp, chưa diễn tập) |

## 6. Rủi ro cho chủ thể
| ID | Rủi ro | Khả năng | Mức nghiêm trọng | Biện pháp | Còn lại |
|---|---|---|---|---|---|
| DP-01 | lộ vị trí/hồ sơ nhân sự do truy cập trái phép | TB | Cao | T6, T11, T12 | thấp nếu test đủ |
| DP-02 | dùng vị trí ngoài mục đích đối soát công | TB | Cao | GPS tắt mặc định; chỉ HR theo quyền; mục đích ghi ở data-map | cần chính sách nội bộ `<HR>` |
| DP-03 | giữ dữ liệu quá hạn | Cao | TB | job lưu giữ (T-029) | mở |
| DP-04 | không đáp ứng quyền chủ thể đúng hạn | TB | TB | T-040: `DSAR_DAYS`, danh sách quá hạn, test `tests/db/data-rights.test.ts` | thấp nếu HR theo dõi quá hạn; còn mở: bản sao lưu, bên thứ ba |

## 7. Tự đánh giá
Chưa đủ điều kiện nộp: thiếu người phụ trách, căn cứ pháp lý được xác nhận, chính sách nội bộ về vị trí, thông báo cho nhân viên, quyền chủ thể.

## 8. Ký
| Vai trò | Tên | Ngày |
|---|---|---|
| Người lập | `<điền>` | |
| Đại diện pháp nhân | `<điền>` | |
| Pháp chế duyệt | `<điền>` | |
