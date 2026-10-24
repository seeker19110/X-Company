import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { withTx } from "../../lib/db/index.ts";
import { can, SYSTEM_ACTOR } from "../../lib/authz/index.ts";
import { loadActor } from "../../lib/authz/load.ts";
import { grantRole, revokeGrant } from "../../lib/authz/grants.ts";
import { createBranch, createCompany, createDepartment, createEmployee } from "../../lib/org/index.ts";
import { AppError } from "../../lib/nen/app-error.ts";
import { disableUser } from "../../lib/identity/auth.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";

const sys = SYSTEM_ACTOR; // actor hệ thống tường minh (AUD-SEC-005)
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
        "INSERT INTO app_user (email, display_name, company_id, employee_id) VALUES ('tl@example.test', 'TL', $1, $2) RETURNING id",
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

  test("AUD-SEC-005: grantRole/revokeGrant tự kiểm access.manage ở server", async () => {
    const mkUser = (email: string) =>
      withTx(async (tx) => {
        const { rows } = await tx.query(
          "INSERT INTO app_user (email, display_name, company_id) VALUES ($1, 'U', $2) RETURNING id",
          [email, c1],
        );
        return rows[0].id as string;
      });
    const admin = await mkUser("sec5-admin@example.test");
    const plain = await mkUser("sec5-plain@example.test");
    const target = await mkUser("sec5-target@example.test");
    await withTx((tx) => grantRole(tx, sys, c1, { userId: admin, role: "sysadmin", scopeType: "company" }));
    await withTx((tx) => grantRole(tx, sys, c1, { userId: plain, role: "hr", scopeType: "company" }));
    const adminActor = (await loadActor(db.app, admin))!;
    const plainActor = (await loadActor(db.app, plain))!;
    const forbidden = (e: unknown) =>
      e instanceof AppError &&
      e.code === "FORBIDDEN" &&
      e.status === 403 &&
      e.details?.action === "access.manage";
    const grantCount = async () =>
      (await db.admin.query("SELECT count(*)::int AS n FROM role_grant WHERE user_id = $1", [target])).rows[0]
        .n;

    // Bị từ chối: actor thường (hr, không có access.manage) — cả khi tự nâng quyền cho chính mình.
    await assert.rejects(
      withTx((tx) =>
        grantRole(tx, plainActor, c1, { userId: target, role: "sysadmin", scopeType: "company" }),
      ),
      forbidden,
    );
    await assert.rejects(
      withTx((tx) =>
        grantRole(tx, plainActor, c1, { userId: plain, role: "sysadmin", scopeType: "company" }),
      ),
      forbidden,
    );
    // Bị từ chối: `{ userId: null }` không tường minh không phải cửa sau.
    await assert.rejects(
      withTx((tx) =>
        grantRole(tx, { userId: null } as never, c1, { userId: target, role: "hr", scopeType: "company" }),
      ),
      forbidden,
    );
    // Bị từ chối: sysadmin công ty khác (R7) cấp vào c1.
    await assert.rejects(
      withTx((tx) =>
        grantRole(
          tx,
          { ...adminActor, companyId: c2, grants: adminActor.grants.map((g) => ({ ...g, companyId: c2 })) },
          c1,
          {
            userId: target,
            role: "hr",
            scopeType: "company",
          },
        ),
      ),
      forbidden,
    );
    // Bản sao của SYSTEM_ACTOR (spread chép cả khoá symbol) cũng không qua — chỉ đúng hằng.
    await assert.rejects(
      withTx((tx) =>
        grantRole(tx, { ...SYSTEM_ACTOR } as never, c1, { userId: target, role: "hr", scopeType: "company" }),
      ),
      forbidden,
    );
    assert.equal(await grantCount(), 0, "không ghi gì khi bị từ chối");
    // Được phép: actor hệ thống tường minh; granted_by/audit không có người.
    const sysGid = await withTx((tx) =>
      grantRole(tx, SYSTEM_ACTOR, c1, { userId: target, role: "employee", scopeType: "self" }),
    );
    const sysRow = (await db.admin.query("SELECT granted_by FROM role_grant WHERE id = $1", [sysGid]))
      .rows[0];
    assert.equal(sysRow.granted_by, null);

    // Được phép: actor có access.manage; người cấp ghi vào granted_by và audit.
    const gid = await withTx((tx) =>
      grantRole(tx, adminActor, c1, { userId: target, role: "hr", scopeType: "company" }),
    );
    const row = (await db.admin.query("SELECT granted_by FROM role_grant WHERE id = $1", [gid])).rows[0];
    assert.equal(row.granted_by, admin);

    // Thu hồi: actor thường và `{ userId: null }` bị từ chối; grant vẫn còn hiệu lực.
    await assert.rejects(
      withTx((tx) => revokeGrant(tx, plainActor, c1, gid, "thử")),
      forbidden,
    );
    await assert.rejects(
      withTx((tx) => revokeGrant(tx, { userId: null } as never, c1, gid, "thử")),
      forbidden,
    );
    const live = await db.admin.query("SELECT revoked_at FROM role_grant WHERE id = $1", [gid]);
    assert.equal(live.rows[0].revoked_at, null);
    // Đồng thời: hai lần thu hồi song song cùng grant → đúng một thành công, lần kia NOT_FOUND.
    const both = await Promise.allSettled([
      withTx((tx) => revokeGrant(tx, adminActor, c1, gid, "hết nhiệm vụ")),
      withTx((tx) => revokeGrant(tx, adminActor, c1, gid, "hết nhiệm vụ")),
    ]);
    assert.equal(both.filter((x) => x.status === "fulfilled").length, 1);
    assert.ok(
      isCode("NOT_FOUND")((both.find((x) => x.status === "rejected") as PromiseRejectedResult).reason),
    );
    const audit = await db.admin.query(
      "SELECT actor_user_id FROM audit_event WHERE action = 'grant.revoke' AND object_id = $1",
      [gid],
    );
    assert.equal(audit.rows[0].actor_user_id, admin);
  });

  test("AUD-SEC-005: grant phạm vi project — dự án phải tồn tại và thuộc công ty", async () => {
    const [p1, pOther] = await withTx(async (tx) => {
      const e2 = await createEmployee(tx, sys, c2, { code: "PM2", fullName: "PM khác" });
      const a = await tx.query(
        "INSERT INTO project (company_id, code, name, manager_employee_id) VALUES ($1, 'P1', 'Dự án 1', $2) RETURNING id",
        [c1, emp],
      );
      const b = await tx.query(
        "INSERT INTO project (company_id, code, name, manager_employee_id) VALUES ($1, 'P1', 'Dự án khác', $2) RETURNING id",
        [c2, e2],
      );
      return [a.rows[0].id as string, b.rows[0].id as string];
    });
    for (const scopeId of [pOther, "00000000-0000-4000-8000-000000000000"])
      await assert.rejects(
        withTx((tx) =>
          grantRole(tx, sys, c1, { userId: user, role: "project_manager", scopeType: "project", scopeId }),
        ),
        isCode("INVALID_SCOPE"),
        scopeId,
      );
    await withTx((tx) =>
      grantRole(tx, sys, c1, { userId: user, role: "project_manager", scopeType: "project", scopeId: p1 }),
    );
    const a = await loadActor(db.app, user);
    assert.equal(can(a, "project.manage", { companyId: c1, projectId: p1 }), true);
    assert.equal(can(a, "project.manage", { companyId: c1, projectId: pOther }), false);
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
    const audit = await db.admin.query(
      "SELECT reason FROM audit_event WHERE action = 'grant.revoke' AND object_id = $1",
      [gid],
    );
    assert.equal(audit.rows[0].reason, "chuyển công tác");

    await db.admin.query("UPDATE app_user SET disabled_at = now() WHERE id = $1", [user]);
    assert.equal(await loadActor(db.app, user), null);
  });

  test("AUD-SEC-007: không thu hồi được grant sysadmin hiệu lực cuối cùng của công ty (409, chống đua)", async () => {
    const c3 = await withTx((tx) => createCompany(tx, sys, { name: "C3" }));
    const mkUser = (email: string) =>
      withTx(async (tx) => {
        const { rows } = await tx.query(
          "INSERT INTO app_user (email, display_name, company_id) VALUES ($1, 'U', $2) RETURNING id",
          [email, c3],
        );
        return rows[0].id as string;
      });
    const a = await mkUser("sec7-a@example.test");
    const b = await mkUser("sec7-b@example.test");
    const ga = await withTx((tx) =>
      grantRole(tx, sys, c3, { userId: a, role: "sysadmin", scopeType: "company" }),
    );
    // Grant hết hạn, chưa tới hạn và của tài khoản bị vô hiệu không tính là "còn sysadmin khác".
    await withTx((tx) =>
      grantRole(tx, sys, c3, {
        userId: b,
        role: "sysadmin",
        scopeType: "company",
        validFrom: new Date(Date.now() + 86_400_000),
      }),
    );
    const disabled = await mkUser("sec7-disabled@example.test");
    await withTx((tx) =>
      grantRole(tx, sys, c3, { userId: disabled, role: "sysadmin", scopeType: "company" }),
    );
    await db.admin.query("UPDATE app_user SET disabled_at = now() WHERE id = $1", [disabled]);
    const last = (e: unknown) => e instanceof AppError && e.code === "LAST_SYSADMIN" && e.status === 409;
    await assert.rejects(
      withTx((tx) => revokeGrant(tx, sys, c3, ga, "thử")),
      last,
    );
    const live = await db.admin.query("SELECT revoked_at FROM role_grant WHERE id = $1", [ga]);
    assert.equal(live.rows[0].revoked_at, null, "grant còn nguyên khi bị từ chối");

    // Có sysadmin thứ hai đang hiệu lực: hai lần thu hồi SONG SONG hai grant → đúng một thành công, còn lại 409.
    const gb = await withTx((tx) =>
      grantRole(tx, sys, c3, { userId: b, role: "sysadmin", scopeType: "company" }),
    );
    const both = await Promise.allSettled([
      withTx((tx) => revokeGrant(tx, sys, c3, ga, "đua")),
      withTx((tx) => revokeGrant(tx, sys, c3, gb, "đua")),
    ]);
    assert.equal(both.filter((x) => x.status === "fulfilled").length, 1);
    assert.ok(last((both.find((x) => x.status === "rejected") as PromiseRejectedResult).reason));
    const n = await db.admin.query(
      `SELECT count(*)::int AS n FROM role_grant
       WHERE company_id = $1 AND role = 'sysadmin' AND revoked_at IS NULL AND valid_from <= now()`,
      [c3],
    );
    assert.equal(n.rows[0].n, 2, "một sysadmin hiệu lực + grant của tài khoản bị vô hiệu");

    // Grant không phải sysadmin, hoặc sysadmin chưa tới hạn, thu hồi bình thường.
    const gh = await withTx((tx) => grantRole(tx, sys, c3, { userId: a, role: "hr", scopeType: "company" }));
    await withTx((tx) => revokeGrant(tx, sys, c3, gh, "xong"));
  });

  test("AUD-SEC-007/010 (review PR #73): chỉ sysadmin phạm vi công ty được tính; vô hiệu sysadmin cuối → 409", async () => {
    const c4 = await withTx((tx) => createCompany(tx, sys, { name: "C4" }));
    const b4 = await withTx((tx) => createBranch(tx, sys, c4, { code: "B4", name: "B4" }));
    const mk = (email: string) =>
      withTx(async (tx) => {
        const { rows } = await tx.query(
          "INSERT INTO app_user (email, display_name, company_id) VALUES ($1, 'U', $2) RETURNING id",
          [email, c4],
        );
        return rows[0].id as string;
      });
    const a = await mk("sec10-a@example.test");
    const b = await mk("sec10-b@example.test");
    const ga = await withTx((tx) =>
      grantRole(tx, sys, c4, { userId: a, role: "sysadmin", scopeType: "company" }),
    );
    // Sysadmin phạm vi chi nhánh KHÔNG có access.manage cấp công ty → không tính là "còn người khác".
    await withTx((tx) =>
      grantRole(tx, sys, c4, { userId: b, role: "sysadmin", scopeType: "branch", scopeId: b4 }),
    );
    const last = (e: unknown) => e instanceof AppError && e.code === "LAST_SYSADMIN" && e.status === 409;
    await assert.rejects(
      withTx((tx) => revokeGrant(tx, sys, c4, ga, "thử")),
      last,
    );
    await assert.rejects(
      withTx((tx) => disableUser(tx, null, a, "nghỉ việc")),
      last,
    );
    const live = await db.admin.query("SELECT disabled_at FROM app_user WHERE id = $1", [a]);
    assert.equal(live.rows[0].disabled_at, null, "tài khoản còn hoạt động khi bị từ chối");
    // Có sysadmin công ty thứ hai: vô hiệu được người đầu; khi đó người thứ hai thành người cuối.
    await withTx((tx) => grantRole(tx, sys, c4, { userId: b, role: "sysadmin", scopeType: "company" }));
    await withTx((tx) => disableUser(tx, null, a, "nghỉ việc"));
    await assert.rejects(
      withTx((tx) => disableUser(tx, null, b, "nghỉ việc")),
      last,
    );
    // Người không phải sysadmin vô hiệu bình thường.
    const c = await mk("sec10-c@example.test");
    await withTx((tx) => disableUser(tx, null, c, "nghỉ việc"));
  });
});
