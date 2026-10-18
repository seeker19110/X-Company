// Schema biểu mẫu liên hệ — MỘT nguồn cho client (app/components/contact-form.tsx) và server (routes.ts) (FE-FORM-001).
// Mô-đun thuần: chỉ zod, không pg/next (ESLint theo quy ước *.pure.ts).
import { z } from "zod";

export const phoneRe = /^\+?[0-9][0-9 .-]{6,18}[0-9]$/;

export const InquiryInput = z
  .object({
    submission_id: z.uuid(),
    name: z.string().trim().min(1, "Vui lòng nhập họ tên").max(120),
    email: z.email("Email không hợp lệ").max(254).nullish(),
    phone: z.string().trim().regex(phoneRe, "Số điện thoại không hợp lệ").nullish(),
    message: z.string().trim().min(1, "Vui lòng nhập nhu cầu").max(4000),
    service: z
      .string()
      .regex(/^[a-z0-9-]{1,80}$/)
      .nullish(),
    consent: z.literal(true, { error: "Cần đồng ý xử lý dữ liệu để gửi" }),
    website: z.string().max(200).optional().default(""),
    elapsed_ms: z.number().int().nonnegative().optional(),
    source: z.string().max(300).nullish(),
  })
  .refine((v) => !!v.email || !!v.phone, {
    message: "Cần email hoặc điện thoại",
    path: ["email"],
    // Chạy cả khi ô khác đã lỗi: người dùng thấy đủ lỗi trong một lần gửi (FE-FORM-002), không phải sửa dần.
    when: (p) => typeof p.value === "object" && p.value !== null,
  });
export type InquiryInputT = z.infer<typeof InquiryInput>;
