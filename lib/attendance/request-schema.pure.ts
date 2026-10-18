// Schema đơn nghỉ / OT / sửa công — MỘT nguồn cho client (app/components/request-forms.tsx) và server
// (request-routes.ts) (FE-FORM-001). Mô-đun thuần: chỉ zod. Thông điệp lỗi nói cách sửa (FE-FORM-002).
import { z } from "zod";

const iso = z.iso.datetime({ offset: true, error: "Vui lòng chọn ngày và giờ hợp lệ" });
const reasonRequired = z
  .string({ error: "Vui lòng nhập lý do" })
  .trim()
  .min(1, "Vui lòng nhập lý do")
  .max(1000, "Lý do tối đa 1000 ký tự");

export const LeaveInput = z.object({
  leave_type_id: z.uuid({ error: "Vui lòng chọn loại nghỉ" }),
  start_at: iso,
  end_at: iso,
  minutes: z
    .number({ error: "Số phút phải là số" })
    .int("Số phút phải là số nguyên")
    .positive("Số phút phải lớn hơn 0"),
  reason: z.string().max(1000, "Lý do tối đa 1000 ký tự").nullish(),
});

/** Kiểm thêm phía biểu mẫu (client): giờ kết thúc sau giờ bắt đầu. Server giữ LeaveInput (hành vi cũ). */
export const LeaveFormInput = LeaveInput.refine((v) => Date.parse(v.end_at) > Date.parse(v.start_at), {
  message: "Giờ kết thúc phải sau giờ bắt đầu",
  path: ["end_at"],
});

export const OtInput = z.object({
  business_date: z.iso.date({ error: "Vui lòng chọn ngày hợp lệ" }),
  minutes: z
    .number({ error: "Số phút phải là số" })
    .int("Số phút phải là số nguyên")
    .positive("Số phút phải lớn hơn 0"),
  reason: reasonRequired,
  consent: z.boolean(),
});

/** Biểu mẫu nhân viên tự gửi: bắt buộc tích đồng ý. Server giữ OtInput (đồng ý có thể ghi riêng sau). */
export const OtFormInput = OtInput.refine((v) => v.consent, {
  message: "Cần đồng ý làm thêm giờ để gửi đơn",
  path: ["consent"],
});

export const AdjustmentInput = z.object({
  action: z.enum(["add_event", "void_event"]),
  target_event_id: z.uuid().optional(),
  new_kind: z.enum(["in", "out", "break_start", "break_end"]).optional(),
  new_at: iso.optional(),
  reason: reasonRequired,
});
