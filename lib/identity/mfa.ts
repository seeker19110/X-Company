// Xác thực hai bước TOTP (AUD-SEC-002, D-058; SPEC-identity-org mục "Xác thực hai bước"). Bắt buộc với người có grant còn
// hiệu lực vai trò trong MFA_REQUIRED_ROLES và với mọi người đã bật TOTP. Luồng: login đúng mật khẩu → thử thách (bảng
// mfa_challenge, lưu băm token, hạn 5 phút, tối đa 5 lần sai) → POST /api/app/auth/mfa {challenge, code} → phiên có mfa_at.
// Không bao giờ ghi bí mật/mã vào log hay audit (chỉ id). Lần sai được COMMIT trước khi ném lỗi (giống login).
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import { appendAudit } from "../audit/index.ts";
import type { Role, SystemActor } from "../authz/index.ts";
import { openTextAsync, sealTextAsync, textColumn } from "../crypto/columns.ts";
import { decryptFieldAsync, encryptFieldAsync } from "../crypto/kms.ts";
import { withTx, type Queryable } from "../db/index.ts";
import { AppError } from "../nen/app-error.ts";
import { logSecurityEvent } from "../nen/security-event.ts";
import { minutesToMs, msToSeconds } from "../nen/units.ts";
import { t } from "../i18n/index.ts";
import { createSession, destroyUserSessions } from "./session.ts";
import { base32Decode, newTotpSecret, otpauthUri, verifyTotp } from "./totp.pure.ts";

/** Vai trò bắt buộc TOTP (SPEC-identity-org, D-058). */
export const MFA_REQUIRED_ROLES: readonly Role[] = ["sysadmin", "hr", "executive"];
export const CHALLENGE_TTL_MS = minutesToMs(5);
export const MAX_CHALLENGE_ATTEMPTS = 5;
export const MAX_USER_MFA_FAILURES = 10;
export const MFA_WINDOW_MS = minutesToMs(15);

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const CHALLENGE_CTX = (rowId: string) => ({ table: "mfa_challenge", column: "secret_enc", rowId });
const TOTP_COLUMN = () => textColumn("app_user", "totp_secret");

export function grantsRequireMfa(grants: readonly { role: Role }[]): boolean {
  return grants.some((g) => MFA_REQUIRED_ROLES.includes(g.role));
}

/** Phiên đủ điều kiện cho actor: không cần MFA, hoặc phiên đã qua bước TOTP. Dùng ở withActor và trang server. */
export function mfaSatisfied(grants: readonly { role: Role }[], mfaAt: Date | null): boolean {
  return mfaAt !== null || !grantsRequireMfa(grants);
}

export interface MfaChallengeOut {
  mfa: "totp" | "totp_enroll";
  challenge: string;
  /** Chỉ khi đăng ký (totp_enroll): bí mật base32 + URI cho ứng dụng xác thực. */
  secret?: string;
  otpauthUri?: string;
}

export interface PreparedChallenge {
  id: string;
  token: string;
  purpose: "verify" | "enroll";
  secret: string | null;
  secretEnc: string | null;
}

/** Chuẩn bị vật liệu thử thách NGOÀI giao dịch (mã hoá bí mật đăng ký có thể gọi KMS). */
export async function prepareChallenge(enrolled: boolean): Promise<PreparedChallenge> {
  const id = randomUUID();
  const token = randomBytes(32).toString("base64url");
  if (enrolled) return { id, token, purpose: "verify", secret: null, secretEnc: null };
  const secret = newTotpSecret();
  return {
    id,
    token,
    purpose: "enroll",
    secret,
    secretEnc: await encryptFieldAsync(CHALLENGE_CTX(id), secret),
  };
}

