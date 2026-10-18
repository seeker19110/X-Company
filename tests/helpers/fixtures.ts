// Dữ liệu dựng cho test: công ty, cơ cấu, tài khoản có mật khẩu và grant. Chỉ dùng trong test.
import { randomUUID } from "node:crypto";
import { withTx } from "../../lib/db/index.ts";
import { grantRole } from "../../lib/authz/grants.ts";
import type { Role, ScopeType } from "../../lib/authz/index.ts";
import { hashPassword } from "../../lib/identity/password.ts";
import { createBranch, createCompany, createDepartment, createEmployee } from "../../lib/org/index.ts";

export const TEST_ORIGIN = "http://xc.test";
export const PASSWORD = "Mat-khau-dai-du-12!";

export function setTestEnv(): void {
  process.env.SESSION_SECRET ??= "test-session-secret-0123456789abcdef-xyz";
  process.env.APP_ORIGIN = TEST_ORIGIN;
  process.env.LOG_LEVEL ??= "silent"; // test log tự bật mức khi cần
}

const sys = { userId: null };
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
