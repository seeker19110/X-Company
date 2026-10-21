// Route chấm công: POST /api/app/attendance/events (Idempotency-Key bắt buộc), GET /api/app/attendance/qr/:worksiteId.
import { z } from "zod";
import { getPool } from "../db/index.ts";
import {
  authorize,
  isValidIdempotencyKey,
  json,
  readJson,
  withActor,
  type ActorRequestContext,
} from "../http/index.ts";
import { AppError } from "../nen/app-error.ts";
import { recordEvent } from "./events.ts";
import { policyAt } from "./policy.ts";
import { issueQr } from "./qr.ts";
import { kb, secondsToMs } from "../nen/units.ts";
import { t } from "../i18n/index.ts";

/** Thân POST /api/app/attendance/events — xuất ra cho hợp đồng OpenAPI (scripts/gen-openapi.ts). */
export const EventBody = z.object({
  kind: z.enum(["in", "out", "break_start", "break_end"]),
  device_time: z.iso.datetime({ offset: true }),
  source: z.enum(["qr", "gps", "kiosk"]),
  queued: z.boolean().optional(),
  device: z.string().max(100).nullish(),
  worksite_id: z.uuid().nullish(),
  qr: z.string().max(1000).nullish(),
  geo: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      accuracy_m: z.number().nonnegative().max(100000),
      captured_at: z.iso.datetime({ offset: true }),
    })
    .nullish(),
});

/** Nhân viên còn làm việc (chưa nghỉ việc) — thu hồi tư cách nhân viên chặn chấm công kể cả bản gửi muộn (AT05). */
async function activeEmployee(ctx: ActorRequestContext): Promise<string> {
  const employeeId = ctx.actor.employeeId;
  if (!employeeId) throw new AppError("NO_EMPLOYEE", 403, t("err.shared.taiKhoanKhongGanHoSo"));
  const { rows } = await getPool().query<{ ended: boolean }>(
    "SELECT terminated_on IS NOT NULL AND terminated_on <= (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS ended FROM employee WHERE id = $1",
    [employeeId],
  );
  if (!rows[0] || rows[0].ended)
    throw new AppError("EMPLOYMENT_ENDED", 403, t("err.attendance.hoSoNhanVienKhongCon"));
  return employeeId;
}

/** Trần độ dài khoá theo CHECK của `attendance_event.idempotency_key` (migration 0008). */
const ATTENDANCE_KEY_MAX = 100;

export async function handleEvent(
  ctx: ActorRequestContext,
  body: unknown,
  idempotencyKey: string | null,
  queued = false,
) {
  const employeeId = await activeEmployee(ctx);
  await authorize(ctx, "attendance.write_own", {
    companyId: ctx.actor.companyId,
    ownerEmployeeId: employeeId,
  });
  if (!isValidIdempotencyKey(idempotencyKey, ATTENDANCE_KEY_MAX))
    throw new AppError("IDEMPOTENCY_KEY_REQUIRED", 400, t("err.attendance.thieuIdempotencyKeyHopLe"));
  const b = EventBody.parse(body);
  return recordEvent(
    getPool(),
    { userId: ctx.actor.userId, companyId: ctx.actor.companyId, employeeId, requestId: ctx.requestId },
    {
      idempotencyKey,
      kind: b.kind,
      deviceTime: new Date(b.device_time),
      source: b.source,
      queued: queued || !!b.queued,
      device: b.device ?? null,
      worksiteId: b.worksite_id ?? null,
      qr: b.qr ?? null,
      geo: b.geo
        ? {
            lat: b.geo.lat,
            lng: b.geo.lng,
            accuracyM: b.geo.accuracy_m,
            capturedAt: new Date(b.geo.captured_at),
          }
        : null,
    },
  );
}

export function eventResponseBody(r: Awaited<ReturnType<typeof recordEvent>>) {
  return {
    event_id: r.eventId,
    status: r.status,
    review_reason: r.reviewReason,
    server_received_at: r.serverReceivedAt.toISOString(),
    shift_assignment_id: r.shiftAssignmentId,
    geo_stored: r.geoStored,
  };
}

export const postEvent = withActor(async (ctx) => {
  const r = await handleEvent(ctx, await readJson(ctx.req, kb(8)), ctx.req.headers.get("idempotency-key"));
  return json(eventResponseBody(r), r.replayed ? 200 : 201);
});

export const getQr = withActor(async (ctx) => {
  const worksiteId = new URL(ctx.req.url).pathname.split("/").pop() ?? "";
  if (!z.uuid().safeParse(worksiteId).success)
    throw new AppError("NOT_FOUND", 404, t("err.attendance.khongTimThayDiaDiem"));
  const { rows } = await getPool().query<{ branch_id: string | null }>(
    "SELECT branch_id FROM worksite WHERE company_id = $1 AND id = $2 AND active",
    [ctx.actor.companyId, worksiteId],
  );
  if (!rows[0]) throw new AppError("NOT_FOUND", 404, t("err.attendance.khongTimThayDiaDiem"));
  await authorize(
    ctx,
    "attendance.qr_display",
    { companyId: ctx.actor.companyId, branchId: rows[0].branch_id },
    { type: "worksite", id: worksiteId },
  );
  const now = new Date();
  const policy = await policyAt(getPool(), ctx.actor.companyId, now);
  const token = issueQr(ctx.actor.companyId, worksiteId, policy.qrTtlSec, now);
  return json({
    token,
    ttl_sec: policy.qrTtlSec,
    expires_at: new Date(now.getTime() + secondsToMs(policy.qrTtlSec)).toISOString(),
  });
});
