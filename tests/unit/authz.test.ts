import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { can, isSelfApproval, PERMISSIONS, type ActorContext, type Grant } from "../../lib/authz/index.ts";

const C1 = "c1";
const C2 = "c2";

function actor(grants: Grant[], employeeId: string | null = "e-self"): ActorContext {
  return { userId: "u-self", companyId: C1, employeeId, grants };
}
const g = (
  role: Grant["role"],
  scopeType: Grant["scopeType"],
  scopeId: string | null = null,
  extra: Partial<Grant> = {},
): Grant => ({
  role,
  companyId: C1,
  scopeType,
  scopeId,
  ...extra,
});

describe("can() — mặc định từ chối (R1, R2)", () => {
  test("không actor → từ chối mọi quyền", () => {
    for (const a of Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]) {
      assert.equal(can(null, a, { companyId: C1 }), false, a);
    }
  });
  test("actor không grant nào → chỉ quyền self của chính mình", () => {
    const a = actor([]);
    assert.equal(can(a, "attendance.read", { companyId: C1, ownerEmployeeId: "e-self" }), true);
    assert.equal(can(a, "attendance.read", { companyId: C1, ownerEmployeeId: "e-other" }), false);
    assert.equal(can(a, "org.read", { companyId: C1 }), false);
    assert.equal(can(actor([], null), "attendance.read", { companyId: C1, ownerEmployeeId: null }), false);
  });
});

describe("kịch bản SPEC-identity-org", () => {
  test("S-ID-01: nhân viên đọc công của người khác → từ chối", () => {
    const a = actor([g("employee", "self")]);
    assert.equal(
      can(a, "attendance.read", { companyId: C1, ownerEmployeeId: "e-B", departmentId: "d1" }),
      false,
    );
  });

  test("S-ID-02: trưởng nhóm phạm vi D1 (cây gồm D1a) đọc được D1a, không đọc D2", () => {
    const a = actor([g("team_lead", "department", "d1", { departmentIds: ["d1", "d1a"] })]);
    assert.equal(
      can(a, "attendance.read", { companyId: C1, departmentId: "d1a", ownerEmployeeId: "e-x" }),
      true,
    );
    assert.equal(can(a, "attendance.approve", { companyId: C1, departmentId: "d1a" }), true);
    assert.equal(
      can(a, "attendance.read", { companyId: C1, departmentId: "d2", ownerEmployeeId: "e-y" }),
      false,
    );
    // Grant department chưa mở rộng cây: chỉ đúng phòng ban đó.
    const b = actor([g("team_lead", "department", "d1")]);
    assert.equal(can(b, "attendance.read", { companyId: C1, departmentId: "d1" }), true);
    assert.equal(can(b, "attendance.read", { companyId: C1, departmentId: "d1a" }), false);
  });

  test("S-ID-03 (R4): PM của dự án không đọc hồ sơ HR/công của thành viên", () => {
    const a = actor([g("project_manager", "project", "p1")]);
    const member = { companyId: C1, projectId: "p1", ownerEmployeeId: "e-m", departmentId: "d1" };
    assert.equal(can(a, "employee.read_profile", member), false);
    assert.equal(can(a, "attendance.read", member), false);
    assert.equal(can(a, "project.manage", { companyId: C1, projectId: "p1" }), true);
    assert.equal(can(a, "project.manage", { companyId: C1, projectId: "p2" }), false);
  });

  test("S-ID-04 (R5): tự duyệt bị phát hiện theo user hoặc nhân viên", () => {
    const a = actor([g("hr", "company")]);
    assert.equal(isSelfApproval(a, { userId: "u-self" }), true);
    assert.equal(isSelfApproval(a, { employeeId: "e-self" }), true);
    assert.equal(isSelfApproval(a, { userId: "u-x", employeeId: "e-x" }), false);
    assert.equal(isSelfApproval(actor([], null), { employeeId: null }), false);
  });

  test("S-ID-06 (R7): grant công ty C1 không áp cho tài nguyên C2 dù trùng id", () => {
    const a = actor([g("hr", "company"), g("team_lead", "department", "d1", { departmentIds: ["d1"] })]);
    assert.equal(
      can(a, "attendance.read", { companyId: C2, departmentId: "d1", ownerEmployeeId: "e-self" }),
      false,
    );
    const foreign: ActorContext = { ...a, grants: [{ ...g("hr", "company"), companyId: C2 }] };
    assert.equal(can(foreign, "period.manage", { companyId: C1 }), false);
  });

  test("R6: export nhạy cảm chỉ vai trò sensitive_exporter, HR/lãnh đạo không tự có", () => {
    assert.equal(
      can(actor([g("hr", "company"), g("executive", "company")]), "export.sensitive", { companyId: C1 }),
      false,
    );
    assert.equal(
      can(actor([g("sensitive_exporter", "company")]), "export.sensitive", { companyId: C1 }),
      true,
    );
  });

  test("phạm vi branch và self", () => {
    const a = actor([g("hr", "branch", "b1"), g("employee", "self")]);
    assert.equal(can(a, "period.manage", { companyId: C1, branchId: "b1" }), true);
    assert.equal(can(a, "period.manage", { companyId: C1, branchId: "b2" }), false);
    assert.equal(
      can(a, "period.manage", { companyId: C1 }),
      false,
      "tài nguyên không có branch → không khớp phạm vi branch",
    );
    assert.equal(
      can(actor([g("project_manager", "self")]), "project.manage", {
        companyId: C1,
        ownerEmployeeId: "e-self",
      }),
      true,
    );
    assert.equal(
      can(actor([g("team_lead", "project", "p1")]), "attendance.read", { companyId: C1, projectId: "p1" }),
      true,
    );
  });

  test("sales không đọc hồ sơ ứng viên; HR đọc được (S-WEB-05)", () => {
    assert.equal(can(actor([g("sales", "company")]), "application.read", { companyId: C1 }), false);
    assert.equal(can(actor([g("hr", "company")]), "application.read", { companyId: C1 }), true);
  });
});
