// POST /api/app/sync — đồng bộ lô hàng chờ ngoại tuyến (SPEC-pwa). Mỗi bản ghi xử lý ĐỘC LẬP bằng đúng nghiệp vụ trực
// tuyến (kiểm quyền, nhân viên còn hiệu lực, kỳ khoá…) với id bản ghi = Idempotency-Key và cờ queued; lỗi của bản ghi
// này không làm hỏng bản ghi khác. Chỉ thao tác được phép ngoại tuyến (chấm công) — duyệt/quyền/khoá kỳ không có ở đây.
import { z } from "zod";
// $ZodError là lớp gốc chung của zod đầy đủ và zod/mini (schema dùng chung client/server viết bằng mini).
import { $ZodError } from "zod/v4/core";
import { eventResponseBody, handleEvent } from "../attendance/routes.ts";
import { json, readJson, withActor } from "../http/index.ts";
import { AppError } from "../nen/app-error.ts";
import type { ItemResult } from "./queue.ts";
import { kb } from "../nen/units.ts";
import { t } from "../i18n/index.ts";

/** Thân POST /api/app/sync — xuất ra cho hợp đồng OpenAPI. */
export const Batch = z.object({
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

// Không bắt Idempotency-Key header: mỗi bản ghi đã idempotent theo `id` bản ghi hàng chờ (= khoá chấm công, UNIQUE trong DB).
// BE-REL-006: giới hạn theo user_id (mỗi request tới 50 bản ghi) — 60 lô/phút, dư cho thiết bị thử lại sau khi có mạng.
const SYNC_LIMIT = { bucket: "sync.post", max: 60, windowSec: 60 };

export const postSync = withActor(
  async (ctx) => {
    const b = Batch.parse(await readJson(ctx.req, kb(256)));
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
        } else if (err instanceof $ZodError)
          results.push({
            id: item.id,
            ok: false,
            httpStatus: 400,
            code: "VALIDATION",
            message: t("err.sync.invalidRecord"),
          });
        else
          results.push({
            id: item.id,
            ok: false,
            httpStatus: 500,
            code: "INTERNAL",
            message: t("err.sync.internalRetry"),
          });
      }
    }
    return json({ results });
  },
  { rateLimit: SYNC_LIMIT },
);
