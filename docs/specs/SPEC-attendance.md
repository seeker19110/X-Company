---
title: SPEC-attendance
features: [F-004, F-005, F-006]
status: approved
approved_by: "autopilot D-006"
approved_at: 2026-10-18
updated: 2026-10-18
---

# SPEC — Chấm công, nghỉ phép, OT, sửa công, kỳ công (F-004, F-005, F-006)

Trạng thái: Approved for implementation (D-006)

> Nguồn: kế hoạch §6, §10. Nghiệm thu: AT03, AT04, AT05, AT06, AT07, AT08. Cập nhật 2026-10-18.
> Quyết định làm rõ (tự duyệt, ghi ở đây và `docs/autopilot/DECISIONS.md`): các giá trị mặc định đánh dấu ⚙ là **cấu
> hình có ngày hiệu lực** — HR chốt ở F02 trước pilot; mã không hard-code chúng.

## Ba lớp dữ liệu (§6)
1. **Sự kiện gốc** `attendance_event` (chỉ thêm): `id`, `idempotency_key` (duy nhất theo `employee_id`), `employee_id`, `company_id`, `kind` (`in|out|break_start|break_end`), `device_time`, `server_received_at`, `source` (`qr|gps|kiosk|manual_request`), `queued` (gửi từ hàng chờ ngoại tuyến), `worksite_id`, `shift_assignment_id` (null = chưa gán), `policy_version_id`, `geo_enc` (bản mã của lat, lng, accuracy_m, captured_at — chỉ lưu khi cờ GPS bật + có đồng ý riêng, xem S-AT-14..17; cột `geo_*` bản rõ chỉ còn dữ liệu cũ), `qr_token_id`, `status` (`accepted|needs_review|rejected`), `review_reason`.
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
- I3. Lần `in` từ **thiết bị khác** trong cửa sổ trùng ⚙(2 phút) sau một `in` đã nhận còn mở → `needs_review` (`DUPLICATE_OPEN`), vẫn lưu để điều tra. Ngoài cửa sổ (đổi địa điểm, kiosk) → `accepted`; hợp khoảng (C1) bảo đảm không cộng trùng thời gian (D-011).
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
- Dòng bảng công: mỗi ca được giao một dòng; ngày có phép mà không ca → `leave_only`; ngày có OT đã duyệt mà không ca, không phép → `ot_only` (không mất OT ngày nghỉ). Phút phép của một đơn tính vào ngày (giờ VN) bắt đầu đơn và kỳ chứa ngày đó (D-012).
- Mọi thao tác duyệt làm đổi số liệu (điều chỉnh, OT, nghỉ, huỷ nghỉ) xác định kỳ **lúc duyệt** theo ngày nghiệp vụ của ca (ca qua đêm thuộc ngày bắt đầu), dưới khoá kỳ; kỳ đã khoá → chỉ `period.manage` và phát hành phiên bản số liệu + xuất mới. Log đến muộn cũng xét kỳ theo ngày nghiệp vụ.
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
- S-AT-10 (RK-001, D-031): trần OT theo luật — OT ≤ 50% giờ bình thường/ngày (4 giờ), tổng ≤ 12 giờ/ngày, ≤ 40 giờ/tháng, ≤ 200 giờ/năm (300 giờ chỉ khi cờ ngành); đúng trần ok, vượt 1 phút → vi phạm kèm mã; kiểm đồng thời, đã duyệt + đề nghị cộng dồn (`tests/unit/labor-rules.test.ts`).
- S-AT-11 (D-031): hệ số trả lương số nguyên %: thường 100, đêm 130, OT 150/200/300, OT đêm = OT + 30 + 20.
- S-AT-12 (D-031): cảnh báo (không chặn) nghỉ giữa ca 30' (ca đêm 45', chỉ ca ≥ 6 giờ), nghỉ ≥ 12 giờ giữa hai ca, nghỉ tuần ≥ 24 giờ liên tục.
- S-AT-13 (D-007, D-031): quy tắc có ngày hiệu lực, tra theo ngày nghiệp vụ; kỳ cũ giữ bản cũ.
- S-AT-14 (T-051, D-032): cờ `GEO_CAPTURE_ENABLED` tắt (mặc định) → toạ độ gửi lên bị bỏ (không lưu, không lỗi), phản hồi `geo_stored: false`, audit `geoDropped=flag_off` không có toạ độ.
- S-AT-15 (T-051): cờ bật nhưng nhân viên không có đồng ý riêng `geo_attendance` còn hiệu lực → bỏ toạ độ, audit `geoDropped=no_consent`.
- S-AT-16 (T-051): cờ bật + có đồng ý → toạ độ lưu MÃ HOÁ (`geo_enc`; cột bản rõ NULL), đọc giải mã đúng; gửi lặp giữ `geo_stored`.
- S-AT-17 (T-051): rút đồng ý (hoặc bị hạn chế xử lý) → lần gửi kế tiếp bỏ toạ độ; cấp lại → thu lại.
- S-AT-09: QR hết hạn 75 s → 422 `QR_EXPIRED`; chữ ký sai → 422 `QR_INVALID`.
- Ca biên: ca không có sự kiện → `ABSENT` (không phải 0 giờ có mặt mà là trạng thái riêng); `device_time` tương lai > 5' → `needs_review`; DST không có ở VN nhưng mã dùng instant UTC nên đúng với múi giờ có DST.

