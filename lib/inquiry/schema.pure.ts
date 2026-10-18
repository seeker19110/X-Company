// Schema biểu mẫu liên hệ — MỘT nguồn cho client (app/components/contact-form.tsx) và server (routes.ts) (FE-FORM-001).
// Mô-đun thuần: chỉ zod, không pg/next (ESLint theo quy ước *.pure.ts). Viết bằng `zod/mini` (API hàm, tree-shake được):
// client nạp động schema này, zod đầy đủ sẽ thêm ~30 KB gzip vào JS tĩnh (FE-PERF-004).
import * as z from "zod/mini";

export const phoneRe = /^\+?[0-9][0-9 .-]{6,18}[0-9]$/;

export const InquiryInput = z
  .object({
    submission_id: z.uuid(),
    name: z.string().check(z.trim(), z.minLength(1, "Vui lòng nhập họ tên"), z.maxLength(120)),
    email: z.nullish(z.email("Email không hợp lệ").check(z.maxLength(254))),
    phone: z.nullish(z.string().check(z.trim(), z.regex(phoneRe, "Số điện thoại không hợp lệ"))),
    message: z.string().check(z.trim(), z.minLength(1, "Vui lòng nhập nhu cầu"), z.maxLength(4000)),
    service: z.nullish(z.string().check(z.regex(/^[a-z0-9-]{1,80}$/))),
    consent: z.literal(true, { error: "Cần đồng ý xử lý dữ liệu để gửi" }),
    website: z._default(z.optional(z.string().check(z.maxLength(200))), ""),
    elapsed_ms: z.optional(z.number().check(z.int(), z.nonnegative())),
    source: z.nullish(z.string().check(z.maxLength(300))),
  })
  .check(
    z.refine((v) => !!v.email || !!v.phone, {
      message: "Cần email hoặc điện thoại",
      path: ["email"],
      // Chạy cả khi ô khác đã lỗi: người dùng thấy đủ lỗi trong một lần gửi (FE-FORM-002), không phải sửa dần.
      when: (p) => typeof p.value === "object" && p.value !== null,
    }),
  );
export type InquiryInputT = z.infer<typeof InquiryInput>;
