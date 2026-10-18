# SPEC — Chấm công, nghỉ phép, OT, sửa công, kỳ công (F-004, F-005, F-006)

> Nguồn: kế hoạch §6, §10. Nghiệm thu: AT03, AT04, AT05, AT06, AT07, AT08. Cập nhật 2026-10-18.
> Quyết định làm rõ (tự duyệt, ghi ở đây và `docs/autopilot/DECISIONS.md`): các giá trị mặc định đánh dấu ⚙ là **cấu
> hình có ngày hiệu lực** — HR chốt ở F02 trước pilot; mã không hard-code chúng.

## Ba lớp dữ liệu (§6)
1. **Sự kiện gốc** `attendance_event` (chỉ thêm): `id`, `idempotency_key` (duy nhất theo `employee_id`), `employee_id`, `company_id`, `kind` (`in|out|break_start|break_end`), `device_time`, `server_received_at`, `source` (`qr|gps|kiosk|manual_request|offline_sync`), `worksite_id`, `shift_assignment_id` (null = chưa gán), `policy_version_id`, `geo` (lat, lng, accuracy_m, captured_at — tuỳ chọn), `qr_token_id`, `status` (`accepted|needs_review|rejected`), `review_reason`.
2. **Tổng hợp** `attendance_summary` theo (nhân viên, ca nghiệp vụ): tính lại được, không sửa tay.
3. **Bảng công kỳ** `attendance_period` + `period_export` (khoá, có phiên bản).

## Ca
- `shift_template`: giờ bắt đầu/kết thúc theo giờ địa phương, `break_minutes`, `business_tz` (mặc định `Asia/Ho_Chi_Minh`). End ≤ start = **ca qua ngày** (§6, Frappe HR).
- `shift_assignment(employee, business_date, template, worksite)` — `business_date` là ngày bắt đầu ca. Ca 22:00–06:00 ngày 2026-10-18 là một ca nghiệp vụ `business_date=2026-10-18`.
- Lưu instant UTC (`timestamptz`); hiển thị/ngày nghiệp vụ theo `business_tz` của ca.

## Quy tắc tính (hàm thuần `computeShift`)
- C1. Ghép cặp vào/ra theo thứ tự `device_time` sau khi sắp xếp (sự kiện đến sai thứ tự vẫn đúng). Nhiều cặp vào/ra trong một ca → cộng các khoảng **không chồng lấn**; khoảng chồng giữa hai thiết bị chỉ tính một lần.
- C2. `present_minutes` = tổng khoảng có mặt (hợp các khoảng vào→ra) cắt vào cửa sổ `[start − early_grace⚙(60'), end + late_grace⚙(240')]`, trừ nghỉ: có sự kiện nghỉ (`break_start→break_end`) thì trừ đúng các khoảng nghỉ đã ghi (phần nằm trong khoảng có mặt); không có thì trừ `break_minutes` của mẫu ca khi có mặt > `break_minutes`. Thời điểm sự kiện cắt về phút nguyên (bỏ giây) trước khi tính, nên tổng và các đoạn theo ngày luôn khớp; không làm tròn khác ⚙. Nghỉ cố định tính vào ngày lịch chứa điểm giữa ca (ngày đó không đủ phút → ngày có nhiều phút nhất). Ghép cặp vào/ra theo từng thiết bị rồi hợp khoảng.
- C3. Thiếu `out` cuối → ngoại lệ `MISSING_CHECKOUT`; **không tự điền giờ ra**. Nếu cấu hình cho ước tính, giá trị mang nhãn `estimated=true` và không vào tổng chính thức tới khi được duyệt (§6).
- C4. Phân đoạn theo ngày lịch (cho báo cáo) giữ liên kết với cùng ca: trả `segments[{calendar_date, minutes}]`.
- C5. Đi sớm/về muộn **không tạo OT**; OT chỉ từ đơn OT được duyệt (§6). Kết quả có 4 số tách: `present_minutes`, `ot_requested_minutes`, `ot_approved_minutes`, `project_minutes` (từ T05).
- C6. Lệch giờ thiết bị: `|device_time − server_received_at| > clock_skew_max⚙(5')` với nguồn trực tuyến → `needs_review` (`CLOCK_SKEW`). Nguồn `offline_sync` cho phép lệch tới thời điểm tạo trong hàng chờ nhưng không quá `offline_max_age⚙(72h)`.

## QR động (§6)
- Máy chủ phát token `qr = base64url(payload).sig`, payload `{worksite_id, issued_at, ttl⚙=60s, nonce}`, chữ ký HMAC-SHA256 khoá riêng QR (xoay vòng có `kid`).
- Quét: kiểm chữ ký, hạn (cho phép lệch 10 s), worksite có trong ca được giao. QR dùng chung: **không** vô hiệu sau lần quét đầu; chống lặp gắn (nhân viên, hành động, idempotency_key).
- Không khẳng định chống chấm hộ tuyệt đối (W3C Geolocation không bảo đảm vị trí thật) — tín hiệu QR/vị trí/ca chỉ hỗ trợ đối soát.

