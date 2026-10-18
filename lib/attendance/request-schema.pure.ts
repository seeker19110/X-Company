// Schema đơn nghỉ / OT / sửa công — MỘT nguồn cho client (app/components/request-forms.tsx) và server
// (request-routes.ts) (FE-FORM-001). Mô-đun thuần: chỉ zod. Thông điệp lỗi nói cách sửa (FE-FORM-002).
// Viết bằng `zod/mini` (API hàm, tree-shake được): client nạp động schema này, zod đầy đủ sẽ thêm ~30 KB gzip (FE-PERF-004).
import * as z from "zod/mini";
import { t } from "../i18n/client-app.ts";

const iso = z.iso.datetime({ offset: true, error: t("validation.request.datetime") });
const reasonRequired = z
  .string({ error: t("validation.request.reasonRequired") })
  .check(
    z.trim(),
    z.minLength(1, t("validation.request.reasonRequired")),
    z.maxLength(1000, t("validation.request.reasonMax")),
  );
const minutes = z
  .number({ error: t("validation.request.minutesNumber") })
  .check(z.int(t("validation.request.minutesInt")), z.positive(t("validation.request.minutesPositive")));

export const LeaveInput = z.object({
  leave_type_id: z.uuid({ error: t("validation.request.leaveType") }),
  start_at: iso,
  end_at: iso,
  minutes,
  reason: z.nullish(z.string().check(z.maxLength(1000, t("validation.request.reasonMax")))),
});

/** Kiểm thêm phía biểu mẫu (client): giờ kết thúc sau giờ bắt đầu. Server giữ LeaveInput (hành vi cũ). */
export const LeaveFormInput = LeaveInput.check(
  z.refine((v) => Date.parse(v.end_at) > Date.parse(v.start_at), {
    message: t("validation.request.endAfterStart"),
    path: ["end_at"],
  }),
);

export const OtInput = z.object({
  business_date: z.iso.date({ error: t("validation.request.date") }),
  minutes,
  reason: reasonRequired,
  consent: z.boolean(),
});

/** Biểu mẫu nhân viên tự gửi: bắt buộc tích đồng ý. Server giữ OtInput (đồng ý có thể ghi riêng sau). */
export const OtFormInput = OtInput.check(
  z.refine((v) => v.consent, {
    message: t("validation.request.otConsent"),
    path: ["consent"],
  }),
);

export const AdjustmentInput = z.object({
  action: z.enum(["add_event", "void_event"]),
  target_event_id: z.optional(z.uuid()),
  new_kind: z.optional(z.enum(["in", "out", "break_start", "break_end"])),
  new_at: z.optional(iso),
  reason: reasonRequired,
});
