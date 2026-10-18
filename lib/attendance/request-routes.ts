// Route đơn từ + phê duyệt: GET /api/app/approvals, POST /api/app/approvals/:type/:id/:decision,
// POST /api/app/leave-requests, POST /api/app/ot-requests, POST /api/app/adjustments.
import { z } from "zod";
import { getPool, withTx } from "../db/index.ts";
import { json, readJson, withActor, type GuardOptions } from "../http/index.ts";
import { AppError } from "../nen/app-error.ts";
import { decide, pendingApprovals, type ApprovalType } from "./approvals.ts";
import { requestLeave } from "./leave.ts";
import { requestOt } from "./ot.ts";
import { requestAdjustment } from "./period.ts";
import { AdjustmentInput, LeaveInput, OtInput } from "./request-schema.pure.ts";

/** POST ghi nghiệp vụ: bắt buộc Idempotency-Key (ARC-INT-001, BE-API-008). */
const IDEMPOTENT: GuardOptions = { idempotent: true };

export const getApprovals = withActor(async (ctx) =>
  json({ items: await pendingApprovals(getPool(), ctx.actor) }),
);

export const postDecision = withActor(async (ctx) => {
  const parts = new URL(ctx.req.url).pathname.split("/");
  const decision = parts.pop();
  const id = parts.pop() ?? "";
  const type = parts.pop() as ApprovalType;
  if (
    !["approve", "reject"].includes(decision ?? "") ||
    !["leave", "ot", "adjustment"].includes(type) ||
    !z.uuid().safeParse(id).success
  )
    throw new AppError("NOT_FOUND", 404, "Không tìm thấy");
  const b = z.object({ note: z.string().max(1000).nullish() }).parse(await readJson(ctx.req));
  await withTx((tx) => decide(tx, ctx.actor, type, id, decision as "approve" | "reject", b.note));
  return json({ ok: true });
}, IDEMPOTENT);

export const postLeave = withActor(async (ctx) => {
  const b = LeaveInput.parse(await readJson(ctx.req));
  const id = await withTx((tx) =>
    requestLeave(tx, ctx.actor, {
      leaveTypeId: b.leave_type_id,
      startAt: new Date(b.start_at),
      endAt: new Date(b.end_at),
      minutes: b.minutes,
      reason: b.reason,
    }),
  );
  return json({ id }, 201);
}, IDEMPOTENT);

export const postOt = withActor(async (ctx) => {
  const b = OtInput.parse(await readJson(ctx.req));
  const id = await withTx((tx) =>
    requestOt(tx, ctx.actor, {
      businessDate: b.business_date,
      minutes: b.minutes,
      reason: b.reason,
      consent: b.consent,
    }),
  );
  return json({ id }, 201);
}, IDEMPOTENT);

export const postAdjustment = withActor(async (ctx) => {
  const b = AdjustmentInput.parse(await readJson(ctx.req));
  if (!ctx.actor.employeeId) throw new AppError("NO_EMPLOYEE", 403, "Tài khoản không gắn hồ sơ nhân viên");
  const id = await withTx((tx) =>
    requestAdjustment(tx, ctx.actor, {
      employeeId: ctx.actor.employeeId!,
      action: b.action,
      targetEventId: b.target_event_id,
      newKind: b.new_kind,
      newAt: b.new_at ? new Date(b.new_at) : undefined,
      reason: b.reason,
    }),
  );
  return json({ id }, 201);
}, IDEMPOTENT);
