// Nạp ActorContext từ DB: tài khoản còn hiệu lực + grant còn hạn, phạm vi phòng ban mở rộng thành cây con (R3, R8).
import type { Queryable } from "../db/index.ts";
import { departmentSubtree } from "../org/index.ts";
import type { ActorContext, Grant, Role, ScopeType } from "./index.ts";

export async function loadActor(
  db: Queryable,
  userId: string,
  now: Date = new Date(),
): Promise<ActorContext | null> {
  const u = await db.query<{ id: string; company_id: string; employee_id: string | null }>(
    "SELECT id, company_id, employee_id FROM app_user WHERE id = $1 AND disabled_at IS NULL",
    [userId],
  );
  const user = u.rows[0];
  if (!user) return null;
  const g = await db.query<{
    role: Role;
    company_id: string;
    scope_type: ScopeType;
    scope_id: string | null;
  }>(
    `SELECT role, company_id, scope_type, scope_id FROM role_grant
     WHERE user_id = $1 AND revoked_at IS NULL AND valid_from <= $2 AND (valid_to IS NULL OR valid_to > $2)`,
    [userId, now],
  );
  const grants: Grant[] = [];
  for (const r of g.rows) {
    const grant: Grant = {
      role: r.role,
      companyId: r.company_id,
      scopeType: r.scope_type,
      scopeId: r.scope_id,
    };
    if (r.scope_type === "department" && r.scope_id) {
      grant.departmentIds = await departmentSubtree(db, r.company_id, r.scope_id);
    }
    grants.push(grant);
  }
  return { userId: user.id, companyId: user.company_id, employeeId: user.employee_id, grants };
}
