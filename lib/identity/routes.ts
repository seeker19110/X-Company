// Handler HTTP cho xác thực: /api/app/auth/login, /api/app/auth/mfa, /api/app/auth/logout, /api/app/me.
import { z } from "zod";
import { getPool, withTx } from "../db/index.ts";
import {
  assertSameOrigin,
  clientIp,
  json,
  publicRoute,
  readJson,
  sessionCookie,
  withActor,
} from "../http/index.ts";
import { appendAudit } from "../audit/index.ts";
import { logSecurityEvent } from "../nen/security-event.ts";
import { login } from "./auth.ts";
import { verifyMfa } from "./mfa.ts";
import { ABSOLUTE_MS, csrfTokenFor, destroySession } from "./session.ts";
import { kb, msToSeconds } from "../nen/units.ts";

/** Thân POST /api/app/auth/login — xuất ra cho hợp đồng OpenAPI. */
export const LoginBody = z.object({ email: z.string().max(254), password: z.string().min(1).max(256) });

export const loginHandler = publicRoute(async ({ req, requestId }) => {
  assertSameOrigin(req); // chống login CSRF
  const body = LoginBody.parse(await readJson(req, kb(8)));
  const r = await login(getPool(), {
    email: body.email,
    password: body.password,
    ip: clientIp(req),
    userAgent: req.headers.get("user-agent"),
    requestId,
  });
  // Cần TOTP (AUD-SEC-002): không cấp phiên, trả thử thách (+ bí mật khi đăng ký lần đầu). no-store qua json().
  if (r.kind === "mfa")
    return json({
      mfa: r.mfa,
      challenge: r.challenge,
      ...(r.secret ? { secret: r.secret, otpauth_uri: r.otpauthUri } : {}),
    });
  return sessionResponse(r.token, r.userId);
});

function sessionResponse(token: string, userId: string): Response {
  return json({ user_id: userId, csrf_token: csrfTokenFor(token) }, 200, {
    "set-cookie": sessionCookie(token, msToSeconds(ABSOLUTE_MS)),
  });
}

/** Thân POST /api/app/auth/mfa — xuất ra cho hợp đồng OpenAPI. */
export const MfaBody = z.object({ challenge: z.string().min(1).max(100), code: z.string().max(16) });

/** Bước hai đăng nhập: mã TOTP cho thử thách → cookie phiên đã xác thực hai bước (cùng dạng phản hồi với login). */
export const mfaHandler = publicRoute(async ({ req, requestId }) => {
  assertSameOrigin(req); // như login: chống CSRF đăng nhập
  const body = MfaBody.parse(await readJson(req, kb(4)));
  const r = await verifyMfa(getPool(), {
    challenge: body.challenge,
    code: body.code,
    ip: clientIp(req),
    userAgent: req.headers.get("user-agent"),
    requestId,
  });
  return sessionResponse(r.token, r.userId);
});

export const logoutHandler = withActor(async ({ actor, sessionToken, requestId }) => {
  await withTx(async (tx) => {
    await destroySession(tx, sessionToken);
    await appendAudit(tx, {
      actorUserId: actor.userId,
      companyId: actor.companyId,
      action: "auth.logout",
      objectType: "session",
      requestId,
    });
  });
  logSecurityEvent({
    event: "auth.logout",
    outcome: "success",
    actorId: actor.userId,
    target: { type: "session" },
  });
  return json({ ok: true }, 200, {
    "set-cookie": sessionCookie(null, 0),
    // Xoá cache và dữ liệu thiết bị của PWA (SPEC-pwa, AT12).
    "clear-site-data": '"cache", "storage"',
  });
});

export const meHandler = withActor(async ({ actor, sessionToken }) => {
  const { rows } = await getPool().query<{ email: string; display_name: string }>(
    "SELECT email, display_name FROM app_user WHERE id = $1",
    [actor.userId],
  );
  return json({
    user_id: actor.userId,
    company_id: actor.companyId,
    employee_id: actor.employeeId,
    email: rows[0]?.email,
    display_name: rows[0]?.display_name,
    roles: actor.grants.map((g) => ({ role: g.role, scope_type: g.scopeType, scope_id: g.scopeId })),
    csrf_token: csrfTokenFor(sessionToken),
  });
});
