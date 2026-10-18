// Dữ liệu E2E (KHÔNG dùng cho production): mỗi project Playwright một công ty riêng (desktop = công ty của website,
// mobile = bản sao dữ liệu nghiệp vụ) để luồng chính chạy trên cả hai mà không giành trạng thái (UX-RESP-008, FE-TEST-002).
// Mỗi công ty: người dùng theo vai trò, ca hôm nay, dự án + việc; nội dung website chỉ ở công ty desktop.
// Ghi thông tin đăng nhập ra e2e/.seed.json (gitignore).
import { writeFileSync } from "node:fs";
import pg from "pg";
import { setPool, withTx } from "../lib/db/index.ts";
import {
  assignEmployment,
  createBranch,
  createCompany,
  createDepartment,
  createEmployee,
} from "../lib/org/index.ts";
import { grantRole } from "../lib/authz/grants.ts";
import { hashPassword } from "../lib/identity/password.ts";
import { approve, createPage, publish, submitForReview } from "../lib/cms/index.ts";
import { loadActor } from "../lib/authz/load.ts";
import { addMember, createProject, createTask } from "../lib/work/tasks.ts";
import { localDate } from "../lib/nen/time.ts";
import type { Role, ScopeType } from "../lib/authz/index.ts";

const PASSWORD = "E2e-mat-khau-dai-2026!";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
setPool(pool);
const sys = { userId: null };

type Users = Record<string, { email: string; userId: string; employeeId: string }>;

async function seedCompany(tx: pg.PoolClient, companyName: string, emailSuffix: string, withSite: boolean) {
  const companyId = await createCompany(tx, sys, { name: companyName });
  const branchId = await createBranch(tx, sys, companyId, { code: "HN", name: "Hà Nội" });
  const deptId = await createDepartment(tx, sys, companyId, { code: "KT", name: "Kỹ thuật", branchId });
  const hash = await hashPassword(PASSWORD);
  const users: Users = {};
  const mk = async (
    key: string,
    name: string,
    grants: { role: Role; scopeType: ScopeType; scopeId?: string }[],
  ) => {
    const employeeId = await createEmployee(tx, sys, companyId, { code: key.toUpperCase(), fullName: name });
    await assignEmployment(tx, sys, companyId, employeeId, { departmentId: deptId, validFrom: "2026-01-01" });
    const email = `${key}${emailSuffix}@e2e.test`;
    const { rows } = await tx.query<{ id: string }>(
      "INSERT INTO app_user (email, display_name, password_hash, company_id, employee_id) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [email, name, hash, companyId, employeeId],
    );
    for (const g of grants)
      await grantRole(tx, sys, companyId, {
        userId: rows[0]!.id,
        role: g.role,
        scopeType: g.scopeType,
        scopeId: g.scopeId ?? null,
      });
    users[key] = { email, userId: rows[0]!.id, employeeId };
  };
  await mk("nv", "Nguyễn Văn Nhân", [{ role: "employee", scopeType: "self" }]);
  await mk("nv2", "Lê Thị Hai", [{ role: "employee", scopeType: "self" }]);
  await mk("tl", "Trần Trưởng Nhóm", [{ role: "team_lead", scopeType: "department", scopeId: deptId }]);
  await mk("ed", "Phạm Biên Tập", [{ role: "editor", scopeType: "company" }]);
  await mk("ed2", "Hoàng Duyệt Bài", [{ role: "editor", scopeType: "company" }]);
  await mk("sales", "Đỗ Kinh Doanh", [{ role: "sales", scopeType: "company" }]);
  await mk("hr", "Ngô Nhân Sự", [{ role: "hr", scopeType: "company" }]);
  await mk("exec", "Vũ Giám Đốc", [{ role: "executive", scopeType: "company" }]);
  if (withSite) {
    const ed = { userId: users.ed!.userId, companyId };
    const ed2 = { userId: users.ed2!.userId, companyId };
    const pub = async (
      type: Parameters<typeof createPage>[2]["type"],
      slug: string,
      title: string,
      body: string,
    ) => {
      const r = await createPage(
        tx,
        ed,
        { type, slug },
        { title, bodyMarkdown: body, summary: `Tóm tắt: ${title}` },
      );
      await submitForReview(tx, ed, r.id);
      await approve(tx, ed2, r.id);
      await publish(tx, ed2, r.id);
    };
    await pub(
      "home",
      "",
      "Giải pháp cơ điện cho công trình của bạn",
      "Chúng tôi **thiết kế, thi công và bảo trì** hệ thống cơ điện.",
    );
    await pub("about", "", "Giới thiệu X-Company", "Thành lập năm 2010.");
    await pub("service", "tu-van-thiet-ke", "Tư vấn thiết kế", "Khảo sát, thiết kế, dự toán.");
    await pub("page", "chinh-sach-du-lieu", "Chính sách dữ liệu cá nhân", "Mục đích, căn cứ, thời hạn lưu.");
    await createPage(
      tx,
      ed,
      { type: "service", slug: "dich-vu-nhap" },
      { title: "Bản nháp chưa duyệt", bodyMarkdown: "bí mật" },
    );
  }
  await tx.query(
    "INSERT INTO inquiry_route (company_id, service_slug, assignee_user_id) VALUES ($1, NULL, $2)",
    [companyId, users.sales!.userId],
  );
  await tx.query(
    "INSERT INTO leave_type (company_id, code, name, requires_balance) VALUES ($1, 'KL', 'Nghỉ không lương', false)",
    [companyId],
  );
  const tpl = await tx.query<{ id: string }>(
    "INSERT INTO shift_template (company_id, code, name, start_time, end_time, break_minutes) VALUES ($1, 'NGAY', 'Ca ngày', '00:05', '23:55', 0) RETURNING id",
    [companyId],
  );
  for (const k of ["nv", "nv2"])
    await tx.query(
      "INSERT INTO shift_assignment (company_id, employee_id, business_date, shift_template_id) VALUES ($1, $2, $3, $4)",
      [companyId, users[k]!.employeeId, localDate(new Date()), tpl.rows[0]!.id],
    );
  const exec = (await loadActor(tx, users.exec!.userId))!;
  const projectId = await createProject(tx, exec, {
    code: "DA-E2E",
    name: "Dự án E2E",
    managerEmployeeId: users.exec!.employeeId,
  });
  const execAsPm = (await loadActor(tx, users.exec!.userId))!;
  await addMember(tx, execAsPm, projectId, users.nv!.employeeId);
  await addMember(tx, execAsPm, projectId, users.tl!.employeeId);
  await createTask(tx, execAsPm, {
    projectId,
    title: "Lắp đặt tủ điện tầng 3",
    responsibleEmployeeId: users.nv!.employeeId,
    reviewerEmployeeId: users.tl!.employeeId,
    acceptanceCriteria: "Biên bản đo cách điện",
  });
  return { companyId, users };
}

const out = await withTx(async (tx) => {
  const desktop = await seedCompany(tx, "X-Company (E2E)", "", true);
  const mobile = await seedCompany(tx, "X-Company (E2E mobile)", ".m", false);
  return { companyId: desktop.companyId, password: PASSWORD, users: desktop.users, mobile };
});
writeFileSync("e2e/.seed.json", JSON.stringify(out, null, 2));
await pool.end();
console.log(`Seed E2E xong: công ty ${out.companyId}`);
