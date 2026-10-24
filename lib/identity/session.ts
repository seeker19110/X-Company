// Phiên đăng nhập: token ngẫu nhiên 256 bit trong cookie HttpOnly; DB chỉ lưu SHA-256 của token.
// Hết hạn trượt 12 giờ, tuyệt đối 7 ngày. CSRF: token = HMAC(SESSION_SECRET, token phiên) — gắn phiên, không lưu.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Queryable } from "../db/index.ts";
import { isSecureOrigin, sessionSecret } from "../nen/config.ts";
import { daysToMs, hoursToMs, msToSeconds } from "../nen/units.ts";

export const IDLE_MS = hoursToMs(12);
export const ABSOLUTE_MS = daysToMs(7);

export function cookieName(): string {
  return isSecureOrigin() ? "__Host-xc_session" : "xc_session";
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function createSession(
  db: Queryable,
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null; mfaAt?: Date | null } = {},
  now: Date = new Date(),
): Promise<{ token: string; id: string }> {
  const token = randomBytes(32).toString("base64url");
  // mfa_at: phiên tạo sau bước TOTP (lib/identity/mfa.ts); NULL = chỉ qua mật khẩu.
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO session (token_hash, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at, user_agent, ip, mfa_at)
     VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      sha256(token),
      userId,
      now,
      new Date(now.getTime() + IDLE_MS),
      new Date(now.getTime() + ABSOLUTE_MS),
      meta.userAgent?.slice(0, 300) ?? null,
      meta.ip ?? null,
      meta.mfaAt ?? null,
    ],
  );
  return { token, id: rows[0]!.id };
}

/** Phiên còn hạn và tài khoản còn hiệu lực → gia hạn trượt, trả userId (+ mốc qua bước TOTP); ngược lại null. */
export async function resolveSession(
  db: Queryable,
  token: string | null | undefined,
  now: Date = new Date(),
): Promise<{ sessionId: string; userId: string; mfaAt: Date | null } | null> {
  if (!token || token.length > 100) return null;
  const { rows } = await db.query<{ id: string; user_id: string; mfa_at: Date | null }>(
    `UPDATE session s SET last_seen_at = $2, idle_expires_at = LEAST($2 + make_interval(secs => $3), s.absolute_expires_at)
     FROM app_user u
     WHERE s.token_hash = $1 AND u.id = s.user_id AND u.disabled_at IS NULL
       AND s.idle_expires_at > $2 AND s.absolute_expires_at > $2
     RETURNING s.id, s.user_id, s.mfa_at`,
    [sha256(token), now, msToSeconds(IDLE_MS)],
  );
  const r = rows[0];
  return r ? { sessionId: r.id, userId: r.user_id, mfaAt: r.mfa_at } : null;
}

export async function destroySession(db: Queryable, token: string): Promise<void> {
  await db.query("DELETE FROM session WHERE token_hash = $1", [sha256(token)]);
}

export async function destroyUserSessions(db: Queryable, userId: string): Promise<void> {
  await db.query("DELETE FROM session WHERE user_id = $1", [userId]);
}

export function csrfTokenFor(sessionToken: string): string {
  return createHmac("sha256", sessionSecret()).update(`csrf:${sessionToken}`).digest("base64url");
}

export function checkCsrf(sessionToken: string, provided: string | null): boolean {
  if (!provided) return false;
  const a = Buffer.from(csrfTokenFor(sessionToken));
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}
