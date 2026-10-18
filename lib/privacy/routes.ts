// Route nội bộ DSAR (T-040): GET/POST /api/app/privacy/requests, POST /api/app/privacy/requests/:id/:action
// (start | complete | reject), GET /api/app/privacy/requests/:id/export (xuất dữ liệu cho yêu cầu truy cập).
// Quyền `privacy.manage` (HR) kiểm ở server; ghi nghiệp vụ bắt buộc Idempotency-Key. Xuất dữ liệu là GET (không lưu bản
// phản hồi chứa PII vào idempotency_record).
import { z } from "zod";
import { getPool, withTx } from "../db/index.ts";
import { authorize, json, readJson, withActor, type ActorRequestContext } from "../http/index.ts";
import { AppError } from "../nen/app-error.ts";
import { parsePage } from "../nen/pagination.ts";
import {
  completeRequest,
  createRequest,
  CreateRequestInput,
  exportSubject,
  listRequestsPage,
  rejectRequest,
  startRequest,
  type PrivacyActor,
} from "./index.ts";
import { t } from "../i18n/index.ts";

export const STATUSES = ["received", "in_progress", "done", "rejected"] as const;
export const ACTIONS = ["start", "complete", "reject"] as const;
type Action = (typeof ACTIONS)[number];

const guard = (ctx: ActorRequestContext) =>
  authorize(ctx, "privacy.manage", { companyId: ctx.actor.companyId }, { type: "data_subject_request" });

const actorOf = (ctx: ActorRequestContext): PrivacyActor => ({
  userId: ctx.actor.userId,
  companyId: ctx.actor.companyId,
  requestId: ctx.requestId,
});

export const getRequests = withActor(async (ctx) => {
  await guard(ctx);
  const q = new URL(ctx.req.url).searchParams;
  const status = q.get("status");
  if (status !== null && !(STATUSES as readonly string[]).includes(status))
    throw new AppError("VALIDATION", 400, t("err.privacy.statusKhongHopLe"));
  const page = await listRequestsPage(getPool(), ctx.actor.companyId, {
    status: (status as (typeof STATUSES)[number] | null) ?? undefined,
    overdueOnly: q.get("overdue") === "1",
    page: parsePage(q),
  });
  return json(page);
});

export const postRequest = withActor(
  async (ctx) => {
    await guard(ctx);
    const input = CreateRequestInput.parse(await readJson(ctx.req));
    const row = await withTx((tx) => createRequest(tx, actorOf(ctx), input));
    return json({ request: row }, 201);
  },
  { idempotent: true },
);

function idAndAction(req: Request): { id: string; action: string } {
  const parts = new URL(req.url).pathname.split("/");
  const action = parts.pop() ?? "";
  const id = parts.pop() ?? "";
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND", 404, t("err.shared.khongTimThay"));
  return { id, action };
}

export const ActionBody = z.object({ reason: z.string().trim().max(1000).nullish() });

export const postRequestAction = withActor(
  async (ctx) => {
    const { id, action } = idAndAction(ctx.req);
    if (!(ACTIONS as readonly string[]).includes(action as Action))
      throw new AppError("NOT_FOUND", 404, t("err.shared.khongTimThay"));
    await guard(ctx);
    const body = ActionBody.parse(await readJson(ctx.req));
    const actor = actorOf(ctx);
    const row = await withTx((tx) => {
      if (action === "start") return startRequest(tx, actor, id);
      if (action === "complete") return completeRequest(tx, actor, id);
      if (!body.reason) throw new AppError("VALIDATION", 422, t("err.privacy.canNeuCanCuTuChoi2"));
      return rejectRequest(tx, actor, id, body.reason);
    });
    return json({ request: row });
  },
  { idempotent: true },
);

export const getRequestExport = withActor(async (ctx) => {
  const { id, action } = idAndAction(ctx.req);
  if (action !== "export") throw new AppError("NOT_FOUND", 404, t("err.shared.khongTimThay"));
  await guard(ctx);
  return json(await withTx((tx) => exportSubject(tx, actorOf(ctx), id)));
});
