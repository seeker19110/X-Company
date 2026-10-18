// Cấp/thu hồi quyền (access.manage — sysadmin). Mỗi thay đổi tăng app_user.auth_version và huỷ mọi phiên đang mở của người đó (đổi đặc quyền → ID phiên mới, BE-AUTH-004).
import { appendAudit } from "../audit/index.ts";
import type { Queryable } from "../db/index.ts";
import { destroyUserSessions } from "../identity/session.ts";
import { AppError } from "../nen/app-error.ts";
import type { Actor } from "../org/index.ts";
import { ROLES, type Role, type ScopeType } from "./index.ts";
import { t } from "../i18n/index.ts";

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
  if (!ROLES.includes(g.role)) throw new AppError("INVALID_ROLE", 422, t("err.authz.vaiTroKhongHopLe"));
  const needsId = g.scopeType !== "company" && g.scopeType !== "self";
  if (needsId !== !!g.scopeId) throw new AppError("INVALID_SCOPE", 422, t("err.authz.phamViVaMaPhamVi"));
  const table = SCOPE_TABLE[g.scopeType];
  if (table) {
    // sql-interp-allow: `table` lấy từ SCOPE_TABLE (hằng "branch"/"department"), không bao giờ từ đầu vào.
    const ok = await tx.query(`SELECT 1 FROM ${table} WHERE company_id = $1 AND id = $2`, [
      companyId,
      g.scopeId,
    ]);
    if (ok.rowCount === 0) throw new AppError("INVALID_SCOPE", 422, t("err.authz.phamViKhongThuocCongTy"));
  }
  const u = await tx.query("SELECT 1 FROM app_user WHERE company_id = $1 AND id = $2", [companyId, g.userId]);
  if (u.rowCount === 0) throw new AppError("NOT_FOUND", 404, t("err.shared.khongTimThayTaiKhoan"));
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
  await destroyUserSessions(tx, g.userId); // đổi đặc quyền → ID phiên cũ vô hiệu, phải đăng nhập lại (BE-AUTH-004)
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
  if (!row) throw new AppError("NOT_FOUND", 404, t("err.authz.khongTimThayQuyenDangHieu"));
  await tx.query("UPDATE app_user SET auth_version = auth_version + 1 WHERE id = $1", [row.user_id]);
  await destroyUserSessions(tx, row.user_id); // thu hồi quyền → mọi phiên cũ của người đó bị huỷ
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
