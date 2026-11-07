// Tài khoản của chính người dùng (T-121, D-075): xác thực lại trước thao tác không đảo ngược + xoá tài khoản đăng nhập.
// Xác thực lại dùng CHUNG bộ đếm với đăng nhập (login_attempt: 5/cặp email+IP, 30/IP, 50/email trong 15 phút) và với bước
// TOTP (mfa_failure: 10/người/15 phút; chống phát lại bằng totp_last_step_seq). Lần sai được COMMIT trước khi ném lỗi.
// Không ghi email/mật khẩu/mã vào log hay audit (chỉ id và số đếm).
import type pg from "pg";
import { appendAudit } from "../audit/index.ts";
import { assertSysadminRemains } from "../authz/grants.ts";
import { openTextAsync, textColumn } from "../crypto/columns.ts";
import { withTx, type Queryable } from "../db/index.ts";
import { AppError } from "../nen/app-error.ts";
import { logSecurityEvent } from "../nen/security-event.ts";
import { msToSeconds } from "../nen/units.ts";
import { t } from "../i18n/index.ts";
import { recordAttempt } from "./auth.ts";
import { MAX_USER_MFA_FAILURES, MFA_WINDOW_MS } from "./mfa.ts";
import { verifyPassword } from "./password.ts";
import { destroyUserSessions } from "./session.ts";
import { base32Decode, verifyTotp } from "./totp.pure.ts";

