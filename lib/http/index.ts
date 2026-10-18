// Lớp HTTP dùng chung cho route handler (ARCHITECTURE: dòng một request ghi). Không import next/* — route chỉ
// `export const POST = handler`. Mọi lỗi → JSON theo API-CONTRACT; không lộ stack.
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { appendAudit } from "../audit/index.ts";
import { can, type Action, type ActorContext, type Resource } from "../authz/index.ts";
import { loadActor } from "../authz/load.ts";
import { getPool, withTx } from "../db/index.ts";
import { checkCsrf, cookieName, resolveSession } from "../identity/session.ts";
import { AppError } from "../nen/app-error.ts";
import { appOrigin, isSecureOrigin } from "../nen/config.ts";

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function errorResponse(err: unknown, requestId: string): Response {
  if (err instanceof AppError) {
    const headers: Record<string, string> = {};
    const retry = err.details?.retryAfter;
    if (typeof retry === "number") headers["retry-after"] = String(retry);
    return json(
      { error: { code: err.code, message: err.message, details: err.details }, request_id: requestId },
      err.status,
      headers,
    );
  }
  if (err instanceof ZodError) {
    return json(
      {
        error: {
          code: "VALIDATION",
          message: "Dữ liệu gửi lên không hợp lệ",
          details: { issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
        },
        request_id: requestId,
      },
      400,
    );
  }
  console.error(`[http] ${requestId}`, err instanceof Error ? err.message : err);
  return json(
    { error: { code: "INTERNAL", message: "Lỗi hệ thống, vui lòng thử lại" }, request_id: requestId },
    500,
  );
}

export function getCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function sessionCookie(token: string | null, maxAgeSec: number): string {
  const attrs = [
    `${cookieName()}=${token ?? ""}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSec}`,
  ];
  if (isSecureOrigin()) attrs.push("Secure");
  return attrs.join("; ");
}

/** IP client: chỉ tin X-Forwarded-For khi đứng sau proxy đã cấu hình (TRUST_PROXY=1). */
export function clientIp(req: Request): string {
  if (process.env.TRUST_PROXY === "1") {
    const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (xff) return xff.slice(0, 64);
  }
  return "direct";
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Request ghi phải cùng origin: Origin khớp APP_ORIGIN, hoặc (không có Origin) Sec-Fetch-Site = same-origin. */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (origin) {
    if (origin !== appOrigin()) throw new AppError("CSRF", 403, "Yêu cầu không cùng nguồn");
    return;
  }
  if (req.headers.get("sec-fetch-site") !== "same-origin")
    throw new AppError("CSRF", 403, "Yêu cầu không cùng nguồn");
}

export interface RequestContext {
  req: Request;
  requestId: string;
}

export interface ActorRequestContext extends RequestContext {
  actor: ActorContext;
  sessionToken: string;
}

type Handler<C> = (ctx: C) => Promise<Response>;

/** Route công khai: request_id + ánh xạ lỗi. */
export function publicRoute(handler: Handler<RequestContext>): (req: Request) => Promise<Response> {
  return async (req) => {
    const requestId = randomUUID();
    try {
      return await handler({ req, requestId });
    } catch (err) {
      return errorResponse(err, requestId);
    }
  };
}

/**
 * Route nội bộ (R1, R8): phiên hợp lệ + tài khoản còn hiệu lực (nạp lại grant mỗi request) → actor; request ghi
 * thêm kiểm cùng origin + CSRF token gắn phiên. Thiếu phiên → 401.
 */
export function withActor(handler: Handler<ActorRequestContext>): (req: Request) => Promise<Response> {
  return publicRoute(async ({ req, requestId }) => {
    const token = getCookie(req, cookieName());
    const pool = getPool();
    const session = await resolveSession(pool, token);
    const actor = session ? await loadActor(pool, session.userId) : null;
    if (!session || !actor || !token) throw new AppError("UNAUTHENTICATED", 401, "Vui lòng đăng nhập");
    if (!SAFE_METHODS.has(req.method)) {
      assertSameOrigin(req);
      if (!checkCsrf(token, req.headers.get("x-csrf-token")))
        throw new AppError("CSRF", 403, "Thiếu hoặc sai mã CSRF");
    }
    try {
      return await handler({ req, requestId, actor, sessionToken: token });
    } catch (err) {
      // 403 từ lớp nghiệp vụ (requireOn) → ghi audit denied ở giao dịch riêng rồi trả lỗi như cũ.
      if (err instanceof AppError && err.code === "FORBIDDEN" && err.details?.action) {
        const object = err.details.object as { type?: string; id?: string } | undefined;
        await withTx((tx) =>
          appendAudit(tx, {
            actorUserId: actor.userId,
            companyId: actor.companyId,
            action: String(err.details!.action),
            objectType: object?.type ?? "unknown",
            objectId: object?.id ?? null,
            result: "denied",
            requestId,
          }),
        );
      }
      throw err;
    }
  });
}

/**
 * Kiểm quyền; từ chối → ghi audit `denied` (giao dịch riêng, để không mất khi giao dịch nghiệp vụ rollback) rồi 403.
 */
export async function authorize(
  ctx: ActorRequestContext,
  action: Action,
  resource: Resource,
  object: { type: string; id?: string | null } = { type: action },
): Promise<void> {
  if (can(ctx.actor, action, resource)) return;
  await withTx((tx) =>
    appendAudit(tx, {
      actorUserId: ctx.actor.userId,
      companyId: ctx.actor.companyId,
      action,
      objectType: object.type,
      objectId: object.id ?? null,
      result: "denied",
      requestId: ctx.requestId,
    }),
  );
  throw new AppError("FORBIDDEN", 403, "Bạn không có quyền thực hiện thao tác này");
}

export async function readJson(req: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) throw new AppError("PAYLOAD_TOO_LARGE", 413, "Dữ liệu quá lớn");
  const text = await req.text();
  if (Buffer.byteLength(text) > maxBytes) throw new AppError("PAYLOAD_TOO_LARGE", 413, "Dữ liệu quá lớn");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new AppError("BAD_JSON", 400, "JSON không hợp lệ");
  }
}