## Tiêu chí chấp nhận

Mỗi tiêu chí `AC-<MIỀN>-NN` ánh xạ 1-1 tới một kịch bản `S-*` ở mục Kịch bản; test mang mã `S-*` trong `tests/` hoặc `e2e/` (script `npm run -s check:docs` đối chiếu AC → S-ID → test, WF-SDD-003). Loại: chuẩn · lỗi (ca lỗi) · biên.

| ID | Loại | Tiêu chí (Given/When/Then) | Kịch bản (S-ID) |
|---|---|---|---|
| AC-AT-01 | chuẩn | Given ca 22:00–06:00 `business_date`=D, When vào 21:55, nghỉ ghi 02:00–02:30, ra 06:05, Then `present`=460', segments D 125' và D+1 335' | S-AT-01 |
| AC-AT-02 | chuẩn | Given hai thiết bị vào/ra 08:00–12:00 và 11:30–17:00, ca `break_minutes`=60 không ghi nghỉ, Then hợp 540' và `present`=480' | S-AT-02 |
| AC-AT-03 | chuẩn | Given gửi `in` 3 lần cùng khoá, Then 1 bản ghi, 3 phản hồi cùng `event_id` | S-AT-03 |
| AC-AT-04 | lỗi | Given cùng khoá khác nội dung, Then 409 `IDEMPOTENCY_CONFLICT` và audit `denied` | S-AT-04 |
| AC-AT-05 | biên | Given sự kiện offline 70 giờ trước Then `accepted`; 80 giờ Then `needs_review` (`OFFLINE_TOO_OLD`) | S-AT-05 |
| AC-AT-06 | lỗi | Given nhân viên đã bị thu hồi quyền, When đồng bộ hàng chờ, Then bị từ chối, sự kiện không áp dụng | S-AT-06 |
| AC-AT-07 | lỗi | Given kỳ đã khoá, When sự kiện muộn, Then `needs_review`, xuất phiên bản 1 không đổi checksum | S-AT-07 |
| AC-AT-08 | lỗi | Given đơn OT 5 giờ ngày thường Then 422 `OT_LIMIT_DAY`; người tạo tự duyệt Then 409 `SELF_APPROVAL` | S-AT-08 |
| AC-AT-09 | lỗi | Given QR hết hạn 75 s Then 422 `QR_EXPIRED`; chữ ký sai Then 422 `QR_INVALID` | S-AT-09 |
| AC-AT-10 | biên | Given OT đã duyệt + đề nghị đúng 4 giờ/ngày, 40 giờ/tháng, 200 giờ/năm Then ok; vượt 1 phút Then vi phạm `OT_LIMIT_*` (năm 300 giờ chỉ khi cờ ngành bật) | S-AT-10 |
| AC-AT-11 | chuẩn | Given giờ thường/đêm/OT ngày thường, nghỉ tuần, lễ Then hệ số 100/130/150/200/300 và OT đêm cộng 30 + 20 (số nguyên %) | S-AT-11 |
| AC-AT-12 | biên | Given nghỉ giữa ca 29' (đêm 44'), hai ca cách 11 giờ 59, 7 ngày liền không nghỉ Then cảnh báo không chặn; đúng ngưỡng Then không cảnh báo | S-AT-12 |
| AC-AT-13 | biên | Given hai phiên bản quy tắc, Then ngày trước hiệu lực dùng bản cũ, đúng ngày hiệu lực dùng bản mới | S-AT-13 |
| AC-AT-14 | lỗi | Given cờ GPS tắt, When client gửi `geo`, Then 201, toạ độ không được lưu, `geo_stored`=false, audit không chứa toạ độ | S-AT-14 |
| AC-AT-15 | lỗi | Given cờ bật nhưng không có đồng ý riêng còn hiệu lực, When gửi `geo`, Then bỏ toạ độ, audit `geoDropped=no_consent` | S-AT-15 |
| AC-AT-16 | chuẩn | Given cờ bật + đồng ý riêng, When gửi `geo`, Then lưu dạng mã hoá, bản rõ NULL, đọc giải mã đúng | S-AT-16 |
| AC-AT-17 | biên | Given đã có đồng ý rồi rút (hoặc bị hạn chế xử lý), When gửi `geo`, Then bỏ toạ độ ngay; cấp lại thì thu lại | S-AT-17 |

