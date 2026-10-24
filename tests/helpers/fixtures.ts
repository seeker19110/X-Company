// Dữ liệu dựng cho test: công ty, cơ cấu, tài khoản có mật khẩu và grant. Chỉ dùng trong test.
import { randomUUID } from "node:crypto";
import { getPool, withTx } from "../../lib/db/index.ts";
import { openTextAsync, textColumn } from "../../lib/crypto/columns.ts";
import { loginHandler, mfaHandler } from "../../lib/identity/routes.ts";
import { base32Decode, hotp, totpStep } from "../../lib/identity/totp.pure.ts";
import { grantRole } from "../../lib/authz/grants.ts";
import { SYSTEM_ACTOR, type Role, type ScopeType } from "../../lib/authz/index.ts";
import { hashPassword } from "../../lib/identity/password.ts";
import { createBranch, createCompany, createDepartment, createEmployee } from "../../lib/org/index.ts";

export const TEST_ORIGIN = "http://xc.test";
export const PASSWORD = "Mat-khau-dai-du-12!";

export function setTestEnv(): void {
  process.env.SESSION_SECRET ??= "test-session-secret-0123456789abcdef-xyz";
  process.env.APP_ORIGIN = TEST_ORIGIN;
  process.env.LOG_LEVEL ??= "silent"; // test log tự bật mức khi cần
}

const sys = SYSTEM_ACTOR; // actor hệ thống tường minh (AUD-SEC-005)
let hashed: Promise<string> | undefined;

export async function seedCompany(name = "Công ty Test") {
  return withTx(async (tx) => {
    const companyId = await createCompany(tx, sys, { name });
    const branchId = await createBranch(tx, sys, companyId, { code: "HN", name: "Hà Nội" });
    const deptId = await createDepartment(tx, sys, companyId, { code: "KT", name: "Kỹ thuật", branchId });
    const subDeptId = await createDepartment(tx, sys, companyId, {
      code: "KT-1",
      name: "Tổ 1",
      branchId,
      parentId: deptId,
    });
    const otherDeptId = await createDepartment(tx, sys, companyId, {
      code: "HC",
      name: "Hành chính",
      branchId,
    });
    return { companyId, branchId, deptId, subDeptId, otherDeptId };
  });
}

let seq = 0;
export async function seedUser(
  companyId: string,
  opts: {
    grants?: { role: Role; scopeType: ScopeType; scopeId?: string | null }[];
    withEmployee?: boolean;
  } = {},
) {
  hashed ??= hashPassword(PASSWORD);
  const n = ++seq;
  return withTx(async (tx) => {
    const employeeId =
      opts.withEmployee === false
        ? null
        : await createEmployee(tx, sys, companyId, {
            code: `NV${n}-${companyId.slice(0, 4)}`,
            fullName: `Nhân viên ${n}`,
          });
    const email = `user${n}.${companyId.slice(0, 8)}@x.test`;
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO app_user (email, display_name, password_hash, company_id, employee_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [email, `Người dùng ${n}`, await hashed, companyId, employeeId],
    );
    const userId = rows[0]!.id;
    for (const g of opts.grants ?? []) {
      await grantRole(tx, sys, companyId, {
        userId,
        role: g.role,
        scopeType: g.scopeType,
        scopeId: g.scopeId ?? null,
      });
    }
    return { userId, employeeId, email };
  });
}

/** Request tới handler: tự gắn Origin cùng nguồn, cookie phiên và CSRF khi có. */
export function req(
  method: string,
  path: string,
  opts: {
    body?: unknown;
    cookie?: string | null;
    csrf?: string | null;
    origin?: string | null;
    headers?: Record<string, string>;
    /** POST /api/app/*: mặc định tự sinh khoá mới (route ghi bắt buộc Idempotency-Key); null = không gửi. */
    idempotencyKey?: string | null;
  } = {},
): Request {
  const headers: Record<string, string> = { ...opts.headers };
  if (method === "POST" && path.startsWith("/api/app/") && !("idempotency-key" in headers)) {
    if (opts.idempotencyKey === undefined) headers["idempotency-key"] = randomUUID();
    else if (opts.idempotencyKey !== null) headers["idempotency-key"] = opts.idempotencyKey;
  }
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const origin = opts.origin === undefined ? TEST_ORIGIN : opts.origin;
  if (origin) headers.origin = origin;
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.csrf) headers["x-csrf-token"] = opts.csrf;
  return new Request(`${TEST_ORIGIN}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

/** Lấy cặp name=value từ Set-Cookie để gửi lại. */
export function cookieFrom(res: Response): string {
  const sc = res.headers.get("set-cookie") ?? "";
  return sc.split(";")[0] ?? "";
}

/** Mã TOTP hợp lệ kế tiếp cho bí mật: bước hiện tại nếu chưa dùng, không thì bước +1 (cửa sổ ±1); đã dùng cả hai → chờ bước mới. */
export async function nextTotpCode(secretB32: string, lastStep: number | null): Promise<string> {
  const secret = base32Decode(secretB32)!;
  for (;;) {
    const cur = totpStep(Date.now());
    for (const s of [cur, cur + 1]) if (lastStep === null || s > lastStep) return hotp(secret, s);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** Bí mật TOTP đã bật của tài khoản (giải mã từ DB) + bước đã dùng cuối — chỉ cho test. */
export async function totpStateOf(
  email: string,
): Promise<{ secret: string | null; lastStep: number | null }> {
  const { rows } = await getPool().query<{
    id: string;
    totp_secret_enc: string | null;
    totp_last_step_seq: string | null;
  }>("SELECT id, totp_secret_enc, totp_last_step_seq FROM app_user WHERE email = $1", [email.toLowerCase()]);
  const r = rows[0];
  if (!r) return { secret: null, lastStep: null };
  return {
    secret: await openTextAsync(textColumn("app_user", "totp_secret"), r.id, r),
    lastStep: r.totp_last_step_seq === null ? null : Number(r.totp_last_step_seq),
  };
}

/**
 * Đăng nhập qua route THẬT; nếu tài khoản cần TOTP (AUD-SEC-002) thì đi tiếp bước /api/app/auth/mfa với mã đúng (đăng ký
 * lần đầu dùng bí mật server trả về). Trả phản hồi cuối (cookie phiên + `{user_id, csrf_token}`), hoặc phản hồi login nếu lỗi.
 */
export async function loginThrough(
  email: string,
  password: string = PASSWORD,
  opts: { origin?: string | null; headers?: Record<string, string> } = {},
): Promise<Response> {
  const res = await loginHandler(req("POST", "/api/app/auth/login", { body: { email, password }, ...opts }));
  if (res.status !== 200) return res;
  const body = (await res.clone().json()) as { mfa?: string; challenge?: string; secret?: string };
  if (!body.mfa) return res;
  const st = await totpStateOf(email);
  const secret = body.secret ?? st.secret;
  if (!secret) throw new Error(`loginThrough: ${email} cần TOTP nhưng không có bí mật`);
  const code = await nextTotpCode(secret, body.secret ? null : st.lastStep);
  return mfaHandler(req("POST", "/api/app/auth/mfa", { body: { challenge: body.challenge, code }, ...opts }));
}
