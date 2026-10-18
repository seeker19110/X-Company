// Cấp/thu hồi quyền (access.manage — sysadmin). Mỗi thay đổi tăng app_user.auth_version để phiên đang mở kiểm lại (R8).
import { appendAudit } from "../audit/index.ts";
import type { Queryable } from "../db/index.ts";
import { AppError } from "../nen/app-error.ts";
import type { Actor } from "../org/index.ts";
import { ROLES, type Role, type ScopeType } from "./index.ts";

const SCOPE_TABLE: Partial<Record<ScopeType, string>> = { branch: "branch", department: "department" };

export interface GrantInput {
  userId: string;
  role: Role;
  scopeType: ScopeType;
  scopeId?: string | null;
  validFrom?: Date;
  validTo?: Date | null;
}

export async function grantRole(
  tx: Queryable,
  actor: Actor,
  companyId: string,
  g: GrantInput,
): Promise<string> {
  if (!ROLES.includes(g.role)) throw new AppError("INVALID_ROLE", 422, "Vai trò không hợp lệ");
  const needsId = g.scopeType !== "company" && g.scopeType !== "self";
  if (needsId !== !!g.scopeId) throw new AppError("INVALID_SCOPE", 422, "Phạm vi và mã phạm vi không khớp");
  const table = SCOPE_TABLE[g.scopeType];
  if (table) {
    const ok = await tx.query(`SELECT 1 FROM ${table} WHERE company_id = $1 AND id = $2`, [
      companyId,
      g.scopeId,
    ]);
    if (ok.rowCount === 0) throw new AppError("INVALID_SCOPE", 422, "Phạm vi không thuộc công ty");
  }
  const u = await tx.query("SELECT 1 FROM app_user WHERE company_id = $1 AND id = $2", [companyId, g.userId]);
  if (u.rowCount === 0) throw new AppError("NOT_FOUND", 404, "Không tìm thấy tài khoản");
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO role_grant (company_id, user_id, role, scope_type, scope_id, valid_from, valid_to, granted_by)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, now()), $7, $8) RETURNING id`,
    [
      companyId,
      g.userId,
      g.role,
      g.scopeType,
      g.scopeId ?? null,
      g.validFrom ?? null,
      g.validTo ?? null,
      actor.userId,
    ],
  );
  const id = rows[0]!.id;
  await tx.query("UPDATE app_user SET auth_version = auth_version + 1 WHERE id = $1", [g.userId]);
  await appendAudit(tx, {
    actorUserId: actor.userId,
    companyId,
    action: "grant.create",
    objectType: "role_grant",
    objectId: id,
    after: g,
    requestId: actor.requestId ?? null,
  });
  return id;
}

export async function revokeGrant(
  tx: Queryable,
  actor: Actor,
  companyId: string,
  grantId: string,
  reason: string,
) {
  const { rows } = await tx.query<{ user_id: string }>(
    `UPDATE role_grant SET revoked_at = now() WHERE company_id = $1 AND id = $2 AND revoked_at IS NULL RETURNING user_id`,
    [companyId, grantId],
  );
  const row = rows[0];
  if (!row) throw new AppError("NOT_FOUND", 404, "Không tìm thấy quyền đang hiệu lực");
  await tx.query("UPDATE app_user SET auth_version = auth_version + 1 WHERE id = $1", [row.user_id]);
  await appendAudit(tx, {
    actorUserId: actor.userId,
    companyId,
    action: "grant.revoke",
    objectType: "role_grant",
    objectId: grantId,
    reason,
    requestId: actor.requestId ?? null,
  });
}