## Ca biên

Nhóm theo PM-SPEC-003 (8 nhóm). "Phủ bởi" nêu test đã có; "chưa có test" là nợ ghi rõ, không phải đã phủ.

| Nhóm | Ca biên | Hành vi mong đợi | Phủ bởi |
|---|---|---|---|
| Rỗng/null | ca không có sự kiện; thiếu `out` cuối | `ABSENT` với `present_minutes` null (không phải 0); `MISSING_CHECKOUT`, không tự điền giờ ra | `tests/unit/compute-shift.test.ts` |
| Cực đại | hàng chờ quá 72 giờ; OT vượt hạn ngày/tháng/năm | `OFFLINE_TOO_OLD`; `OT_LIMIT_<DAY|MONTH|YEAR>`, trả mọi hạn mức vượt | `tests/http/attendance-events.test.ts`, `tests/db/leave-ot.test.ts` |
| Trùng lặp/idempotency | cùng khoá 3 lần; cùng khoá khác nội dung; `in` từ hai thiết bị trong 2 phút | một bản ghi; 409; `DUPLICATE_OPEN` (D-011) | `tests/http/attendance-events.test.ts` |
| Song song | gửi đồng thời cùng khoá; đơn nghỉ trùng đồng thời | vẫn một bản ghi; DB chặn `LEAVE_OVERLAP` | `tests/http/attendance-events.test.ts`, `tests/db/leave-ot.test.ts` |
| Mất mạng giữa chừng | đồng bộ muộn từ hàng chờ; QR hết hạn trong hàng chờ; sự kiện muộn của kỳ khoá | lưu `needs_review`, không đổi tổng chính thức | `tests/http/attendance-events.test.ts`, `tests/db/period.test.ts` |
| Thời gian/múi giờ | ca qua đêm; lệch giờ thiết bị > 5'; `device_time` tương lai; múi giờ có DST | `CLOCK_SKEW`/`FUTURE_TIME` → `needs_review`; tính theo instant UTC | `tests/unit/compute-shift.test.ts`, `tests/http/attendance-events.test.ts` |
| Quyền | tự duyệt OT; tài khoản bị vô hiệu/nghỉ việc khi đồng bộ | 409 `SELF_APPROVAL`; 401/403 | S-AT-06, S-AT-08 |
| Tiền/đơn vị | phút là số nguyên (bỏ giây trước khi tính); giờ OT quy ra phút; không có tiền ở P0 (bảng công xuất cho hệ lương khác) | tổng và các đoạn theo ngày luôn khớp; không float | `tests/unit/compute-shift.test.ts` |

## Câu hỏi mở

- Giá trị quy tắc ca/OT/nghỉ chưa được HR chốt (F02) — Đã quyết: D-007 (cấu hình có ngày hiệu lực, mặc định ⚙; HR chốt trước pilot).
- I3 (vào lần 2 khi có ca mở) mâu thuẫn S-AT-02 — Đã quyết: D-011 (chỉ cửa sổ trùng ⚙2 phút từ thiết bị khác).
- Phút nghỉ phép của đơn nhiều ngày / qua hai kỳ — Đã quyết: D-012 (tính vào ngày bắt đầu đơn và kỳ chứa ngày đó).
