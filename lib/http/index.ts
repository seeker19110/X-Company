// Lớp HTTP dùng chung cho route handler (ARCHITECTURE: dòng một request ghi). Không import next/* — route chỉ
// `export const POST = handler`. Mọi lỗi → JSON theo API-CONTRACT; không lộ stack.
import { randomUUID } from "node:crypto";
// $ZodError là lớp gốc chung của zod đầy đủ và zod/mini (schema dùng chung client/server viết bằng mini).
import { $ZodError } from "zod/v4/core";
import { appendAudit } from "../audit/index.ts";
import { can, type Action, type ActorContext, type Resource } from "../authz/index.ts";
import { loadActor } from "../authz/load.ts";
import { getPool, withTx } from "../db/index.ts";
import { checkCsrf, cookieName, resolveSession } from "../identity/session.ts";
import { AppError } from "../nen/app-error.ts";
import { appOrigin, isSecureOrigin } from "../nen/config.ts";
import { env } from "../nen/env.ts";
import {
  currentLogContext,
  log,
  newSpanId,
  newTraceId,
  parseTraceparent,
  runWithLogContext,
} from "../nen/log.ts";
import { logSecurityEvent } from "../nen/security-event.ts";
import { readCapped } from "./body.ts";
import { guarded, type GuardOptions } from "./idempotency.ts";
import { kb, msToSeconds } from "../nen/units.ts";
import { normalizeNfc } from "../nen/text.ts";
import { observeRequest } from "./metrics.ts";
import { t } from "../i18n/index.ts";

export { readCapped, readFormCapped } from "./body.ts";
export type { GuardOptions } from "./idempotency.ts";

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

const TITLES: Record<number, () => string> = {
  400: () => t("err.http.title400"),
  401: () => t("err.http.title401"),
  403: () => t("err.http.title403"),
  404: () => t("err.http.title404"),
  409: () => t("err.http.title409"),
  413: () => t("err.http.title413"),
  422: () => t("err.http.title422"),
  429: () => t("err.http.title429"),
  500: () => t("err.http.title500"),
  503: () => t("err.http.title503"),
};

/**
 * Lỗi theo RFC 9457 (D-017): `application/problem+json` với type/title/status/detail/instance, GIỮ trường cũ để client
 * đang chạy không vỡ: `error{code,message,details}` (app/components/api.ts đọc `error.message`), `code`, `message`,
 * `request_id`; thêm `trace_id` và `fields` (lỗi theo trường, khi có). Không bao giờ chứa stack/SQL/đường dẫn.
 */
export function problemResponse(
  status: number,
  code: string,
  detail: string,
  requestId: string,
  extra: {
    details?: Record<string, unknown>;
    fields?: { path: string; message: string }[];
    headers?: Record<string, string>;
  } = {},
): Response {
  const traceId = currentLogContext().trace_id;
  const body = {
    type: `/problems/${code.toLowerCase().replace(/_/g, "-")}`,
    title: (TITLES[status] ?? (status >= 500 ? TITLES[500]! : () => t("err.http.titleDefault")))(),
    status,
    detail,
    instance: `urn:uuid:${requestId}`,
    code,
    message: detail,
    request_id: requestId,
    ...(traceId ? { trace_id: traceId } : {}),
    ...(extra.fields ? { fields: extra.fields } : {}),
    error: { code, message: detail, details: extra.details },
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/problem+json; charset=utf-8",
      "cache-control": "no-store",
      "x-request-id": requestId,
      ...extra.headers,
    },
  });
}

export function errorResponse(err: unknown, requestId: string): Response {
  if (err instanceof AppError) {
    const headers: Record<string, string> = {};
    const retry = err.details?.retryAfter;
    if (typeof retry === "number") headers["retry-after"] = String(retry);
    if (err.status >= 500)
      log.error("lỗi nghiệp vụ mức hệ thống", { err, code: err.code, status: err.status });
    return problemResponse(err.status, err.code, err.message, requestId, { details: err.details, headers });
  }
  if (err instanceof $ZodError) {
    const fields = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    logSecurityEvent({
      event: "input.validation_failed",
      outcome: "denied",
      target: { type: "request" },
      requestId,
      detail: { paths: fields.map((f) => f.path) },
    });
    return problemResponse(400, "VALIDATION", t("err.http.validation"), requestId, {
      details: { issues: fields },
      fields,
    });
  }
  // Lỗi chưa lường: log ERROR kèm stack + chuỗi cause (BASE-ERR-002/009); phản hồi chung, không lộ chi tiết (BASE-ERR-003).
  runWithLogContext({ request_id: requestId }, () => log.error("lỗi chưa xử lý trong request", { err }));
  return problemResponse(500, "INTERNAL", t("err.http.internal"), requestId);
}

export function getCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null; // mã hoá sai → coi như không có cookie (401), không 500
      }
    }
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

/**
 * IP client. Không có proxy tin cậy → "direct" (Next route handler không có địa chỉ socket). Sau N proxy tin cậy
 * (TRUST_PROXY_HOPS=N; TRUST_PROXY=1 tương đương N=1): lấy phần tử thứ N TỪ PHẢI của X-Forwarded-For — các phần tử
 * bên trái do client tự đặt được (review PR #8 #6).
 */
