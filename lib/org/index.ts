// Tổ chức (F-001): công ty, chi nhánh, phòng ban (cây), địa điểm, nhân viên, lịch sử công tác theo khoảng hiệu lực.
// Hàm nhận `tx` của giao dịch và actor (để ghi audit); kiểm quyền nằm ở lớp gọi (`can()`), không ở đây.
import { appendAudit } from "../audit/index.ts";
import type { Queryable } from "../db/index.ts";
import { AppError } from "../nen/app-error.ts";
import { t } from "../i18n/index.ts";

export interface Actor {
  userId: string | null;
  requestId?: string | null;
}

function audit(
  tx: Queryable,
  actor: Actor,
  companyId: string,
  action: string,
  objectType: string,
  id: string,
  after: unknown,
) {
  return appendAudit(tx, {
    actorUserId: actor.userId,
    companyId,
    action,
    objectType,
    objectId: id,
    after,
    requestId: actor.requestId ?? null,
  });
}

/** Chuyển lỗi ràng buộc Postgres thành AppError có mã ổn định. */
export function mapPgError(err: unknown): never {
  const e = err as { code?: string; constraint?: string; message?: string };
  if (e?.code === "23505")
    throw new AppError("DUPLICATE", 409, t("err.org.maDaTonTai"), { constraint: e.constraint });
  if (e?.code === "23503") throw new AppError("INVALID_REFERENCE", 422, t("err.org.thamChieuKhongHopLeHoac"));
  if (e?.code === "23P01") throw new AppError("OVERLAP", 409, t("err.org.khoangHieuLucBiChong"));
  if (e?.code === "23514")
    throw new AppError(
      "CONSTRAINT",
      422,
      // i18n-ignore: so khớp thông điệp RAISE tiếng Việt do trigger trong migration phát ra (migration append-only, không đổi được); chỉ để nhận diện, rồi chuyển nguyên văn
      e.message?.includes("chu trình") ? e.message : t("err.org.constraintViolation"),
    );
  throw err;
}

async function insertReturningId(tx: Queryable, sql: string, params: unknown[]): Promise<string> {
  try {
    const { rows } = await tx.query<{ id: string }>(sql, params);
    return rows[0]!.id;
  } catch (err) {
    mapPgError(err);
  }
}

export async function createCompany(tx: Queryable, actor: Actor, input: { name: string; taxCode?: string }) {
  const id = await insertReturningId(
    tx,
    "INSERT INTO company (name, tax_code) VALUES ($1, $2) RETURNING id",
    [input.name, input.taxCode ?? null],
  );
  await audit(tx, actor, id, "company.create", "company", id, input);
  return id;
}

export async function createBranch(
  tx: Queryable,
  actor: Actor,
  companyId: string,
  input: { code: string; name: string },
) {
  const id = await insertReturningId(
    tx,
    "INSERT INTO branch (company_id, code, name) VALUES ($1, $2, $3) RETURNING id",
    [companyId, input.code, input.name],
  );
  await audit(tx, actor, companyId, "branch.create", "branch", id, input);
  return id;
}

export async function createDepartment(
  tx: Queryable,
  actor: Actor,
  companyId: string,
  input: { code: string; name: string; branchId: string; parentId?: string | null },
) {
  const id = await insertReturningId(
    tx,
    "INSERT INTO department (company_id, branch_id, parent_id, code, name) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [companyId, input.branchId, input.parentId ?? null, input.code, input.name],
  );
  await audit(tx, actor, companyId, "department.create", "department", id, input);
  return id;
}

export async function moveDepartment(
  tx: Queryable,
  actor: Actor,
  companyId: string,
  departmentId: string,
  parentId: string | null,
) {
  try {
    const r = await tx.query("UPDATE department SET parent_id = $3 WHERE company_id = $1 AND id = $2", [
      companyId,
      departmentId,
      parentId,
    ]);
    if (r.rowCount === 0) throw new AppError("NOT_FOUND", 404, t("err.org.khongTimThayPhongBan"));
  } catch (err) {
    if (err instanceof AppError) throw err;
    mapPgError(err);
  }
  await audit(tx, actor, companyId, "department.move", "department", departmentId, { parentId });
}

/** Phòng ban và mọi phòng ban con (cây) — dùng cho phạm vi `department` (R3). */
export async function departmentSubtree(
  db: Queryable,
  companyId: string,
  departmentId: string,
): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `WITH RECURSIVE sub(id) AS (
       SELECT id FROM department WHERE company_id = $1 AND id = $2
       UNION
       SELECT d.id FROM department d JOIN sub ON d.parent_id = sub.id WHERE d.company_id = $1
     ) SELECT id FROM sub`,
    [companyId, departmentId],
  );
  return rows.map((r) => r.id);
}

