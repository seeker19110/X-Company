---
title: DPIA — X-Company (đã lập, chờ nộp)
version: 1
updated: 2026-10-19
status: ĐÃ LẬP — CHỜ chủ dự án nộp cho cơ quan chuyên trách trong 60 ngày kể từ ngày bắt đầu xử lý thật; chưa có xác nhận pháp chế
---

# DPIA — X-Company · phiên bản 1 · 2026-10-19

> **Trạng thái: Đã lập — CHỜ chủ dự án nộp cho cơ quan chuyên trách trong 60 ngày kể từ ngày bắt đầu xử lý thật; chưa có xác nhận pháp chế.**
> Chờ pháp chế duyệt. Hồ sơ do nhóm phát triển lập theo nội dung Mẫu số 10 (NĐ 356/2025/NĐ-CP Điều 19 khoản 3 — nguồn mức B: bản sao thương mại, chưa đối chiếu Công báo; NĐ 356/2025 thay NĐ 13/2023 từ 2026-01-01). Mọi giá trị pháp lý ghi kèm nguồn + mức tin cậy; người quyết = chủ dự án uỷ quyền cho phiên chính (D-029…D-033). **Không có điều nào ở đây là "pháp chế đã duyệt".** Nộp hồ sơ cho cơ quan nhà nước là việc của chủ dự án, agent không nộp. Chưa xử lý dữ liệu người dùng thật nào tại thời điểm lập.
> Khung pháp lý: [../PROJECT.md](../PROJECT.md) mục 10; nghiên cứu: [research/2026-10-19-luat-vn-du-lieu-lao-dong.md](research/2026-10-19-luat-vn-du-lieu-lao-dong.md). Mẫu khung: `.xtemplates/framework/templates/DPIA.md`.

## 0. Thông tin liên hệ
| Trường | Giá trị |
|---|---|
| Vai trò của tổ chức | Bên Kiểm soát (công ty sử dụng) |
| Tổ chức (tên pháp nhân, địa chỉ, người đại diện) | `<chủ dự án điền>` |
| Người phụ trách bảo vệ dữ liệu / liên hệ | `<chưa chỉ định — chủ dự án điền>`; kênh nhận yêu cầu chủ thể: HR (quyền `privacy.manage`) |
| Trạng thái nộp | **chưa nộp** (hạn: 60 ngày kể từ ngày bắt đầu xử lý thật — mức B, chưa xác minh bản chính) |
| Cập nhật kế tiếp | khi đổi mục đích/bên nhận/cờ thu GPS; định kỳ theo quy định |

## 1. Mục đích, loại dữ liệu, chủ thể
Chi tiết từng cột: [privacy/data-map.yaml](privacy/data-map.yaml), [compliance/data-inventory.csv](compliance/data-inventory.csv).

| Mục đích | Dữ liệu | Chủ thể | Nguồn | Căn cứ (đề xuất, mức tin cậy) |
|---|---|---|---|---|
| Quản lý nhân sự, chấm công, công việc | họ tên, email/SĐT công việc, ngày vào/nghỉ, ca, giờ vào/ra, nghỉ phép (lý do tự do — có thể nhạy cảm) | nhân viên (20–200 người) | HR nhập; nhân viên tự chấm công | thực hiện hợp đồng lao động / nghĩa vụ pháp lý (Luật 91/2025 Đ19, Đ25 — A) |
| Đối soát vị trí chấm công | toạ độ, độ chính xác — **nhạy cảm**; **tắt mặc định** | nhân viên | thiết bị nhân viên | đồng ý RIÊNG + nhân viên biết biện pháp giám sát (Luật 91/2025 Đ25.3, Đ31.3a — A); **chưa bật** |
| Tiếp nhận yêu cầu website | họ tên, email/SĐT, nội dung | khách truy cập | form công khai | đồng ý (lưu phiên bản thông báo) |
| Tuyển dụng | họ tên, email, SĐT, thư xin việc | ứng viên | form công khai | đồng ý; "kho nhân tài" = đồng ý RIÊNG, tách biệt, không tích sẵn |
| An ninh hệ thống | IP, user agent, email đăng nhập | người dùng | tự động | lợi ích chính đáng (pháp chế xác nhận khi chạy thật) |

