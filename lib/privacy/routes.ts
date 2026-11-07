// Route nội bộ DSAR (T-040): GET/POST /api/app/privacy/requests, POST /api/app/privacy/requests/:id/:action
// (start | respond | extend | complete | reject), GET /api/app/privacy/requests/:id/export (xuất dữ liệu cho yêu cầu truy cập).
// Quyền `privacy.manage` (HR) kiểm ở server; ghi nghiệp vụ bắt buộc Idempotency-Key. Xuất dữ liệu là GET (không lưu bản
// phản hồi chứa PII vào idempotency_record). POST /api/app/me/delete: nhân viên tự xoá tài khoản (T-121, D-075).
import { z } from "zod";
import { getPool, withTx } from "../db/index.ts";
import {
  authorize,
  clientIp,
  json,
  readJson,
  sessionCookie,
  withActor,
  type ActorRequestContext,
} from "../http/index.ts";
import { withReauth } from "../identity/account.ts";
import { AppError } from "../nen/app-error.ts";
import { parsePage } from "../nen/pagination.ts";
import { kb } from "../nen/units.ts";
import {
  completeRequest,
  createRequest,
  CreateRequestInput,
  exportSubject,
  extendRequest,
  listRequestsPage,
  rejectRequest,
  respondRequest,
  startRequest,
  type PrivacyActor,
} from "./index.ts";
import { t } from "../i18n/index.ts";
import { SELF_DELETE_CONFIRM } from "./self-delete.pure.ts";
import { deleteOwnAccount } from "./self-service.ts";

export const STATUSES = ["received", "in_progress", "done", "rejected"] as const;
export const ACTIONS = ["start", "respond", "extend", "complete", "reject"] as const;
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
      if (action === "respond") return respondRequest(tx, actor, id);
      if (action === "complete") return completeRequest(tx, actor, id);
      if (action === "extend") return extendRequest(tx, actor, id, body.reason ?? "");
      if (!body.reason) throw new AppError("VALIDATION", 422, t("err.privacy.canNeuCanCuTuChoi2"));
      return rejectRequest(tx, actor, id, body.reason);
    });
    return json({ request: row });
  },
  { idempotent: true },
);

/**
 * Thân POST /api/app/me/delete — xuất ra cho hợp đồng OpenAPI. Thiếu/sai `confirm` → 400 trước khi kiểm mật khẩu. Nghiêm:
 * khoá lạ (vd id chủ thể/tài khoản) → 400 — chủ thể luôn lấy từ phiên.
 */
export const DeleteOwnAccountBody = z.strictObject({
  password: z.string().min(1).max(256),
  totp: z.string().trim().max(16).nullish(),
  confirm: z.literal(SELF_DELETE_CONFIRM, {
    error: t("err.privacy.confirmPhrase", { phrase: SELF_DELETE_CONFIRM }),
  }),
});

/**
 * Xoá tài khoản TỰ PHỤC VỤ (T-121, D-075): `account.delete_own` (chính nhân viên của phiên) → xác thực lại trong request
 * (mật khẩu + TOTP nếu đã bật; sai tính vào bộ đếm đăng nhập/TOTP) → tạo + hoàn tất yêu cầu xoá cho chính mình trong CÙNG
 * giao dịch với bước xác thực lại. Thành công: phiên đã bị thu hồi → xoá cookie + dữ liệu PWA như đăng xuất.
 */
export const postDeleteOwnAccount = withActor(
  async (ctx) => {
    const { actor } = ctx;
    await authorize(
      ctx,
      "account.delete_own",
      { companyId: actor.companyId, ownerEmployeeId: actor.employeeId },
      { type: "app_user", id: actor.userId },
    );
    const employeeId = actor.employeeId;
    if (employeeId === null) throw new AppError("FORBIDDEN", 403, t("err.shared.banKhongCoQuyenThucHien"));
    const body = DeleteOwnAccountBody.parse(await readJson(ctx.req, kb(4)));
    const row = await withReauth(
      getPool(),
      {
        userId: actor.userId,
        companyId: actor.companyId,
        ip: clientIp(ctx.req),
        userAgent: ctx.req.headers.get("user-agent"),
        requestId: ctx.requestId,
      },
      { password: body.password, totp: body.totp },
      (tx) => deleteOwnAccount(tx, actorOf(ctx), employeeId),
    );
    return json({ request: row }, 200, {
      "set-cookie": sessionCookie(null, 0),
      "clear-site-data": '"cache", "storage"',
    });
  },
  { idempotent: true },
);

export const getRequestExport = withActor(async (ctx) => {
  const { id, action } = idAndAction(ctx.req);
  if (action !== "export") throw new AppError("NOT_FOUND", 404, t("err.shared.khongTimThay"));
  await guard(ctx);
  return json(await withTx((tx) => exportSubject(tx, actorOf(ctx), id)));
});
