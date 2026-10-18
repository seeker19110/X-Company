---
title: SPEC-work
features: [F-007, F-008, F-009, F-010, F-012]
status: approved
approved_by: "autopilot D-006"
approved_at: 2026-10-18
updated: 2026-10-18
---

# SPEC — Dự án, công việc, nghiệm thu, tiến độ, giờ dự án, tệp, dashboard (F-007…F-010, F-012)

Trạng thái: Approved for implementation (D-006)

> Nguồn: kế hoạch §7, §8, §11. Nghiệm thu: AT09, AT10, AT11, AT02 (tệp). Cập nhật 2026-10-18.

## Mô hình
- `project` (chủ nhiệm, phạm vi, ngày bắt đầu, hạn, trạng thái) → `work_package` (hạng mục, cây) → `task` → `checklist_item`.
- `task`: `responsible_employee_id` (đúng **một**), `collaborators[]`, `reviewer_employee_id` (người nghiệm thu), `due_date`, `priority`, `estimate_minutes`, `acceptance_criteria` (bắt buộc khi `requires_acceptance`), `evidence_required` (bool), `weight` (chỉ ở hạng mục lá — xem tiến độ), `version` (khoá lạc quan).
- `milestone(project, name, due_date, baseline_due_date)`; `dependency(predecessor, successor, type='FS')`.
- `plan_baseline(project, version, approved_by, approved_at, snapshot JSONB)`: trọng số + hạn đã duyệt.

## Trạng thái công việc (§7)
`todo → in_progress → awaiting_acceptance → done`; nhánh `blocked` (lý do bắt buộc), `returned` (từ nghiệm thu, lý do bắt buộc → về `in_progress`), `cancelled` (lý do), `reopened` (từ `done`, lý do → `in_progress`).
- W1. Vào `awaiting_acceptance` khi thiếu bằng chứng bắt buộc → 422 `EVIDENCE_REQUIRED` (AT09).
- W2. `done` chỉ qua quyết định nghiệm thu của `reviewer` ≠ `responsible` (việc `requires_acceptance=false` cấu hình "hoàn thành giản lược" — vẫn ghi lịch sử).
- W3. Mọi chuyển trạng thái, đổi hạn, đổi người chịu trách nhiệm, đổi phạm vi → `task_history` (trước/sau/lý do/người) + thông báo người bị ảnh hưởng (AT11).
- W4. Cập nhật kèm `version` cũ → 409 `VERSION_CONFLICT` (không "bản cuối thắng" — §10).
- W5. `cancelled` không tính hoàn thành.

## Tiến độ (§7, AT10)
- Ba con số tách: `planned_pct` (theo baseline + ngày), `reported_pct` (người thực hiện báo), `accepted_pct` (đã nghiệm thu).
- `accepted_pct(project) = Σ(weight_leaf × accepted_ratio_leaf) / Σ weight_leaf` trên **hạng mục lá** của baseline đã duyệt; `accepted_ratio_leaf` = tỷ lệ trọng số task `done` trong hạng mục lá (task trong lá chia đều nếu không có trọng số riêng). Cha không có trọng số riêng → không cộng trùng.
- Ví dụ chuẩn: lá trọng số 20/30/50, nghiệm thu 100%/50%/0% → **35%**.
- Chia một task thành nhiều task nhỏ trong cùng lá **không** đổi trọng số lá → không tự tăng tiến độ.
- Đổi trọng số/phạm vi cần baseline mới được duyệt; baseline cũ giữ nguyên.