**Dữ liệu sinh trắc / ảnh khuôn mặt: KHÔNG thu** (D-032). Đã kiểm mã ngày 2026-10-19: không có mã chụp ảnh/camera/nhận diện khuôn mặt; hạng mục chấm công chỉ có `source` ∈ {qr, gps, kiosk}; mô-đun tệp (`lib/files`) chỉ nhận tài liệu đính kèm theo đối tượng nghiệp vụ, không dùng cho ảnh chấm công. Ràng buộc nằm ở thiết kế (SPEC-attendance: GPS chỉ là tín hiệu đối soát, QR là chính) và ở việc không có luồng thu; **chưa có rào kỹ thuật chủ động chặn** nếu sau này có người thêm.
**GPS — phát hiện cần xử lý trước khi bật:** giao diện hiện **không** gọi định vị (không có `navigator.geolocation`), nhưng API `POST` chấm công **chấp nhận và lưu** `geo` (`geo_lat`, `geo_lng`) từ bất kỳ client nào mà không kiểm cờ/đồng ý riêng ở server. Chưa có dữ liệu thật nên chưa có thu thập thực tế; **trước khi bật GPS cần thêm cổng ở server** (cờ cấu hình + bản ghi đồng ý riêng `consent_record`) — việc kỹ thuật tiếp theo, ghi ở mục 9.

## 2. Luồng dữ liệu và bên nhận
Sơ đồ DFD và ranh giới tin cậy: [THREAT-MODEL.md](THREAT-MODEL.md) mục 2. Bên nhận: SMTP giao dịch và Web Push (khi có, D-005; dữ liệu tối thiểu), hệ lương/kế toán nhận CSV bảng công (thủ công). **Không chuyển dữ liệu ra nước ngoài theo thiết kế**; nhà cung cấp hạ tầng/SMTP ở nước ngoài cần hồ sơ riêng — `<chủ dự án điền khi chọn nhà cung cấp>`.

## 3. Cách xin đồng ý và quyền chủ thể
- Khách/ứng viên: đồng ý bắt buộc ở form, lưu `consent_at` + `consent_notice_version`; bản ghi đồng ý chỉ thêm `consent_record` (mục đích, phiên bản, thời điểm, kênh, băm văn bản hiển thị); rút = dòng mới. Mục đích dựa trên đồng ý: `inquiry_contact`, `job_application`, `talent_pool` (kho nhân tài — ô riêng, không tích sẵn, rút được bất kỳ lúc nào).
- Nhân viên: xử lý theo hợp đồng lao động, không dựa trên đồng ý; thông báo xử lý dữ liệu lúc vào làm — `<HR soạn>`; GPS chỉ khi có đồng ý riêng và nhân viên biết biện pháp giám sát.
- Quyền chủ thể (HR ghi `data_subject_request`, mã hồ sơ — không email/SĐT). Hạn theo loại (D-029; NĐ 356/2025 Điều 5 — mức B, số ngày gia hạn khoản 2–4 **chưa xác minh**):

| Loại | Hạn thực hiện | Cấu hình |
|---|---|---|
| xem (access), chỉnh sửa (rectify), cung cấp (export) | 10 ngày | `DSAR_DAYS_ACCESS` |
| rút đồng ý, hạn chế, phản đối | 15 ngày | `DSAR_DAYS_RESTRICT` |
| xoá | 20 ngày | `DSAR_DAYS_DELETE` |
| phản hồi "đã nhận" (mọi loại) | 2 ngày làm việc (bỏ T7, CN; chưa loại ngày lễ) | `DSAR_RESPOND_WORKDAYS` |
| gia hạn | tối đa MỘT lần, kèm lý do, khi chưa quá hạn; GIẢ ĐỊNH +15 ngày | `DSAR_EXTEND_DAYS` |

  Danh sách quá hạn (thực hiện hoặc phản hồi): `GET /api/app/privacy/requests?overdue=1`; cảnh báo vận hành `XCLocalDsarOverdue`. Xoá: ẩn danh cùng hàm với job lưu giữ, xoá blob, che outbox, dừng xử lý; giữ bằng chứng đồng ý và nhật ký (không định danh). Nhân viên: hồ sơ lao động/bảng công không xoá — đánh dấu `retained_by_law`.
