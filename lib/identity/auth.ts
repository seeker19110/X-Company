// Đăng nhập / đăng xuất (SPEC-identity-org). Giới hạn 5 lần sai / 15 phút / (email, IP) → 429.
import { appendAudit } from "../audit/index.ts";
import type pg from "pg";
import { withTx, type Queryable } from "../db/index.ts";
import { AppError } from "../nen/app-error.ts";
import { logSecurityEvent } from "../nen/security-event.ts";
import { createSession } from "./session.ts";
import { hashPassword, validateNewPassword, verifyPassword } from "./password.ts";
import { minutesToMs, msToSeconds } from "../nen/units.ts";

export const MAX_FAILURES = 5;
export const WINDOW_MS = minutesToMs(15);

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface LoginResult {
  token: string;
  userId: string;
  companyId: string;
}

/**
 * Đăng nhập. Nhận POOL (không nhận tx): lần sai phải được COMMIT trước khi ném lỗi — nếu chạy trong giao dịch của
 * người gọi rồi rollback thì bản ghi lần sai mất và giới hạn tần suất không bao giờ kích hoạt.
 */
export async function login(
  pool: pg.Pool,
  input: {
    email: string;
    password: string;
    ip: string;
    userAgent?: string | null;
    requestId?: string | null;
  },
  now: Date = new Date(),
): Promise<LoginResult> {
  const email = normalizeEmail(input.email);
  const meta = { sourceIp: input.ip, userAgent: input.userAgent, requestId: input.requestId };
  const since = new Date(now.getTime() - WINDOW_MS);
  // Bước 1 (ngắn, dưới khoá theo email+IP): đếm lần sai và GHI TRƯỚC lượt thử này là "sai" rồi commit — request song
  // song luôn thấy nhau nên không vượt giới hạn (review PR #8 #3) mà không giữ kết nối DB trong lúc băm Argon2.
  const pre = await withTx(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('login:' || $1 || '|' || $2, 0))", [
      email,
      input.ip,
    ]);
    const fails = await tx.query<{ n: number; oldest: Date | null }>(
      `SELECT count(*)::int AS n, min(attempted_at) AS oldest FROM login_attempt
       WHERE email = $1 AND ip = $2 AND success = false AND attempted_at > $3`,
      [email, input.ip, since],
    );
    const f = fails.rows[0]!;
    if (f.n >= MAX_FAILURES) {
      const oldest = f.oldest?.getTime() ?? now.getTime();
      const retryAfter = Math.max(1, Math.ceil(msToSeconds(oldest + WINDOW_MS - now.getTime())));
      logSecurityEvent({
        ...meta,
        event: "auth.rate_limited",
        outcome: "denied",
        target: { type: "app_user" },
      });
      throw new AppError("RATE_LIMITED", 429, "Đăng nhập sai quá nhiều lần, thử lại sau", { retryAfter });
    }
    const attempt = await tx.query<{ id: string }>(
      "INSERT INTO login_attempt (email, ip, attempted_at, success) VALUES ($1, $2, $3, false) RETURNING id",
      [email, input.ip, now],
    );
    const u = await tx.query<{
      id: string;
      company_id: string;
      password_hash: string | null;
      disabled_at: Date | null;
    }>("SELECT id, company_id, password_hash, disabled_at FROM app_user WHERE email = $1", [email]);
    return { attemptId: attempt.rows[0]!.id, user: u.rows[0] };
  }, pool);

  // Bước 2: băm ngoài giao dịch (không giữ kết nối pool).
  const user = pre.user;
  const ok = await verifyPassword(user && !user.disabled_at ? user.password_hash : null, input.password);

  // Bước 3: ghi kết quả.
  const r = await withTx(async (tx) => {
    if (!ok || !user) {
      await appendAudit(tx, {
        actorUserId: user?.id ?? null,
        companyId: user?.company_id ?? null,
        action: "auth.login",
        objectType: "app_user",
        objectId: user?.id ?? null,
        result: "denied",
        requestId: input.requestId ?? null,
        sourceIp: input.ip,
        userAgent: input.userAgent,
      });
      return null;
    }
    await tx.query("UPDATE login_attempt SET success = true WHERE id = $1", [pre.attemptId]);
    const s = await createSession(tx, user.id, { userAgent: input.userAgent, ip: input.ip }, now);
    await appendAudit(tx, {
      actorUserId: user.id,
      companyId: user.company_id,
      action: "auth.login",
      objectType: "session",
      objectId: s.id,
      requestId: input.requestId ?? null,
      sourceIp: input.ip,
      userAgent: input.userAgent,
    });
    return { token: s.token, userId: user.id, companyId: user.company_id };
  }, pool);
  // Sự kiện bảo mật: không ghi email (chỉ id khi biết tài khoản).
  logSecurityEvent({
    ...meta,
    event: "auth.login",
    outcome: r ? "success" : "denied",
    actorId: r ? r.userId : null,
    target: { type: "app_user", id: user?.id ?? null },
  });
  // Cùng một thông điệp cho sai email và sai mật khẩu.
  if (!r) throw new AppError("INVALID_CREDENTIALS", 401, "Email hoặc mật khẩu không đúng");
  return r;
}

/** Đặt mật khẩu mới (kiểm độ mạnh) và huỷ mọi phiên cũ của tài khoản. */
export async function setPassword(db: Queryable, userId: string, password: string): Promise<void> {
  const u = await db.query<{ email: string; company_id: string }>(
    "SELECT email, company_id FROM app_user WHERE id = $1",
    [userId],
  );
  const user = u.rows[0];
  if (!user) throw new AppError("NOT_FOUND", 404, "Không tìm thấy tài khoản");
  validateNewPassword(password, { email: user.email });
  await db.query("UPDATE app_user SET password_hash = $2, auth_version = auth_version + 1 WHERE id = $1", [
    userId,
    await hashPassword(password),
  ]);
  await db.query("DELETE FROM session WHERE user_id = $1", [userId]);
  await appendAudit(db, {
    actorUserId: userId,
    companyId: user.company_id,
    action: "auth.set_password",
    objectType: "app_user",
    objectId: userId,
  });
}

/** Vô hiệu tài khoản: có hiệu lực ngay ở request kế tiếp (R8) và xoá phiên. */
export async function disableUser(db: Queryable, actorUserId: string | null, userId: string, reason: string) {
  const { rows } = await db.query<{ company_id: string }>(
    "UPDATE app_user SET disabled_at = now(), auth_version = auth_version + 1 WHERE id = $1 AND disabled_at IS NULL RETURNING company_id",
    [userId],
  );
  if (!rows[0]) throw new AppError("NOT_FOUND", 404, "Không tìm thấy tài khoản đang hoạt động");
  await db.query("DELETE FROM session WHERE user_id = $1", [userId]);
  await appendAudit(db, {
    actorUserId,
    companyId: rows[0].company_id,
    action: "user.disable",
    objectType: "app_user",
    objectId: userId,
    reason,
  });
}
