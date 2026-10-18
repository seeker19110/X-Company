import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after, before, describe, test } from "node:test";
import { withTx } from "../../lib/db/index.ts";
import {
  appendAudit,
  canonicalJson,
  GENESIS,
  MASK,
  maskSensitive,
  verifyAuditChain,
} from "../../lib/audit/index.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const U1 = "33333333-3333-4333-8333-333333333333";

describe("canonicalJson / maskSensitive (thuần)", () => {
  test("khoá sắp xếp, bỏ undefined, null ổn định", () => {
    assert.equal(
      canonicalJson({ b: 1, a: [2, { d: null, c: "x" }], e: undefined }),
      '{"a":[2,{"c":"x","d":null}],"b":1}',
    );
    assert.equal(canonicalJson(undefined), "null");
  });
  test("che trường nhạy cảm đệ quy", () => {
    assert.deepEqual(maskSensitive({ email: "a@b.c", password_hash: "x", nested: [{ token: "t", ok: 1 }] }), {
      email: "a@b.c",
      password_hash: MASK,
      nested: [{ token: MASK, ok: 1 }],
    });
    assert.equal(maskSensitive("plain"), "plain");
  });
});

describe("audit_event (S-ID-08)", () => {
  let db: TestDb;
  before(async () => {
    db = await freshDb();
  });
  after(async () => {
    await db.close();
  });

  test("ghi cùng giao dịch: giao dịch rollback thì không còn bản ghi audit", async () => {
    await assert.rejects(
      withTx(async (tx) => {
        await appendAudit(tx, { actorUserId: U1, companyId: C1, action: "x.rollback", objectType: "probe" });
        throw new Error("nghiệp vụ lỗi");
      }),
    );
    const { rows } = await db.admin.query(
      "SELECT count(*)::int AS n FROM audit_event WHERE action = 'x.rollback'",
    );
    assert.equal(rows[0].n, 0);
  });

  test("chuỗi nối theo công ty, bắt đầu từ GENESIS, che trường nhạy cảm", async () => {
    await withTx(async (tx) => {
      await appendAudit(tx, {
        actorUserId: U1,
        companyId: C1,
        action: "user.update",
        objectType: "app_user",
        objectId: "u-1",
        reason: "đổi email",
        before: { email: "a@example.test", password_hash: "secret" },
        after: { email: "b@example.test" },
        requestId: "req-1",
      });
      await appendAudit(tx, { actorUserId: U1, companyId: C1, action: "user.read", objectType: "app_user" });
      await appendAudit(tx, { actorUserId: null, companyId: C2, action: "sys.job", objectType: "job" });
      await appendAudit(tx, {
        actorUserId: U1,
        companyId: C1,
        action: "timesheet.read",
        objectType: "attendance_period",
        result: "denied",
      });
    });
    const { rows } = await db.admin.query(
      "SELECT chain_key, prev_hash, hash, before, result FROM audit_event ORDER BY seq",
    );
    assert.equal(rows.length, 4);
    assert.equal(rows[0].prev_hash, GENESIS);
    assert.equal(rows[1].prev_hash, rows[0].hash);
    assert.equal(rows[2].chain_key, C2);
    assert.equal(rows[2].prev_hash, GENESIS);
    assert.equal(rows[3].prev_hash, rows[1].hash);
    assert.equal(rows[0].before.password_hash, MASK);
    assert.equal(rows[3].result, "denied");
    const v = await verifyAuditChain(db.app);
    assert.deepEqual(v, { ok: true, checked: 4, firstBadId: null, problem: null });
    assert.equal((await verifyAuditChain(db.app, C2)).checked, 1);
  });

  test("20 giao dịch đồng thời cùng chuỗi vẫn tuyến tính (khoá advisory)", async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        withTx(async (tx) => {
          await appendAudit(tx, { actorUserId: U1, companyId: C2, action: `conc.${i}`, objectType: "probe" });
        }),
      ),
    );
    const v = await verifyAuditChain(db.app, C2);
    assert.equal(v.ok, true);
    assert.equal(v.checked, 21);
  });

  test("role ứng dụng không UPDATE/DELETE được; trigger chặn cả owner", async () => {
    await assert.rejects(
      db.app.query("UPDATE audit_event SET reason = 'x'"),
      /permission denied|append-only/,
    );
    await assert.rejects(db.app.query("DELETE FROM audit_event"), /permission denied|append-only/);
    await assert.rejects(db.admin.query("UPDATE audit_event SET reason = 'x'"), /append-only/);
    await assert.rejects(db.admin.query("TRUNCATE audit_event"), /append-only/);
  });

  test("sửa trực tiếp bằng superuser (tắt trigger) → verify chỉ ra đúng hàng", async () => {
    const target = await db.admin.query(
      "SELECT id FROM audit_event WHERE chain_key = $1 ORDER BY seq LIMIT 1 OFFSET 1",
      [C1],
    );
    const badId = target.rows[0].id as string;
    await db.admin.query("ALTER TABLE audit_event DISABLE TRIGGER audit_event_no_update");
    await db.admin.query("UPDATE audit_event SET reason = 'giả mạo' WHERE id = $1", [badId]);
    await db.admin.query("ALTER TABLE audit_event ENABLE TRIGGER audit_event_no_update");
    const v = await verifyAuditChain(db.app);
    assert.equal(v.ok, false);
    assert.equal(v.firstBadId, badId);
    assert.match(v.problem ?? "", /hash không khớp/);

    // Lệnh CLI cũng đỏ (exit 1) và in id.
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${db.name}`;
    let out = "";
    let code = 0;
    try {
      execFileSync("npx", ["--no-install", "tsx", "scripts/verify-audit-chain.ts"], {
        env: { ...process.env, DATABASE_URL: url.toString() },
        stdio: "pipe",
      });
    } catch (e) {
      const err = e as { status: number; stderr: Buffer };
      code = err.status;
      out = err.stderr.toString();
    }
    assert.equal(code, 1);
    assert.match(out, new RegExp(badId));
  });

  test("hàng bị chèn lệch chuỗi → báo đứt chuỗi", async () => {
    const db2 = await freshDb();
    try {
      await withTx(async (tx) => {
        await appendAudit(tx, { actorUserId: null, companyId: C1, action: "a", objectType: "o" });
        await appendAudit(tx, { actorUserId: null, companyId: C1, action: "b", objectType: "o" });
      });
      const first = await db2.admin.query("SELECT id FROM audit_event ORDER BY seq LIMIT 1");
      await db2.admin.query("ALTER TABLE audit_event DISABLE TRIGGER audit_event_no_update");
      await db2.admin.query("DELETE FROM audit_event WHERE id = $1", [first.rows[0].id]);
      const v = await verifyAuditChain(db2.app);
      assert.equal(v.ok, false);
      assert.match(v.problem ?? "", /đứt chuỗi/);
    } finally {
      await db2.close();
      // freshDb gắn pool toàn cục; trả lại cho db của describe.
      const { setPool } = await import("../../lib/db/index.ts");
      setPool(db.app);
    }
  });
});
