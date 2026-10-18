import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { withTx } from "../../lib/db/index.ts";
import { can } from "../../lib/authz/index.ts";
import { loadActor } from "../../lib/authz/load.ts";
import { grantRole, revokeGrant } from "../../lib/authz/grants.ts";
import { createBranch, createCompany, createDepartment, createEmployee } from "../../lib/org/index.ts";
import { AppError } from "../../lib/nen/app-error.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";

const sys = { userId: null };
const isCode = (code: string) => (e: unknown) => e instanceof AppError && e.code === code;

describe("loadActor + grant/revoke trên DB", () => {
  let db: TestDb;
  let c1: string,
    c2: string,
    b1: string,
    d1: string,
    d1a: string,
    d2: string,
    dOther: string,
    emp: string,
    user: string;

  before(async () => {
    db = await freshDb();
    await withTx(async (tx) => {
      c1 = await createCompany(tx, sys, { name: "A" });
      c2 = await createCompany(tx, sys, { name: "B" });
      b1 = await createBranch(tx, sys, c1, { code: "HN", name: "HN" });
      const b2 = await createBranch(tx, sys, c2, { code: "HN", name: "HN" });
      d1 = await createDepartment(tx, sys, c1, { code: "D1", name: "D1", branchId: b1 });
      d1a = await createDepartment(tx, sys, c1, { code: "D1A", name: "D1A", branchId: b1, parentId: d1 });
      d2 = await createDepartment(tx, sys, c1, { code: "D2", name: "D2", branchId: b1 });
      dOther = await createDepartment(tx, sys, c2, { code: "D1", name: "D1", branchId: b2 });
      emp = await createEmployee(tx, sys, c1, { code: "TL1", fullName: "Trưởng nhóm" });
      const { rows } = await tx.query(
        "INSERT INTO app_user (email, display_name, company_id, employee_id) VALUES ('tl@a.vn', 'TL', $1, $2) RETURNING id",
        [c1, emp],
      );
      user = rows[0].id;
    });
  });
  after(async () => {
    await db.close();
  });

  test("grant phạm vi phòng ban mở rộng cả cây con (R3)", async () => {
    await withTx((tx) =>
      grantRole(tx, sys, c1, { userId: user, role: "team_lead", scopeType: "department", scopeId: d1 }),
    );
    const a = await loadActor(db.app, user);
    assert.ok(a);
    assert.equal(a.employeeId, emp);
    assert.deepEqual(new Set(a.grants[0]?.departmentIds), new Set([d1, d1a]));
    assert.equal(can(a, "attendance.read", { companyId: c1, departmentId: d1a }), true);
    assert.equal(can(a, "attendance.read", { companyId: c1, departmentId: d2 }), false);
  });

  test("phạm vi phải thuộc công ty; mã phạm vi phải khớp loại", async () => {
    await assert.rejects(
      withTx((tx) =>
        grantRole(tx, sys, c1, { userId: user, role: "hr", scopeType: "department", scopeId: dOther }),
      ),
      isCode("INVALID_SCOPE"),
    );
    await assert.rejects(
      withTx((tx) => grantRole(tx, sys, c1, { userId: user, role: "hr", scopeType: "company", scopeId: d1 })),
      isCode("INVALID_SCOPE"),
    );
    await assert.rejects(
      withTx((tx) => grantRole(tx, sys, c1, { userId: user, role: "hr", scopeType: "branch" })),
      isCode("INVALID_SCOPE"),
    );
    await assert.rejects(
      withTx((tx) => grantRole(tx, sys, c1, { userId: user, role: "boss" as never, scopeType: "company" })),
      isCode("INVALID_ROLE"),
    );
    await assert.rejects(
      withTx((tx) => grantRole(tx, sys, c2, { userId: user, role: "hr", scopeType: "company" })),
      isCode("NOT_FOUND"),
    );
  });

  test("grant hết hạn hoặc chưa tới hạn không có hiệu lực", async () => {
    const past = new Date(Date.now() - 86_400_000 * 2);
    await withTx((tx) =>
      grantRole(tx, sys, c1, {
        userId: user,
        role: "hr",
        scopeType: "company",
        validFrom: past,
        validTo: new Date(Date.now() - 86_400_000),
      }),
    );
    await withTx((tx) =>
      grantRole(tx, sys, c1, {
        userId: user,
        role: "executive",
        scopeType: "branch",
        scopeId: b1,
        validFrom: new Date(Date.now() + 86_400_000),
      }),
    );
    const a = await loadActor(db.app, user);
    assert.deepEqual(
      a?.grants.map((x) => x.role),
      ["team_lead"],
    );
  });

  test("thu hồi grant: tăng auth_version, lần nạp sau không còn quyền; vô hiệu tài khoản → null", async () => {
    const before = await db.app.query("SELECT auth_version FROM app_user WHERE id = $1", [user]);
    const gid = await withTx((tx) =>
      grantRole(tx, sys, c1, { userId: user, role: "hr", scopeType: "company" }),
    );
    assert.equal(can(await loadActor(db.app, user), "period.manage", { companyId: c1 }), true);
    await withTx((tx) => revokeGrant(tx, sys, c1, gid, "chuyển công tác"));
    assert.equal(can(await loadActor(db.app, user), "period.manage", { companyId: c1 }), false);
    const after = await db.app.query("SELECT auth_version FROM app_user WHERE id = $1", [user]);
    assert.equal(after.rows[0].auth_version, before.rows[0].auth_version + 2);
    await assert.rejects(
      withTx((tx) => revokeGrant(tx, sys, c1, gid, "lần 2")),
      isCode("NOT_FOUND"),
    );
    const audit = await db.admin.query("SELECT reason FROM audit_event WHERE action = 'grant.revoke'");
    assert.equal(audit.rows[0].reason, "chuyển công tác");

    await db.admin.query("UPDATE app_user SET disabled_at = now() WHERE id = $1", [user]);
    assert.equal(await loadActor(db.app, user), null);
  });
});