- Chưa làm được: xoá khỏi **bản sao lưu**; báo xoá cho bên thứ ba; chủ thể tự phục vụ; xác thực lại danh tính (HR xác minh ngoài hệ thống); thao tác gỡ cờ hạn chế; rút riêng "kho nhân tài" qua giao diện (hiện rút đồng ý = rút mọi đồng ý đang hiệu lực).

## 4. Chính sách lưu trữ, xoá, huỷ (D-030)
Mọi số là cấu hình ở `lib/nen/env.ts` (nguồn + mức tin cậy ở chú thích); số cụ thể là lựa chọn thận trọng của chủ dự án uỷ quyền, **chưa có xác nhận pháp chế**.

| Dữ liệu | Thời hạn | Nguồn · mức |
|---|---|---|
| Liên hệ khách | 24 tháng rồi ẩn danh | Luật 91/2025 Đ3.3, Đ14.1 — A |
| Ứng viên không trúng tuyển | ẩn danh 30 ngày sau khi chốt kết quả | Luật 91/2025 Đ25.1c — A |
| Ứng viên có đồng ý "kho nhân tài" còn hiệu lực | 12 tháng sau khi chốt; rút đồng ý → quay về 30 ngày | thoả thuận (Đ25.1c) |
| Ứng viên chưa chốt quá 365 ngày | ẩn danh (lưới an toàn) | lựa chọn thiết kế |
| Nhân viên đã chấm dứt hợp đồng | xoá SĐT/email ngay sau ngày chấm dứt (`RETENTION_EMPLOYEE_TERMINATED_DAYS`=0); giữ họ tên + mã + công/lương tới 10 năm rồi ẩn danh họ tên | Luật 91/2025 Đ25.2c — A; 10 năm: Luật Kế toán Đ41.5b — B (nhóm 5 hay 10 năm chưa xác minh) |
| Chấm công, lương, chứng từ | 10 năm | như trên |
| Hồ sơ vi phạm dữ liệu | 5 năm sau khắc phục (`RETENTION_BREACH_RECORD_YEARS`; chưa có bảng) | NĐ 356/2025 Đ29.1c — B |
| Phiên 30 ngày, login_attempt 90 ngày, outbox đã gửi 30 ngày | xoá | D-016 |
| Bản sao lưu | theo `BACKUP_KEEP` | — |

Hạn chế đã biết: dòng chấm công/lương không xoá được (cấm DELETE) nên sau 10 năm chỉ ẩn danh họ tên, chưa xoá dòng; ứng viên trúng tuyển (`hired`) không bị job ứng viên đụng tới và chưa có liên kết hồ sơ ứng tuyển → nhân viên nên chưa ẩn danh khi chấm dứt hợp đồng; tài khoản đăng nhập (`app_user`) của người đã nghỉ chưa có job xoá email.

## 5. Biện pháp bảo vệ
| Biện pháp | Bằng chứng |
|---|---|
| Kiểm quyền ở server, mặc định từ chối | [THREAT-MODEL.md](THREAT-MODEL.md) T6, T11; `tests/unit/authz.test.ts` |
| Mật khẩu Argon2id, phiên băm, CSRF, giới hạn đăng nhập | `tests/http/auth.test.ts` |
| Nhật ký kiểm toán chỉ thêm, chuỗi băm | `tests/db/audit.test.ts` |
| Role DB tối thiểu quyền | `tests/db/migrate.test.ts` |
| Mã hoá at-rest, sao lưu mã hoá | chưa có — phụ thuộc hạ tầng `<chủ dự án điền>` |
| Quy trình sự cố và thông báo vi phạm | [ops/runbooks/data-breach.md](ops/runbooks/data-breach.md) (nháp, chưa diễn tập) |