export interface ReauthContext {
  userId: string;
  companyId: string;
  ip: string;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface ReauthCredentials {
  password: string;
  /** Bắt buộc khi tài khoản đã bật TOTP. */
  totp?: string | null;
}

interface Snapshot {
  email: string;
  password_hash: string | null;
  totp_secret_enc: string | null;
}

type Outcome<T> = { kind: "ok"; value: T } | { kind: "fail"; err: AppError; mfa: boolean };

/**
 * Xác thực lại người đang đăng nhập (mật khẩu hiện tại + TOTP nếu đã bật) rồi chạy `action` TRONG CÙNG giao dịch với bước
 * tiêu thụ mã TOTP và khoá dòng tài khoản (hai request song song tuần tự hoá; mã đã dùng không dùng lại). Nhận POOL như
 * login: lần sai commit riêng rồi mới ném. `action` lỗi → giao dịch lùi, lượt thử vẫn tính là mật khẩu đúng.
 */
export async function withReauth<T>(
  pool: pg.Pool,
  ctx: ReauthContext,
  cred: ReauthCredentials,
  action: (tx: Queryable) => Promise<T>,
  now: Date = new Date(),
): Promise<T> {
  const meta = { sourceIp: ctx.ip, userAgent: ctx.userAgent, requestId: ctx.requestId };
  // Bước 1: đọc tài khoản + ghi trước lượt thử là "sai" dưới bộ đếm của đăng nhập (vượt → 429), commit.
  const pre = await withTx(async (tx) => {
    const { rows } = await tx.query<Snapshot>(
      `SELECT email, password_hash, totp_secret_enc FROM app_user
        WHERE id = $1 AND company_id = $2 AND disabled_at IS NULL`,
      [ctx.userId, ctx.companyId],
    );
    const snap = rows[0];
    if (!snap) throw new AppError("UNAUTHENTICATED", 401, t("err.http.vuiLongDangNhap"));
    return { snap, attemptId: await recordAttempt(tx, snap.email, ctx.ip, now, meta) };
  }, pool);
  // Bước 2: băm + giải mã bí mật TOTP NGOÀI giao dịch (Argon2 tốn thời gian; KMS có thể gọi mạng).
  const ok = await verifyPassword(pre.snap.password_hash, cred.password);
  const enc = pre.snap.totp_secret_enc;
  const code = cred.totp?.trim() ?? "";
  const secretB32 =
    ok && enc !== null && code !== ""
      ? await openTextAsync(textColumn("app_user", "totp_secret"), ctx.userId, { totp_secret_enc: enc })
      : null;
  const secret = secretB32 === null ? null : base32Decode(secretB32);

  // Bước 3: ghi kết quả; thành công → chạy action trong cùng giao dịch.
  let reachedAction = false;
  let out: Outcome<T>;
  try {
    out = await withTx(async (tx): Promise<Outcome<T>> => {
      const audit = {
        actorUserId: ctx.userId,
        companyId: ctx.companyId,
        objectType: "app_user",
        objectId: ctx.userId,
        requestId: ctx.requestId ?? null,
      };
      const fail = async (err: AppError, mfa = false): Promise<Outcome<T>> => {
        await appendAudit(tx, {
          ...audit,
          action: mfa ? "auth.reauth_mfa" : "auth.reauth",
          result: "denied",
        });
        return { kind: "fail", err, mfa };
      };
      const denied = () => new AppError("REAUTH_FAILED", 403, t("err.identity.matKhauHienTaiKhongDung"));
      if (!ok) return fail(denied());
      const u = await tx.query<{
        password_hash: string | null;
        totp_secret_enc: string | null;
        totp_enabled_at: Date | null;
        totp_last_step_seq: string | null;
      }>(
        `SELECT password_hash, totp_secret_enc, totp_enabled_at, totp_last_step_seq FROM app_user
          WHERE id = $1 AND disabled_at IS NULL FOR UPDATE`,
        [ctx.userId],
      );
      const user = u.rows[0];
      // Tài khoản bị vô hiệu/đổi mật khẩu/đổi bí mật TOTP giữa hai bước → kết quả bước 2 hết giá trị.
      if (!user || user.password_hash !== pre.snap.password_hash || user.totp_secret_enc !== enc)
        return fail(denied());
      await tx.query("UPDATE login_attempt SET success = true WHERE id = $1", [pre.attemptId]);
      if (user.totp_enabled_at !== null) {
        if (code === "")
          return fail(new AppError("MFA_CODE_REQUIRED", 403, t("err.identity.canMaXacThucDeXacNhan")), true);
        const since = new Date(now.getTime() - MFA_WINDOW_MS);
        const f = await tx.query<{ n: number; oldest: Date | null }>(
          "SELECT count(*)::int AS n, min(failed_at) AS oldest FROM mfa_failure WHERE user_id = $1 AND failed_at > $2",
          [ctx.userId, since],
        );
        const fails = f.rows[0]!;
        if (fails.n >= MAX_USER_MFA_FAILURES) {
          const oldest = fails.oldest?.getTime() ?? now.getTime();
          const retryAfter = Math.max(1, Math.ceil(msToSeconds(oldest + MFA_WINDOW_MS - now.getTime())));
          return fail(
            new AppError("RATE_LIMITED", 429, t("err.identity.nhapSaiMaQuaNhieuLan"), { retryAfter }),
            true,
          );
        }
        const lastStep = user.totp_last_step_seq === null ? null : Number(user.totp_last_step_seq);
        const step =
          secret === null || secret.length === 0
            ? null
            : verifyTotp(secret, code, now.getTime(), { afterStep: lastStep });
        if (step === null) {
          await tx.query("DELETE FROM mfa_failure WHERE user_id = $1 AND failed_at <= $2", [
            ctx.userId,
            since,
          ]);
          await tx.query("INSERT INTO mfa_failure (user_id, failed_at) VALUES ($1, $2)", [ctx.userId, now]);
          return fail(new AppError("INVALID_MFA_CODE", 403, t("err.identity.maXacThucKhongDung")), true);
        }
        await tx.query("UPDATE app_user SET totp_last_step_seq = $2 WHERE id = $1", [ctx.userId, step]);
      }
      await appendAudit(tx, { ...audit, action: "auth.reauth" });
      reachedAction = true;
      return { kind: "ok", value: await action(tx) };
    }, pool);
  } catch (err) {
    // Mật khẩu đúng nhưng thao tác lỗi nghiệp vụ: lượt thử không phải "sai" (không làm khoá đăng nhập của chính chủ).
    if (reachedAction)
      await pool.query("UPDATE login_attempt SET success = true WHERE id = $1", [pre.attemptId]);
    throw err;
  }
  const target = { type: "app_user", id: ctx.userId };
  if (out.kind === "fail") {
    logSecurityEvent({
      ...meta,
      event: out.err.status === 429 ? "auth.rate_limited" : out.mfa ? "auth.mfa" : "auth.login",
      outcome: "denied",
      actorId: ctx.userId,
      target,
      detail: { step: "reauth", reason: out.err.code },
    });
    throw out.err;
  }
  logSecurityEvent({
    ...meta,
    event: "auth.login",
    outcome: "success",
    actorId: ctx.userId,
    target,
    detail: { step: "reauth" },
  });
  return out.value;
}

export interface AccountErased {
  /** Số phiên bị thu hồi. */
  sessions: number;
  /** Quyền (role_grant) bị thu hồi. */
  grants: number;
  /** Thông báo trong ứng dụng của tài khoản đã xoá. */
  notifications: number;
  /** Bản ghi lần đăng nhập (email + IP) đã xoá. */
  login_attempts: number;
  /** Thử thách/lần sai TOTP đã xoá. */
  mfa_records: number;
  /** Bản ghi idempotency (phản hồi đã lưu) đã xoá. */
  idempotency_records: number;
  /** 1 = tài khoản vừa bị vô hiệu đăng nhập và xoá thông tin định danh; 0 = đã xoá từ trước (gọi lại). */
  account: number;
}

/** Email thay thế sau khi xoá: tất định theo id (gọi lại không đổi), miền `.invalid` (RFC 2606) không bao giờ nhận thư. */
export const erasedEmailOf = (userId: string) => `erased-${userId}@erased.invalid`;

/**
 * Xoá tài khoản đăng nhập trong giao dịch của người gọi: không xoá dòng app_user (khoá ngoại từ audit/yêu cầu/việc), mà
 * vô hiệu đăng nhập vĩnh viễn (mật khẩu băm + bí mật TOTP = NULL, disabled_at, tăng auth_version) và thay email/tên hiển thị
 * bằng giá trị không định danh; thu hồi mọi phiên + quyền; xoá dữ liệu theo tài khoản không thuộc danh mục phải giữ
 * (thông báo, lần đăng nhập, thử thách/lần sai TOTP, phản hồi idempotency đã lưu). Từ chối nếu là sysadmin hiệu lực cuối.
 * Idempotent: gọi lại trên tài khoản đã xoá → mọi số đếm 0. Audit chỉ ghi số đếm.
 */
export async function eraseAccount(
  tx: Queryable,
  actor: { userId: string | null; requestId?: string | null },
  companyId: string,
  userId: string,
): Promise<AccountErased> {
  const { rows } = await tx.query<{ email: string }>(
    "SELECT email FROM app_user WHERE company_id = $1 AND id = $2 FOR UPDATE",
    [companyId, userId],
  );
  const cur = rows[0];
  if (!cur) throw new AppError("NOT_FOUND", 404, t("err.shared.khongTimThayTaiKhoan"));
  await assertSysadminRemains(tx, companyId, { userId });
  const n = async (sql: string, params: unknown[]) => (await tx.query(sql, params)).rowCount ?? 0;
  const erasedEmail = erasedEmailOf(userId);
  const out: AccountErased = {
    grants: await n("UPDATE role_grant SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [
      userId,
    ]),
    notifications: await n("DELETE FROM notification WHERE company_id = $1 AND user_id = $2", [
      companyId,
      userId,
    ]),
    login_attempts:
      cur.email === erasedEmail ? 0 : await n("DELETE FROM login_attempt WHERE email = $1", [cur.email]),
    mfa_records:
      (await n("DELETE FROM mfa_challenge WHERE user_id = $1", [userId])) +
      (await n("DELETE FROM mfa_failure WHERE user_id = $1", [userId])),
    idempotency_records: await n("DELETE FROM idempotency_record WHERE company_id = $1 AND user_id = $2", [
      companyId,
      userId,
    ]),
    sessions: (await tx.query("SELECT 1 FROM session WHERE user_id = $1", [userId])).rowCount ?? 0,
    account: await n(
      `UPDATE app_user SET email = $2, display_name = $3, password_hash = NULL, totp_secret_enc = NULL,
              totp_enabled_at = NULL, totp_last_step_seq = NULL, disabled_at = COALESCE(disabled_at, now()),
              auth_version = auth_version + 1
        WHERE id = $1 AND email <> $2`,
      [userId, erasedEmail, t("msg.identity.erasedAccountName")],
    ),
  };
  await destroyUserSessions(tx, userId);
  await appendAudit(tx, {
    actorUserId: actor.userId,
    companyId,
    action: "account.erase",
    objectType: "app_user",
    objectId: userId,
    after: { ...out },
    requestId: actor.requestId ?? null,
  });
  return out;
}