export function clientIp(req: Request): string {
  const hops = env("TRUST_PROXY_HOPS") ?? (env("TRUST_PROXY") === "1" ? 1 : 0);
  if (hops > 0) {
    const list = (req.headers.get("x-forwarded-for") ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    const ip = list[list.length - hops];
    if (ip) return ip.slice(0, 64);
  }
  return "direct";
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Request ghi phải cùng origin: Origin khớp APP_ORIGIN, hoặc (không có Origin) Sec-Fetch-Site = same-origin. */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (origin) {
    if (origin !== appOrigin()) throw new AppError("CSRF", 403, t("err.http.yeuCauKhongCungNguon"));
    return;
  }
  if (req.headers.get("sec-fetch-site") !== "same-origin")
    throw new AppError("CSRF", 403, t("err.http.yeuCauKhongCungNguon"));
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

/** IP client cho ngữ cảnh log/audit; cấu hình proxy sai → ghi log và coi như không biết (request vẫn xử lý được). */
function safeClientIp(req: Request): string | null {
  try {
    return clientIp(req);
  } catch (err) {
    log.error("không xác định được IP client (cấu hình proxy sai)", { err });
    return null;
  }
}

/** Đo RED (OPS-OBS-003); không bao giờ làm hỏng request. */
function recordRequest(req: Request, status: number, startedMs: number): void {
  try {
    observeRequest(req.method, new URL(req.url).pathname, status, msToSeconds(performance.now() - startedMs));
  } catch {
    /* đo lường best-effort */
  }
}

/** Route công khai: request_id/trace_id + ngữ cảnh log + ánh xạ lỗi. */
export function publicRoute(handler: Handler<RequestContext>): (req: Request) => Promise<Response> {
  return async (req) => {
    const requestId = randomUUID();
    const ctx = {
      request_id: requestId,
      trace_id: parseTraceparent(req.headers.get("traceparent"))?.trace_id ?? newTraceId(),
      span_id: newSpanId(),
      source_ip: safeClientIp(req),
      user_agent: req.headers.get("user-agent"),
    };
    const started = performance.now();
    const response = await runWithLogContext(ctx, async () => {
      try {
        return await handler({ req, requestId });
      } catch (err) {
        return errorResponse(err, requestId);
      }
    });
    recordRequest(req, response.status, started);
    return response;
  };
}

/**
 * Route nội bộ (R1, R8): phiên hợp lệ + tài khoản còn hiệu lực (nạp lại grant mỗi request) → actor; request ghi
 * thêm kiểm cùng origin + CSRF token gắn phiên. Thiếu phiên → 401. `guard`: bắt buộc Idempotency-Key và/hoặc giới hạn
 * tần suất theo user cho route ghi/đắt.
 */
export function withActor(
  handler: Handler<ActorRequestContext>,
  guard: GuardOptions = {},
): (req: Request) => Promise<Response> {
  return publicRoute(async ({ req, requestId }) => {
    const token = getCookie(req, cookieName());
    // Fail-closed (BASE-ERR-010): backend phiên/phân quyền lỗi → KHÔNG cho qua; 503, không bao giờ rơi về 2xx.
    let session: Awaited<ReturnType<typeof resolveSession>>;
    let actor: Awaited<ReturnType<typeof loadActor>>;
    try {
      const pool = getPool();
      session = await resolveSession(pool, token);
      actor = session ? await loadActor(pool, session.userId) : null;
    } catch (err) {
      log.error("backend xác thực/phân quyền lỗi — từ chối request (fail-closed)", { err });
      throw new AppError("AUTH_UNAVAILABLE", 503, t("err.http.heThongXacThucTamThoi"));
    }
    if (!session || !actor || !token)
      throw new AppError("UNAUTHENTICATED", 401, t("err.http.vuiLongDangNhap"));
    if (!SAFE_METHODS.has(req.method)) {
      assertSameOrigin(req);
      if (!checkCsrf(token, req.headers.get("x-csrf-token")))
        throw new AppError("CSRF", 403, t("err.http.thieuHoacSaiMaCsrf"));
    }
    try {
      return await runWithLogContext({ actor_id: actor.userId }, () => {
        const ctx = { req, requestId, actor, sessionToken: token };
        // POST ghi nghiệp vụ: Idempotency-Key + giới hạn tần suất (lib/http/idempotency.ts); route khác không đổi.
        return guard.idempotent || guard.rateLimit ? guarded(ctx, guard, () => handler(ctx)) : handler(ctx);
      });
    } catch (err) {
      // 403 từ lớp nghiệp vụ (requireOn) → ghi audit denied ở giao dịch riêng rồi trả lỗi như cũ.
      if (err instanceof AppError && err.code === "FORBIDDEN" && err.details?.action !== undefined) {
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
        logSecurityEvent({
          event: "authz.denied",
          outcome: "denied",
          actorId: actor.userId,
          target: { type: object?.type ?? "unknown", id: object?.id ?? null },
          detail: { action: String(err.details.action) },
        });
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
  logSecurityEvent({
    event: "authz.denied",
    outcome: "denied",
    actorId: ctx.actor.userId,
    target: { type: object.type, id: object.id ?? null },
    detail: { action },
  });
  throw new AppError("FORBIDDEN", 403, t("err.shared.banKhongCoQuyenThucHien"));
}

export async function readJson(req: Request, maxBytes = kb(64)): Promise<unknown> {
  const text = new TextDecoder().decode(await readCapped(req, maxBytes));
  try {
    return text !== "" ? normalizeNfc(JSON.parse(text)) : {}; // NFC ở biên: một ký tự Việt = một dạng lưu
  } catch {
    throw new AppError("BAD_JSON", 400, t("err.http.jsonKhongHopLe"));
  }
}