## Chống trùng (AT04)
- I1. Cùng `(employee_id, idempotency_key)` + cùng nội dung → trả **cùng kết quả** (200, cùng `event_id`), không tạo bản ghi mới.
- I2. Cùng khoá, khác nội dung → 409 `IDEMPOTENCY_CONFLICT`, ghi audit.
- I3. Hai thiết bị, hai khoá khác nhau, cùng `in` khi đã có ca mở → bản thứ hai `needs_review` (`DUPLICATE_OPEN`), không tạo ca mở thứ hai; vẫn lưu để điều tra.
- I4. Ràng buộc DB: `UNIQUE(employee_id, idempotency_key)`.

## Nghỉ phép (F-005)
- `leave_ledger` sổ biến động: `+accrual`, `−taken`, `±adjustment` (lý do bắt buộc); số dư = tổng; **không có cột số dư sửa tay**.
- Đơn nghỉ trùng ca đã có đơn nghỉ được duyệt → 409 `LEAVE_OVERLAP` trước khi duyệt. Duyệt → ghi `−taken` trong cùng giao dịch.

## OT
- Đơn OT: `requested_minutes`, `reason`, `employee_consent_at` (đồng ý của người lao động — ghi riêng, BLLĐ Điều 107), người duyệt.
- Kiểm hạn mức **đồng thời** ngày/tháng/năm từ `ot_policy` có ngày hiệu lực và nguồn: mặc định⚙ ngày ≤ 4 giờ OT và tổng ngày ≤ 12 giờ, tháng ≤ 40 giờ, năm ≤ 200 giờ (HR/pháp chế xác nhận F02). Vượt → 422 `OT_LIMIT_<DAY|MONTH|YEAR>`; ngoại lệ cần cờ `exception_basis` ghi căn cứ và quyền `ot_exception`.

## Sửa công (AT06)
- `attendance_adjustment`: đề xuất thêm/huỷ hiệu lực sự kiện, `before`/`after`, `reason` bắt buộc, người đề nghị ≠ người duyệt (R5). Sự kiện gốc **không bị sửa/xoá**; adjustment tạo sự kiện mới `source=manual_request` hoặc đánh dấu `voided_by_adjustment_id`.

## Kỳ công (F-006)
- Trạng thái: `open → employee_review → manager_confirmed → hr_closed → locked`. Chỉ đi tới; mở lại kỳ khoá không có — thay đổi sau khoá đi qua adjustment `post_lock=true` cần HR duyệt và tạo **phiên bản xuất mới**.
- Khoá chỉ khi không còn ngoại lệ trọng yếu (`MISSING_CHECKOUT`, `needs_review`, đơn chờ) hoặc từng ngoại lệ có giải trình.
- Sự kiện đến muộn thuộc kỳ đã khoá → lưu `needs_review` (`LATE_FOR_LOCKED_PERIOD`), **không** đổi tổng chính thức (AT06).
- Xuất: CSV UTF-8 có BOM, cột cố định; tệp kèm `period_code`, `version`, `generated_at`, `generated_by`, `row_count`, `checksum` (SHA-256 nội dung). Cấu hình mới không tính lại kỳ đã khoá (tổng lưu theo `policy_version_id` đã dùng).

## Kịch bản
- S-AT-01 (AT03): ca 22:00–06:00 `business_date`=D, vào 21:55, nghỉ ghi 02:00–02:30 (D+1), ra 06:05 → có mặt 490' − nghỉ 30' = `present=460'`; `segments` = D: 125' (21:55–24:00), D+1: 335' (00:00–06:05 trừ 30' nghỉ); một ca nghiệp vụ.
- S-AT-02 (AT03): hai cặp vào/ra 08:00–12:00 và 11:30–17:00 từ hai thiết bị → hợp các khoảng 540' (khoảng chồng 30' tính một lần); ca 08:00–17:00 `break_minutes`=60, không ghi nghỉ → `present=480'`.
- S-AT-03 (AT04): gửi `in` 3 lần cùng khoá → 1 bản ghi, 3 phản hồi cùng `event_id`.
- S-AT-04 (AT04): cùng khoá khác `kind` → 409.
- S-AT-05 (AT05): sự kiện offline `device_time` 70 giờ trước → nhận `accepted`; 80 giờ → `needs_review` (`OFFLINE_TOO_OLD`).
- S-AT-06 (AT05): nhân viên đã bị thu hồi quyền đồng bộ hàng chờ → 403, sự kiện không áp dụng.
- S-AT-07 (AT06): kỳ đã khoá, sự kiện muộn → `needs_review`, xuất phiên bản 1 không đổi checksum.
- S-AT-08 (AT07): đơn OT 5 giờ ngày thường → 422 `OT_LIMIT_DAY`; người tạo tự duyệt → 409 `SELF_APPROVAL`.
- S-AT-09: QR hết hạn 75 s → 422 `QR_EXPIRED`; chữ ký sai → 422 `QR_INVALID`.
- Ca biên: ca không có sự kiện → `ABSENT` (không phải 0 giờ có mặt mà là trạng thái riêng); `device_time` tương lai > 5' → `needs_review`; DST không có ở VN nhưng mã dùng instant UTC nên đúng với múi giờ có DST.