/** Ghi thử thách (trong giao dịch của login) + dọn thử thách hết hạn của người đó. */
export async function storeChallenge(
  tx: Queryable,
  userId: string,
  email: string,
  p: PreparedChallenge,
  now: Date,
): Promise<MfaChallengeOut> {
  await tx.query("DELETE FROM mfa_challenge WHERE user_id = $1 AND expires_at <= $2", [userId, now]);
  await tx.query(
    `INSERT INTO mfa_challenge (id, token_hash, user_id, purpose, secret_enc, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [p.id, sha256(p.token), userId, p.purpose, p.secretEnc, now, new Date(now.getTime() + CHALLENGE_TTL_MS)],
  );
  return p.purpose === "verify"
    ? { mfa: "totp", challenge: p.token }
    : { mfa: "totp_enroll", challenge: p.token, secret: p.secret!, otpauthUri: otpauthUri(p.secret!, email) };
}

export interface MfaSessionResult {
  token: string;
  userId: string;
  companyId: string;
}

type Outcome =
  | { kind: "invalid"; userId: string | null }
  | { kind: "rate"; userId: string; retryAfter: number }
  | { kind: "wrong"; userId: string }
  | { kind: "ok"; result: MfaSessionResult; enrolled: boolean };

/**
 * Bước hai: kiểm mã cho thử thách. Nhận POOL (lần sai phải COMMIT trước khi ném). Thứ tự kiểm: thử thách tồn tại/còn hạn
 * → giới hạn theo người dùng (10 lần sai / 15 phút) → mã đúng trong cửa sổ ±1 và bước > totp_last_step_seq.
 */
export async function verifyMfa(
  pool: pg.Pool,
  input: {
    challenge: string;
    code: string;
    ip: string;
    userAgent?: string | null;
    requestId?: string | null;
  },
  now: Date = new Date(),
): Promise<MfaSessionResult> {
  const meta = { sourceIp: input.ip, userAgent: input.userAgent, requestId: input.requestId };
  const outcome = await evaluate(pool, input, now);
  const userId = outcome.kind === "ok" ? outcome.result.userId : outcome.userId;
  const target = { type: "app_user", id: userId };
  switch (outcome.kind) {
    case "invalid":
      logSecurityEvent({
        ...meta,
        event: "auth.mfa",
        outcome: "denied",
        actorId: userId,
        target,
        detail: { reason: "challenge_invalid" },
      });
      throw new AppError("MFA_CHALLENGE_INVALID", 401, t("err.identity.thuThachXacThucKhongHopLe"));
    case "rate":
      logSecurityEvent({
        ...meta,
        event: "auth.rate_limited",
        outcome: "denied",
        actorId: userId,
        target,
        detail: { step: "mfa" },
      });
      throw new AppError("RATE_LIMITED", 429, t("err.identity.nhapSaiMaQuaNhieuLan"), {
        retryAfter: outcome.retryAfter,
      });
    case "wrong":
      logSecurityEvent({
        ...meta,
        event: "auth.mfa",
        outcome: "denied",
        actorId: userId,
        target,
        detail: { reason: "invalid_code" },
      });
      throw new AppError("INVALID_MFA_CODE", 401, t("err.identity.maXacThucKhongDung"));
    case "ok":
      logSecurityEvent({
        ...meta,
        event: "auth.mfa",
        outcome: "success",
        actorId: userId,
        target,
        detail: { enrolled: outcome.enrolled },
      });
      logSecurityEvent({ ...meta, event: "auth.login", outcome: "success", actorId: userId, target });
      return outcome.result;
  }
}

async function evaluate(
  pool: pg.Pool,
  input: {
    challenge: string;
    code: string;
    ip: string;
    userAgent?: string | null;
    requestId?: string | null;
  },
  now: Date,
): Promise<Outcome> {
  if (input.challenge === "" || input.challenge.length > 100) return { kind: "invalid", userId: null };
  const hash = sha256(input.challenge);
  // Đọc trước + giải mã NGOÀI giao dịch (KMS có thể gọi mạng); trong giao dịch kiểm lại bản mã không đổi.
  const pre = await pool.query<{
    id: string;
    user_id: string;
    purpose: "verify" | "enroll";
    secret_enc: string | null;
    totp_secret_enc: string | null;
  }>(
    `SELECT c.id, c.user_id, c.purpose, c.secret_enc, u.totp_secret_enc
       FROM mfa_challenge c JOIN app_user u ON u.id = c.user_id
      WHERE c.token_hash = $1 AND u.disabled_at IS NULL`,
    [hash],
  );
  const row = pre.rows[0];
  if (!row) return { kind: "invalid", userId: null };
  const enc = row.purpose === "enroll" ? row.secret_enc : row.totp_secret_enc;
  if (enc === null) return { kind: "invalid", userId: row.user_id };
  const secretB32 =
    row.purpose === "enroll"
      ? await decryptFieldAsync(CHALLENGE_CTX(row.id), enc)
      : await openTextAsync(TOTP_COLUMN(), row.user_id, { totp_secret_enc: enc });
  const secret = secretB32 === null ? null : base32Decode(secretB32);
  if (secret === null || secret.length === 0) return { kind: "invalid", userId: row.user_id };
  // Bí mật đăng ký mã hoá lại cho cột app_user (AAD theo id người dùng) — chuẩn bị trước, chỉ ghi khi mã đúng.
  const sealed = row.purpose === "enroll" ? await sealTextAsync(TOTP_COLUMN(), row.user_id, secretB32) : null;

  return withTx(async (tx): Promise<Outcome> => {
    // Khoá dòng người dùng: tuần tự hoá mọi lần thử của một người (giới hạn đếm đúng, totp_last_step_seq không chạy đua).
    const u = await tx.query<{
      company_id: string;
      totp_secret_enc: string | null;
      totp_enabled_at: Date | null;
      totp_last_step_seq: string | null;
    }>(
      `SELECT company_id, totp_secret_enc, totp_enabled_at, totp_last_step_seq FROM app_user
        WHERE id = $1 AND disabled_at IS NULL FOR UPDATE`,
      [row.user_id],
    );
    const user = u.rows[0];
    const c = await tx.query<{ attempts: number; expires_at: Date }>(
      "SELECT attempts, expires_at FROM mfa_challenge WHERE id = $1 FOR UPDATE",
      [row.id],
    );
    const ch = c.rows[0];
    if (!user || !ch) return { kind: "invalid", userId: row.user_id };
    const drop = () => tx.query("DELETE FROM mfa_challenge WHERE id = $1", [row.id]);
    if (ch.expires_at.getTime() <= now.getTime()) {
      await drop();
      return { kind: "invalid", userId: row.user_id };
    }
    // Bí mật đã đổi (mfa:reset) hoặc đã bật bởi lần đăng ký khác → thử thách này hết giá trị; không ghi đè bí mật đã bật.
    if (
      (row.purpose === "verify" && user.totp_secret_enc !== enc) ||
      (row.purpose === "enroll" && user.totp_enabled_at !== null)
    ) {
      await drop();
      return { kind: "invalid", userId: row.user_id };
    }
    const since = new Date(now.getTime() - MFA_WINDOW_MS);
    const f = await tx.query<{ n: number; oldest: Date | null }>(
      "SELECT count(*)::int AS n, min(failed_at) AS oldest FROM mfa_failure WHERE user_id = $1 AND failed_at > $2",
      [row.user_id, since],
    );
    const fail = f.rows[0]!;
    if (fail.n >= MAX_USER_MFA_FAILURES) {
      const oldest = fail.oldest?.getTime() ?? now.getTime();
      const retryAfter = Math.max(1, Math.ceil(msToSeconds(oldest + MFA_WINDOW_MS - now.getTime())));
      return { kind: "rate", userId: row.user_id, retryAfter };
    }
    const lastStep = user.totp_last_step_seq === null ? null : Number(user.totp_last_step_seq);
    const step = verifyTotp(secret, input.code, now.getTime(), { afterStep: lastStep });
    const audit = {
      actorUserId: row.user_id,
      companyId: user.company_id,
      objectType: "app_user",
      objectId: row.user_id,
      requestId: input.requestId ?? null,
      sourceIp: input.ip,
      userAgent: input.userAgent,
    };
    if (step === null) {
      await tx.query("DELETE FROM mfa_failure WHERE user_id = $1 AND failed_at <= $2", [row.user_id, since]);
      await tx.query("INSERT INTO mfa_failure (user_id, failed_at) VALUES ($1, $2)", [row.user_id, now]);
      if (ch.attempts + 1 >= MAX_CHALLENGE_ATTEMPTS) await drop();
      else await tx.query("UPDATE mfa_challenge SET attempts = attempts + 1 WHERE id = $1", [row.id]);
      await appendAudit(tx, { ...audit, action: "auth.mfa", result: "denied" });
      return { kind: "wrong", userId: row.user_id };
    }
    if (sealed) {
      await tx.query(
        "UPDATE app_user SET totp_secret_enc = $2, totp_enabled_at = $3, totp_last_step_seq = $4 WHERE id = $1",
        [row.user_id, sealed.enc, now, step],
      );
      await appendAudit(tx, { ...audit, action: "auth.mfa_enroll" });
    } else {
      await tx.query("UPDATE app_user SET totp_last_step_seq = $2 WHERE id = $1", [row.user_id, step]);
    }
    await drop();
    const s = await createSession(
      tx,
      row.user_id,
      { userAgent: input.userAgent, ip: input.ip, mfaAt: now },
      now,
    );
    await appendAudit(tx, { ...audit, action: "auth.login", objectType: "session", objectId: s.id });
    return {
      kind: "ok",
      enrolled: sealed !== null,
      result: { token: s.token, userId: row.user_id, companyId: user.company_id },
    };
  }, pool);
}

/**
 * Đặt lại TOTP (mất thiết bị): xoá bí mật + thử thách, huỷ mọi phiên, tăng auth_version; lần đăng nhập kế đăng ký lại.
 * Chỉ actor hệ thống tường minh (script vận hành `npm run -s mfa:reset`) — không có route HTTP. Người gọi chạy trong giao dịch
 * và ghi sự kiện bảo mật `auth.mfa_reset` SAU khi commit.
 */
export async function resetMfa(
  db: Queryable,
  actor: SystemActor,
  email: string,
): Promise<{ userId: string; companyId: string; hadSecret: boolean }> {
  const { rows } = await db.query<{ id: string; company_id: string; had: boolean }>(
    `SELECT id, company_id, (totp_secret_enc IS NOT NULL) AS had FROM app_user WHERE email = $1 FOR UPDATE`,
    [email],
  );
  const u = rows[0];
  if (!u) throw new AppError("NOT_FOUND", 404, t("err.shared.khongTimThayTaiKhoan"));
  await db.query(
    `UPDATE app_user SET totp_secret_enc = NULL, totp_enabled_at = NULL, totp_last_step_seq = NULL,
            auth_version = auth_version + 1 WHERE id = $1`,
    [u.id],
  );
  await db.query("DELETE FROM mfa_challenge WHERE user_id = $1", [u.id]);
  await destroyUserSessions(db, u.id);
  await appendAudit(db, {
    actorUserId: actor.userId,
    companyId: u.company_id,
    action: "auth.mfa_reset",
    objectType: "app_user",
    objectId: u.id,
    reason: t("msg.identity.mfaResetReason"),
    requestId: actor.requestId,
  });
  return { userId: u.id, companyId: u.company_id, hadSecret: u.had };
}