export async function createWorksite(
  tx: Queryable,
  actor: Actor,
  companyId: string,
  input: {
    code: string;
    name: string;
    branchId?: string | null;
    address?: string | null;
    lat?: number | null;
    lng?: number | null;
    radiusM?: number | null;
  },
) {
  const id = await insertReturningId(
    tx,
    `INSERT INTO worksite (company_id, branch_id, code, name, address, lat, lng, radius_m)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      companyId,
      input.branchId ?? null,
      input.code,
      input.name,
      input.address ?? null,
      input.lat ?? null,
      input.lng ?? null,
      input.radiusM ?? null,
    ],
  );
  await audit(tx, actor, companyId, "worksite.create", "worksite", id, input);
  return id;
}

export async function createEmployee(
  tx: Queryable,
  actor: Actor,
  companyId: string,
  input: {
    code: string;
    fullName: string;
    workEmail?: string | null;
    phone?: string | null;
    hiredOn?: string | null;
  },
) {
  const id = await insertReturningId(
    tx,
    `INSERT INTO employee (company_id, code, full_name, work_email, phone, hired_on)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      companyId,
      input.code,
      input.fullName,
      input.workEmail ?? null,
      input.phone ?? null,
      input.hiredOn ?? null,
    ],
  );
  await audit(tx, actor, companyId, "employee.create", "employee", id, { code: input.code });
  return id;
}

export interface Assignment {
  departmentId: string;
  title?: string | null;
  managerEmployeeId?: string | null;
  validFrom: string; // YYYY-MM-DD
}

/**
 * Gán đơn vị/chức danh/quản lý từ `validFrom`: đóng bản ghi đang mở (valid_to = validFrom) rồi thêm bản mới.
 * Lịch sử không bị viết lại (§11). `validFrom` không được trước bản ghi đang mở.
 */
export async function assignEmployment(
  tx: Queryable,
  actor: Actor,
  companyId: string,
  employeeId: string,
  a: Assignment,
): Promise<string> {
  await tx.query("SELECT 1 FROM employee WHERE company_id = $1 AND id = $2 FOR UPDATE", [
    companyId,
    employeeId,
  ]);
  const open = await tx.query<{ id: string; valid_from: string }>(
    "SELECT id, valid_from FROM employment_history WHERE company_id = $1 AND employee_id = $2 AND valid_to IS NULL",
    [companyId, employeeId],
  );
  const cur = open.rows[0];
  if (cur) {
    if (a.validFrom <= cur.valid_from) {
      throw new AppError("BACKDATED_ASSIGNMENT", 422, t("err.org.ngayHieuLucPhaiSauBan"), {
        currentFrom: cur.valid_from,
      });
    }
    await tx.query("UPDATE employment_history SET valid_to = $2 WHERE id = $1", [cur.id, a.validFrom]);
  }
  const id = await insertReturningId(
    tx,
    `INSERT INTO employment_history (company_id, employee_id, department_id, title, manager_employee_id, valid_from)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [companyId, employeeId, a.departmentId, a.title ?? null, a.managerEmployeeId ?? null, a.validFrom],
  );
  await audit(tx, actor, companyId, "employment.assign", "employee", employeeId, {
    ...a,
    closed: cur?.id ?? null,
  });
  return id;
}

export interface EmploymentAt {
  departmentId: string;
  title: string | null;
  managerEmployeeId: string | null;
  validFrom: string;
  validTo: string | null;
}

/** Bản ghi công tác có hiệu lực tại ngày `date` (báo cáo lịch sử dùng đúng đơn vị lúc đó). */
export async function employmentAt(
  db: Queryable,
  companyId: string,
  employeeId: string,
  date: string,
): Promise<EmploymentAt | null> {
  const { rows } = await db.query<{
    department_id: string;
    title: string | null;
    manager_employee_id: string | null;
    valid_from: string;
    valid_to: string | null;
  }>(
    `SELECT department_id, title, manager_employee_id, valid_from, valid_to FROM employment_history
     WHERE company_id = $1 AND employee_id = $2 AND valid_from <= $3::date AND (valid_to IS NULL OR valid_to > $3::date)`,
    [companyId, employeeId, date],
  );
  const r = rows[0];
  return r
    ? {
        departmentId: r.department_id,
        title: r.title,
        managerEmployeeId: r.manager_employee_id,
        validFrom: r.valid_from,
        validTo: r.valid_to,
      }
    : null;
}