## Giờ dự án (F-009)
- `timesheet_entry(employee, task, business_date, minutes, note)`; duyệt bởi PM/trưởng nhóm. Đối chiếu với `present_minutes` cùng ngày: chênh lệch > ngưỡng⚙(60') cần lý do; **không ép** hai tổng bằng nhau (§6). Không cộng trùng thời gian giữa hai dự án: tổng giờ dự án một ngày > present → cảnh báo `PROJECT_GT_PRESENT`.

## Tệp & bình luận (F-010)
- `file_object` private (lưu qua adapter, khoá ngẫu nhiên, sha256, mime đã dò từ nội dung, kích thước ≤ giới hạn⚙ 20 MB); `document` + `document_version`.
- Tải về chỉ qua route có xác thực `/api/app/files/:id` → kiểm quyền đối tượng chứa tệp mỗi lần (thu hồi có hiệu lực ngay — §12); không phát URL công khai.
- `comment(object_type, object_id, author, body, created_at)`; quyền đọc = quyền đọc đối tượng.

## Dashboard ngoại lệ (F-012)
- Mỗi cảnh báo có `owner` và `next_action`: việc quá hạn, mốc nguy cơ trễ (planned > accepted + ngưỡng⚙ 10 điểm % và hạn ≤ 7 ngày), việc `blocked` > 3 ngày⚙, công cần xử lý (ngoại lệ chấm công trong phạm vi).
- Bảng mốc bàn giao luôn hiển thị riêng, không bị % tổng che.

## Kịch bản
- S-WK-01 (AT09): task `evidence_required`, chuyển `awaiting_acceptance` không tệp → 422.
- S-WK-02 (AT09): reviewer trả lại kèm lý do → `returned` → `in_progress`, lịch sử có 2 dòng; mở lại `done` → lịch sử có lý do.
- S-WK-03 (AT10): ví dụ 20/30/50 → 35%; tách task 30% thành 3 task, 1 task done → tỷ lệ lá theo số task done/tổng trong lá, không vượt trọng số lá.
- S-WK-04 (AT11): phân công cho nhân viên có đơn nghỉ đã duyệt trùng `due_date` → cảnh báo `ASSIGNEE_ON_LEAVE` (không chặn).
- S-WK-05 (AT02): nhân viên ngoài dự án tải tệp của task → 403; thành viên được chia sẻ → 200.
- S-WK-06: hai người sửa cùng task với cùng `version` → người thứ hai 409.
- Ca biên: dự án không có lá trọng số → `accepted_pct = null` (không phải 0); tổng trọng số 0 → null; reviewer = responsible → 409 `SELF_APPROVAL`.

## Tiêu chí chấp nhận

Mỗi tiêu chí `AC-<MIỀN>-NN` ánh xạ 1-1 tới một kịch bản `S-*` ở mục Kịch bản; test mang mã `S-*` trong `tests/` hoặc `e2e/` (script `npm run -s check:docs` đối chiếu AC → S-ID → test, WF-SDD-003). Loại: chuẩn · lỗi (ca lỗi) · biên.

| ID | Loại | Tiêu chí (Given/When/Then) | Kịch bản (S-ID) |
|---|---|---|---|
| AC-WK-01 | lỗi | Given task `evidence_required`, When chuyển `awaiting_acceptance` không tệp, Then 422 `EVIDENCE_REQUIRED` | S-WK-01 |
| AC-WK-02 | lỗi | Given reviewer trả lại kèm lý do, Then `returned` → `in_progress`, lịch sử 2 dòng; mở lại `done` có lý do | S-WK-02 |
| AC-WK-03 | chuẩn | Given lá trọng số 20/30/50 nghiệm thu 100%/50%/0%, Then `accepted_pct` = 35%; tách task trong lá không vượt trọng số lá | S-WK-03 |
| AC-WK-04 | biên | Given phân công cho nhân viên có đơn nghỉ đã duyệt trùng `due_date`, Then cảnh báo `ASSIGNEE_ON_LEAVE` (không chặn) | S-WK-04 |
| AC-WK-05 | lỗi | Given nhân viên ngoài dự án, When tải tệp của task, Then bị từ chối (hiện thực trả 404 theo API-CONTRACT; spec gốc ghi 403); thành viên được chia sẻ Then 200 | S-WK-05 |
| AC-WK-06 | lỗi | Given hai người sửa cùng task với cùng `version`, Then người thứ hai 409 `VERSION_CONFLICT` | S-WK-06 |

## Ca biên

Nhóm theo PM-SPEC-003 (8 nhóm). "Phủ bởi" nêu test đã có; "chưa có test" là nợ ghi rõ, không phải đã phủ.

| Nhóm | Ca biên | Hành vi mong đợi | Phủ bởi |
|---|---|---|---|
| Rỗng/null | dự án không có lá trọng số; tổng trọng số 0 | `accepted_pct` = null (không phải 0) | `tests/unit/progress.test.ts` |
| Cực đại | tệp vượt 20 MB; tổng giờ dự án một ngày vượt 24 giờ | 413; bị từ chối | `tests/http/files.test.ts`, `tests/db/timesheet.test.ts` |
| Trùng lặp/idempotency | tách một task thành nhiều task nhỏ trong cùng lá | trọng số lá không đổi, tiến độ không tự tăng | `tests/unit/progress.test.ts` |
| Song song | hai người sửa cùng `version` | người thứ hai 409 (không "bản cuối thắng") | S-WK-06 |
| Mất mạng giữa chừng | không áp dụng: ngoại tuyến và gửi lại thuộc SPEC-pwa (hàng chờ + `version` kiểm khi nhận muộn) | — | — |
| Thời gian/múi giờ | `due_date` theo giờ VN trùng đơn nghỉ | cảnh báo `ASSIGNEE_ON_LEAVE` | `tests/db/assign-warning.test.ts` |
| Quyền | reviewer = responsible; người ngoài dự án tải tệp; PM xem đối chiếu giờ (R4) | 409 `SELF_APPROVAL`; 404; 403 | `tests/db/tasks.test.ts`, `tests/http/files.test.ts`, `tests/db/timesheet.test.ts` |
| Tiền/đơn vị | thời lượng là phút số nguyên (`estimate_minutes`, giờ dự án); chi phí/tiền thuộc P1 | không float; tách có mặt / OT duyệt / giờ dự án | `tests/db/timesheet.test.ts` |

## Câu hỏi mở

- Spec chưa có câu hỏi mở nào còn treo — các giá trị ⚙ (ngưỡng 60', 10 điểm %, 3 ngày, 20 MB) là cấu hình, HR/chủ sản phẩm chốt ở F02 (xem D-007).
