// Đọc body request có TRẦN byte (tách khỏi index.ts để idempotency.ts dùng được mà không vòng import).
import { AppError } from "../nen/app-error.ts";
import { log } from "../nen/log.ts";
import { t } from "../i18n/index.ts";

/**
 * Đọc body theo luồng có TRẦN byte: request chunked không có Content-Length cũng bị cắt ngay khi vượt trần (không nạp hết vào RAM
 * rồi mới kiểm). Content-Length khai lớn hơn trần → từ chối trước khi đọc.
 */
export async function readCapped(req: Request, maxBytes: number): Promise<Uint8Array> {
  const tooLarge = () => new AppError("PAYLOAD_TOO_LARGE", 413, t("err.http.duLieuQuaLon"));
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw tooLarge();
  if (req.body === null) return new Uint8Array(0);
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      // Không await: với nhánh `req.clone()` (tee) lời hứa cancel chỉ xong khi CẢ HAI nhánh huỷ → treo.
      void reader.cancel().catch((err: unknown) => log.debug("huỷ luồng body lỗi", { err: String(err) }));
      throw tooLarge();
    }
    parts.push(value);
  }
  return Buffer.concat(parts, total);
}

/** multipart/form-data với trần byte (đọc có trần rồi mới phân tích; lỗi định dạng → 400 BAD_FORM). */
export async function readFormCapped(req: Request, maxBytes: number): Promise<FormData> {
  const data = await readCapped(req, maxBytes);
  try {
    return await new Response(Buffer.from(data), {
      headers: { "content-type": req.headers.get("content-type") ?? "" },
    }).formData();
  } catch {
    throw new AppError("BAD_FORM", 400, t("err.shared.canMultipartFormData"));
  }
}
