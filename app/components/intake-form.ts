// Phần chung của biểu mẫu công khai gửi vào hộp tiếp nhận (liên hệ, ứng tuyển): đọc phản hồi API → trạng thái form.
import { t } from "@/lib/i18n/client-site";
import { toFieldErrors, type FieldErrors } from "./form-parts";

export type IntakeState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; code: string }
  | { kind: "error"; message: string; fields: FieldErrors };

type IntakeBody = { code?: unknown; error?: { message?: unknown }; fields?: unknown };

/** Thân JSON đối tượng, hoặc null khi rỗng/HTML/không phải đối tượng. */
function parseJson(text: string): IntakeBody | null {
  try {
    const v: unknown = JSON.parse(text);
    return v !== null && typeof v === "object" ? (v as IntakeBody) : null;
  } catch {
    return null; // thân HTML/rỗng: người gọi dùng thông điệp lỗi máy chủ có mã
  }
}

/**
 * Phản hồi của POST /api/public/{inquiries,applications} → trạng thái form (AUD-XFEAT-007). Thân không phải JSON
 * (502/5xx HTML từ proxy) là lỗi máy chủ kèm mã, không phải mất mạng; 2xx thiếu mã hồ sơ không được báo "đã gửi".
 * `inputs` = tên các ô nhập thật; lỗi ở trường khác (vd. submission_id) chỉ hiện ở thông báo chung.
 */
export function intakeResult(status: number, text: string, inputs: ReadonlySet<string>): IntakeState {
  const body = parseJson(text);
  if (status >= 200 && status < 300 && typeof body?.code === "string")
    return { kind: "done", code: body.code };
  const msg = body?.error?.message;
  const { fields } = toFieldErrors(Array.isArray(body?.fields) ? body.fields : [], (p) =>
    inputs.has(p) ? p : null,
  );
  return {
    kind: "error",
    message: typeof msg === "string" && msg !== "" ? msg : t("contact.serverError", { status }),
    fields,
  };
}
