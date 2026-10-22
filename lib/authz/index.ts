// Phân quyền (SPEC-identity-org R1–R7): hàm thuần `can(actor, action, resource)`, mặc định từ chối.
// Actor được nạp từ DB bởi `loadActor` (lib/authz/load.ts) — phạm vi phòng ban đã mở rộng thành cả cây con (R3).

export const ROLES = [
  "employee",
  "team_lead",
  "project_manager",
  "hr",
  "accountant",
  "editor",
  "sales",
  "executive",
  "sysadmin",
  "sensitive_exporter",
] as const;
export type Role = (typeof ROLES)[number];
export type ScopeType = "company" | "branch" | "department" | "project" | "self";

export interface Grant {
  role: Role;
  companyId: string;
  scopeType: ScopeType;
  scopeId: string | null;
  /** Với scopeType=department: id phòng ban và mọi phòng ban con. */
  departmentIds?: readonly string[];
}

export interface ActorContext {
  userId: string;
  companyId: string;
  employeeId: string | null;
  grants: readonly Grant[];
}

const SYSTEM: unique symbol = Symbol("xt.system-actor");
/**
 * Actor hệ thống TƯỜNG MINH (bootstrap, seed, worker nội bộ) — không có người dùng nên không có grant.
 * Chỉ đúng hằng `SYSTEM_ACTOR` (so sánh danh tính) được bỏ qua kiểm quyền; `{ userId: null }` tự dựng
 * không qua được (khoá `symbol` không thể đến từ JSON/đầu vào HTTP).
 */
export interface SystemActor {
  readonly [SYSTEM]: true;
  readonly userId: null;
  readonly requestId: null;
}
export const SYSTEM_ACTOR: SystemActor = Object.freeze({
  [SYSTEM]: true as const,
  userId: null,
  requestId: null,
});
export const isSystemActor = (a: unknown): a is SystemActor => a === SYSTEM_ACTOR;

/** Thuộc tính phạm vi của tài nguyên — chỉ những trục có ý nghĩa với tài nguyên đó. */
export interface Resource {
  companyId: string;
  branchId?: string | null;
  departmentId?: string | null;
  projectId?: string | null;
  /** Nhân viên sở hữu dữ liệu (công, đơn, hồ sơ). */
  ownerEmployeeId?: string | null;
}

/**
 * Danh mục quyền: action → vai trò được phép. Phạm vi của grant quyết định tài nguyên nào (scopeMatches).
 * `self: true` = chủ dữ liệu (ownerEmployeeId = actor.employeeId) được phép dù không có grant nào khác.
 * R4: project_manager KHÔNG có trong các quyền đọc hồ sơ HR/công/lương. R6: export nhạy cảm chỉ sensitive_exporter.
 */
export const PERMISSIONS = {
  "org.read": { roles: ROLES, self: false },
  "org.manage": { roles: ["hr", "sysadmin"], self: false },
  "access.manage": { roles: ["sysadmin"], self: false },
  "employee.read_profile": { roles: ["hr", "executive"], self: true },
  "employee.manage": { roles: ["hr"], self: false },
  "attendance.read": { roles: ["team_lead", "hr", "executive"], self: true },
  "attendance.write_own": { roles: [], self: true },
  "attendance.approve": { roles: ["team_lead", "hr"], self: false },
  "attendance.ot_exception": { roles: ["hr"], self: false },
  "leave.adjust": { roles: ["hr"], self: false },
  "attendance.qr_display": { roles: ["team_lead", "hr", "sysadmin"], self: false },
  "period.manage": { roles: ["hr"], self: false },
  "period.read_locked": { roles: ["hr", "accountant", "executive"], self: false },
  "export.sensitive": { roles: ["sensitive_exporter"], self: false },
  "leave.request": { roles: [], self: true },
  // AUD-XFEAT-006: đơn OT / đề nghị sửa công của CHÍNH MÌNH — tách khỏi leave.request để audit "denied" đúng tên.
  "ot.request": { roles: [], self: true },
  "adjustment.request_own": { roles: [], self: true },
  "project.read": { roles: ["employee", "team_lead", "project_manager", "executive"], self: false },
  "project.manage": { roles: ["project_manager"], self: false },
  "project.create": { roles: ["project_manager", "executive"], self: false },
  "project.approve_baseline": { roles: ["executive"], self: false },
  "cms.edit": { roles: ["editor"], self: false },
  "cms.approve": { roles: ["editor", "executive"], self: false },
  "inquiry.manage": { roles: ["sales"], self: false },
  "application.read": { roles: ["hr"], self: false },
  // Tiếp nhận/xử lý yêu cầu quyền chủ thể dữ liệu (DSAR, T-040) — người phụ trách là HR.
  "privacy.manage": { roles: ["hr"], self: false },
} as const satisfies Record<string, { roles: readonly Role[]; self: boolean }>;

export type Action = keyof typeof PERMISSIONS;

export function scopeMatches(grant: Grant, actor: ActorContext, res: Resource): boolean {
  if (grant.companyId !== res.companyId) return false; // R7
  switch (grant.scopeType) {
    case "company":
      return true;
    case "branch":
      return !!res.branchId && res.branchId === grant.scopeId;
    case "department":
      return !!res.departmentId && (grant.departmentIds ?? [grant.scopeId]).includes(res.departmentId);
    case "project":
      return !!res.projectId && res.projectId === grant.scopeId;
    case "self":
      return !!res.ownerEmployeeId && res.ownerEmployeeId === actor.employeeId;
  }
}

/** Quyết định quyền. Không khớp gì → false (mặc định từ chối, R2). */
export function can(actor: ActorContext | null, action: Action, res: Resource): boolean {
  if (!actor) return false; // R1
  if (actor.companyId !== res.companyId) return false; // R7
  const p = PERMISSIONS[action];
  if (p.self && actor.employeeId && res.ownerEmployeeId === actor.employeeId) return true;
  const roles: readonly Role[] = p.roles;
  return actor.grants.some((g) => roles.includes(g.role) && scopeMatches(g, actor, res));
}

/** R5: người tạo/đề nghị không tự duyệt. So cả userId lẫn employeeId. */
export function isSelfApproval(
  actor: ActorContext,
  creator: { userId?: string | null; employeeId?: string | null },
): boolean {
  return (
    (!!creator.userId && creator.userId === actor.userId) ||
    (!!creator.employeeId && !!actor.employeeId && creator.employeeId === actor.employeeId)
  );
}
