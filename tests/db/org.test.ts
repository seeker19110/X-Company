import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { withTx } from "../../lib/db/index.ts";
import {
  assignEmployment,
  createBranch,
  createCompany,
  createDepartment,
  createEmployee,
  createWorksite,
  departmentSubtree,
  employmentAt,
  moveDepartment,
} from "../../lib/org/index.ts";
import { verifyAuditChain } from "../../lib/audit/index.ts";
import { AppError } from "../../lib/nen/app-error.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";

const actor = { userId: null, requestId: "t" };

function isCode(code: string) {
  return (e: unknown) => e instanceof AppError && e.code === code;
}

describe("tổ chức (F-001)", () => {
  let db: TestDb;
  let c1: string, c2: string, b1: string, b2: string, d1: string, d1a: string, d1a1: string, d2: string;

  before(async () => {
    db = await freshDb();
    await withTx(async (tx) => {
      c1 = await createCompany(tx, actor, { name: "Công ty A" });
      c2 = await createCompany(tx, actor, { name: "Công ty B" });
      b1 = await createBranch(tx, actor, c1, { code: "HN", name: "Hà Nội" });
      b2 = await createBranch(tx, actor, c2, { code: "HCM", name: "TP HCM" });
      d1 = await createDepartment(tx, actor, c1, { code: "KT", name: "Kỹ thuật", branchId: b1 });
      d1a = await createDepartment(tx, actor, c1, {
        code: "KT-PM",
        name: "Phần mềm",
        branchId: b1,
        parentId: d1,
      });
      d1a1 = await createDepartment(tx, actor, c1, {
        code: "KT-PM-W",
        name: "Web",
        branchId: b1,
        parentId: d1a,
      });
      d2 = await createDepartment(tx, actor, c1, { code: "HC", name: "Hành chính", branchId: b1 });
    });
  });
  after(async () => {
    await db.close();
  });

  test("cây phòng ban: subtree gồm con cháu, không gồm nhánh khác", async () => {
    const sub = await departmentSubtree(db.app, c1, d1);
    assert.deepEqual(new Set(sub), new Set([d1, d1a, d1a1]));
    assert.deepEqual(await departmentSubtree(db.app, c1, d2), [d2]);
    assert.deepEqual(await departmentSubtree(db.app, c2, d1), [], "khác công ty → rỗng");
  });

  test("chặn chu trình khi dời phòng ban vào con cháu của nó", async () => {
    await assert.rejects(
      withTx((tx) => moveDepartment(tx, actor, c1, d1, d1a1)),
      (e: unknown) => e instanceof AppError && e.code === "CONSTRAINT" && /chu trình/.test(e.message),
    );
    await assert.rejects(
      withTx((tx) => moveDepartment(tx, actor, c1, d1, d1)),
      isCode("CONSTRAINT"),
    );
    await withTx((tx) => moveDepartment(tx, actor, c1, d2, d1));
    assert.ok((await departmentSubtree(db.app, c1, d1)).includes(d2));
    await assert.rejects(
      withTx((tx) => moveDepartment(tx, actor, c1, "00000000-0000-4000-8000-000000000000", null)),
      isCode("NOT_FOUND"),
    );
  });

  test("không tham chiếu chéo công ty (R7): phòng ban C1 dưới chi nhánh C2 bị từ chối", async () => {
    await assert.rejects(
      withTx((tx) => createDepartment(tx, actor, c1, { code: "X", name: "X", branchId: b2 })),
      isCode("INVALID_REFERENCE"),
    );
    await assert.rejects(
      withTx((tx) => createDepartment(tx, actor, c2, { code: "Y", name: "Y", branchId: b2, parentId: d1 })),
      isCode("INVALID_REFERENCE"),
    );
  });

  test("mã trùng trong công ty → DUPLICATE; khác công ty thì được", async () => {
    await assert.rejects(
      withTx((tx) => createBranch(tx, actor, c1, { code: "HN", name: "Trùng" })),
      isCode("DUPLICATE"),
    );
    await withTx((tx) => createBranch(tx, actor, c2, { code: "HN", name: "HN của B" }));
  });

  test("địa điểm: toạ độ phải đủ cặp và hợp lệ", async () => {
    const w = await withTx((tx) =>
      createWorksite(tx, actor, c1, {
        code: "CT1",
        name: "Công trường 1",
        lat: 21.03,
        lng: 105.85,
        radiusM: 200,
      }),
    );
    assert.ok(w.length > 0);
    await assert.rejects(
      withTx((tx) => createWorksite(tx, actor, c1, { code: "CT2", name: "Thiếu lng", lat: 21 })),
      isCode("CONSTRAINT"),
    );
  });

  test("lịch sử công tác theo khoảng hiệu lực; báo cáo quá khứ dùng đơn vị lúc đó", async () => {
    const emp = await withTx((tx) =>
      createEmployee(tx, actor, c1, { code: "NV001", fullName: "Nguyễn Văn A" }),
    );
    const mgr = await withTx((tx) =>
      createEmployee(tx, actor, c1, { code: "NV002", fullName: "Trần Thị B" }),
    );
    await withTx((tx) =>
      assignEmployment(tx, actor, c1, emp, { departmentId: d1a, title: "Kỹ sư", validFrom: "2026-01-01" }),
    );
    await withTx((tx) =>
      assignEmployment(tx, actor, c1, emp, {
        departmentId: d2,
        title: "Trưởng nhóm",
        managerEmployeeId: mgr,
        validFrom: "2026-07-01",
      }),
    );
    const mar = await employmentAt(db.app, c1, emp, "2026-03-15");
    assert.equal(mar?.departmentId, d1a);
    assert.equal(mar?.validTo, "2026-07-01");
    const jul = await employmentAt(db.app, c1, emp, "2026-07-01");
    assert.equal(jul?.departmentId, d2);
    assert.equal(jul?.managerEmployeeId, mgr);
    assert.equal(await employmentAt(db.app, c1, emp, "2025-12-31"), null);

    await assert.rejects(
      withTx((tx) => assignEmployment(tx, actor, c1, emp, { departmentId: d1, validFrom: "2026-06-01" })),
      isCode("BACKDATED_ASSIGNMENT"),
    );
    // Ràng buộc DB chặn chồng khoảng kể cả khi ghi tay.
    await assert.rejects(
      db.app.query(
        `INSERT INTO employment_history (company_id, employee_id, department_id, valid_from, valid_to)
         VALUES ($1, $2, $3, '2026-02-01', '2026-03-01')`,
        [c1, emp, d1],
      ),
      /employment_history_employee_id_daterange_excl|conflicting key/,
    );
    // Không tự làm quản lý của chính mình.
    await assert.rejects(
      withTx((tx) =>
        assignEmployment(tx, actor, c1, mgr, {
          departmentId: d1,
          managerEmployeeId: mgr,
          validFrom: "2026-01-01",
        }),
      ),
      isCode("CONSTRAINT"),
    );
  });

  test("mọi thao tác ghi đều có audit và chuỗi hợp lệ", async () => {
    const { rows } = await db.admin.query("SELECT action FROM audit_event WHERE company_id = $1", [c1]);
    const actions = new Set(rows.map((r) => r.action));
    for (const a of [
      "company.create",
      "branch.create",
      "department.create",
      "department.move",
      "employment.assign",
    ]) {
      assert.ok(actions.has(a), a);
    }
    assert.equal((await verifyAuditChain(db.app)).ok, true);
  });
});
