// Dữ liệu bổ sung cho đo tải cục bộ (scripts/perf-load.mjs; KHÔNG dùng cho production): chạy SAU seed-e2e.ts.
// `/attendance/events` giới hạn 60 lượt/phút mỗi người dùng (AUD-XFEAT-004) — kịch bản ghi chấm công trải tải ra nhiều
// nhân viên để đo đường ghi thật, không đo đường 429. Mật khẩu chép băm của `nv` (cùng PASSWORD của seed-e2e).
import { readFileSync } from "node:fs";
import pg from "pg";
import { setPool, withTx } from "../lib/db/index.ts";
import { grantRole } from "../lib/authz/grants.ts";
import { SYSTEM_ACTOR } from "../lib/authz/index.ts";
import { assignEmployment, createEmployee } from "../lib/org/index.ts";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu (dùng chung với perf-load.mjs)
import { PERF_ATTENDANCE_USERS, perfAttendanceEmail } from "./lib/perf-users.mjs";

interface SeedFile {
  companyId: string;
  users: Record<string, { userId: string; employeeId: string }>;
}
const seed = JSON.parse(readFileSync("e2e/.seed.json", "utf8")) as SeedFile;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
setPool(pool);
const sys = SYSTEM_ACTOR; // actor hệ thống tường minh (AUD-SEC-005)

await withTx(async (tx) => {
  const nv = seed.users.nv!;
  const src = await tx.query<{ password_hash: string; department_id: string }>(
    `SELECT u.password_hash, h.department_id FROM app_user u
       JOIN employment_history h ON h.employee_id = u.employee_id
      WHERE u.id = $1 ORDER BY h.valid_from DESC LIMIT 1`,
    [nv.userId],
  );
  const { password_hash: hash, department_id: departmentId } = src.rows[0]!;
  for (let i = 0; i < PERF_ATTENDANCE_USERS; i++) {
    const employeeId = await createEmployee(tx, sys, seed.companyId, {
      code: `PERF${String(i).padStart(3, "0")}`,
      fullName: `Nhân viên tải ${i}`,
    });
    await assignEmployment(tx, sys, seed.companyId, employeeId, { departmentId, validFrom: "2026-01-01" });
    const { rows } = await tx.query<{ id: string }>(
      "INSERT INTO app_user (email, display_name, password_hash, company_id, employee_id) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [perfAttendanceEmail(i), `Nhân viên tải ${i}`, hash, seed.companyId, employeeId],
    );
    await grantRole(tx, sys, seed.companyId, { userId: rows[0]!.id, role: "employee", scopeType: "self" });
  }
});
await pool.end();
console.log(`seed-perf: ${PERF_ATTENDANCE_USERS} nhân viên cho kịch bản ghi chấm công`);
