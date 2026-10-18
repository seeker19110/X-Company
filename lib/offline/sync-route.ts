// POST /api/app/sync — đồng bộ lô hàng chờ ngoại tuyến (SPEC-pwa). Mỗi bản ghi xử lý ĐỘC LẬP bằng đúng nghiệp vụ trực
// tuyến (kiểm quyền, nhân viên còn hiệu lực, kỳ khoá…) với id bản ghi = Idempotency-Key và cờ queued; lỗi của bản ghi
// này không làm hỏng bản ghi khác. Chỉ thao tác được phép ngoại tuyến (chấm công) — duyệt/quyền/khoá kỳ không có ở đây.
import { z } from "zod";
import { ZodError } from "zod";
import { eventResponseBody, handleEvent } from "../attendance/routes.ts";
import { json, readJson, withActor } from "../http/index.ts";
import { AppError } from "../nen/app-error.ts";
import type { ItemResult } from "./queue.ts";

const Batch = z.object({
  items: z
    .array(
      z.object({
        id: z.uuid(),
        kind: z.literal("attendance"),
        payload: z.record(z.string(), z.unknown()),
        created_at: z.iso.datetime({ offset: true }),
      }),
    )
    .min(1)
    .max(50),
});

export const postSync = withActor(async (ctx) => {
  const b = Batch.parse(await readJson(ctx.req, 256 * 1024));
  const results: ItemResult[] = [];
  for (const item of b.items) {
    try {
      const r = await handleEvent(ctx, item.payload, item.id, true);
      const body = eventResponseBody(r);
      results.push({
        id: item.id,
        ok: true,
        status: body.status,
        reviewReason: body.review_reason,
        eventId: body.event_id,
      });
    } catch (err) {
      if (err instanceof AppError) {
        const ra = err.details?.retryAfter;
        results.push({
          id: item.id,
          ok: false,
          httpStatus: err.status,
          code: err.code,
          message: err.message,
          ...(typeof ra === "number" ? { retryAfterSec: ra } : {}),
        });
      } else if (err instanceof ZodError)
        results.push({
          id: item.id,
          ok: false,
          httpStatus: 400,
          code: "VALIDATION",
          message: "Dữ liệu bản ghi không hợp lệ",
        });
      else
        results.push({
          id: item.id,
          ok: false,
          httpStatus: 500,
          code: "INTERNAL",
          message: "Lỗi hệ thống, sẽ thử lại",
        });
    }
  }
  return json({ results });
});