## 6. Đánh giá rủi ro cho chủ thể
| ID | Rủi ro | Khả năng | Mức nghiêm trọng | Biện pháp | Còn lại |
|---|---|---|---|---|---|
| DP-01 | lộ vị trí/hồ sơ nhân sự do truy cập trái phép | TB | Cao | T6, T11, T12 ([THREAT-MODEL.md](THREAT-MODEL.md)) | thấp nếu test đủ |
| DP-02 | dùng vị trí ngoài mục đích đối soát công; API nhận `geo` không cổng | TB | Cao | GPS tắt mặc định ở giao diện; chỉ HR theo quyền | **mở**: cần cổng server (cờ + đồng ý riêng) trước khi bật; chính sách nội bộ `<HR>` |
| DP-03 | giữ dữ liệu quá hạn | TB | TB | job lưu giữ theo D-030, test DB từng nhánh | mở: sao lưu, dòng công/lương sau 10 năm, `app_user` |
| DP-04 | không đáp ứng quyền chủ thể đúng hạn | TB | TB | hạn theo loại + phản hồi 2 ngày làm việc + cảnh báo quá hạn | thấp nếu HR theo dõi; số ngày gia hạn là giả định |
| DP-05 | thu sinh trắc/ảnh khuôn mặt ngoài ý định | Thấp | Cao | không có luồng thu (đã kiểm mã 2026-10-19) | chưa có rào kỹ thuật chủ động |
| DP-06 | ép đồng ý "kho nhân tài" (dark pattern) | Thấp | TB | ô riêng, không tích sẵn, không gộp đồng ý hồ sơ | thấp |

## 7. Tự đánh giá
Đã đủ nội dung theo Mẫu số 10 ở mức kỹ thuật. **Chưa đủ điều kiện nộp** cho tới khi chủ dự án hoàn tất mục 9.

## 8. Ký
| Vai trò | Tên | Ngày |
|---|---|---|
| Người lập | nhóm phát triển (phiên chính, uỷ quyền chủ dự án) | 2026-10-19 |
| Đại diện pháp nhân | `<điền>` | |
| Pháp chế xác nhận | `<chưa có — không ghi "đã duyệt">` | |

## 9. Khi chạy thật — việc của NGƯỜI
1. Chủ dự án **nộp hồ sơ này cho cơ quan chuyên trách trong 60 ngày** kể từ ngày bắt đầu xử lý dữ liệu thật đầu tiên; lưu biên nhận (agent không nộp).
2. Luật sư đọc bản chính thức Luật 91/2025/QH15 và NĐ 356/2025/NĐ-CP (hiện đọc qua bản sao thương mại, mức A/B): đối chiếu Điều 5 (hạn + số ngày gia hạn khoản 2–4), Điều 19.3 (Mẫu số 10), Điều 29.
3. Luật sư/kế toán xác nhận 5 hay 10 năm cho bảng lương/chấm công (Luật Kế toán 2015 sửa bởi 56/2024) và thời hạn hồ sơ nhân sự; Luật Lưu trữ 2024.
4. HR chốt nội quy ca/OT/nghỉ (mặc định theo luật, RK-001) và soạn thông báo xử lý dữ liệu cho nhân viên.
5. Chỉ định người phụ trách bảo vệ dữ liệu; điền thông tin pháp nhân.
6. **Trước khi bật GPS:** nhân viên được thông báo biện pháp giám sát + đồng ý riêng; kỹ thuật bổ sung cổng server cho `geo`; xác nhận HR/pháp chế (kế hoạch §12).
7. Hạ tầng: mã hoá at-rest và sao lưu mã hoá, quy trình xoá khỏi sao lưu, nhà cung cấp SMTP/hạ tầng ở nước ngoài (nếu có).
