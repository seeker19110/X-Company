import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, describe, test } from "node:test";
import { verifyAuditChain } from "../../lib/audit/index.ts";
import { createFirstAdmin } from "../../lib/identity/bootstrap.ts";
import { verifyPassword } from "../../lib/identity/password.ts";
import { AppError } from "../../lib/nen/app-error.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { cookieFrom, seedCompany, setTestEnv, loginThrough } from "../helpers/fixtures.ts";

setTestEnv();
const STRONG = "Mat-khau-quan-tri-rat-dai-2026!";
const isCode = (code: string) => (e: unknown) => e instanceof AppError && e.code === code;

describe("tạo quản trị viên đầu tiên (BASE-SEC-005)", () => {
  let db: TestDb;
  before(async () => {
    db = await freshDb();
  });
  after(async () => {
    await db.close();
  });

  test("mật khẩu yếu bị từ chối và không ghi gì vào CSDL", async () => {
    await assert.rejects(
      createFirstAdmin({ email: "a@example.test", displayName: "A", password: "ngan" }),
      isCode("WEAK_PASSWORD"),
    );
    await assert.rejects(
      createFirstAdmin({
        email: "admin@example.test",
        displayName: "A",
        password: "admin@example.test-2026-xx",
      }),
      isCode("WEAK_PASSWORD"),
    );
    for (const t of ["app_user", "company", "role_grant"])
      assert.equal((await db.admin.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n, 0, t);
  });

  test("email/tên không hợp lệ bị từ chối", async () => {
    await assert.rejects(
      createFirstAdmin({ email: "khong-phai-email", displayName: "A", password: STRONG }),
      isCode("INVALID_EMAIL"),
    );
    await assert.rejects(
      createFirstAdmin({ email: "a@example.test", displayName: "   ", password: STRONG }),
      isCode("INVALID_NAME"),
    );
  });

  test("tạo công ty + tài khoản + grant sysadmin; đăng nhập được; chuỗi audit hợp lệ", async () => {
    const r = await createFirstAdmin({
      email: "  Admin@Example.TEST ",
      displayName: " Quản Trị ",
      password: STRONG,
      companyName: "Công ty Thử",
    });
    const u = (await db.admin.query("SELECT * FROM app_user WHERE id = $1", [r.userId])).rows[0];
    assert.equal(u.email, "admin@example.test");
    assert.equal(u.display_name, "Quản Trị");
    assert.match(u.password_hash, /^\$argon2id\$/);
    assert.equal(await verifyPassword(u.password_hash, STRONG), true);
    const g = (await db.admin.query("SELECT role, scope_type FROM role_grant WHERE user_id = $1", [r.userId]))
      .rows;
    assert.deepEqual(g, [{ role: "sysadmin", scope_type: "company" }]);
    assert.equal(
      (await db.admin.query("SELECT name FROM company WHERE id = $1", [r.companyId])).rows[0].name,
      "Công ty Thử",
    );

    const res = await loginThrough("admin@example.test", STRONG);
    assert.equal(res.status, 200);
    assert.ok(cookieFrom(res).includes("="));

    const actions = (await db.admin.query("SELECT action FROM audit_event ORDER BY seq")).rows.map(
      (x) => x.action,
    );
    assert.ok(
      actions.includes("admin.bootstrap") &&
        actions.includes("grant.create") &&
        actions.includes("company.create"),
    );
    assert.equal((await verifyAuditChain(db.admin)).ok, true);
    // AUD-SEC-005: grant đầu tiên do actor hệ thống tường minh cấp (không người cấp).
    const ga = await db.admin.query(
      "SELECT a.actor_user_id, g.granted_by FROM audit_event a JOIN role_grant g ON g.id::text = a.object_id::text WHERE a.action = 'grant.create'",
    );
    assert.deepEqual(ga.rows, [{ actor_user_id: null, granted_by: null }]);
  });

  test("đã có admin → từ chối (kể cả chạy song song), không tạo thêm", async () => {
    await assert.rejects(
      createFirstAdmin({ email: "hai@example.test", displayName: "Hai", password: STRONG }),
      isCode("ADMIN_EXISTS"),
    );
    const before = (await db.admin.query("SELECT count(*)::int AS n FROM app_user")).rows[0].n;
    const results = await Promise.allSettled([
      createFirstAdmin({ email: "ba@example.test", displayName: "Ba", password: STRONG }),
      createFirstAdmin({ email: "bon@example.test", displayName: "Bốn", password: STRONG }),
    ]);
    assert.ok(results.every((x) => x.status === "rejected"));
    assert.equal((await db.admin.query("SELECT count(*)::int AS n FROM app_user")).rows[0].n, before);
  });

  test("admin duy nhất bị thu hồi → được tạo lại; chạy song song chỉ một thành công (CSDL mới)", async () => {
    await db.admin.query("UPDATE role_grant SET revoked_at = now() WHERE role = 'sysadmin'");
    const results = await Promise.allSettled([
      createFirstAdmin({ email: "moi1@example.test", displayName: "Mới 1", password: STRONG }),
      createFirstAdmin({ email: "moi2@example.test", displayName: "Mới 2", password: STRONG }),
    ]);
    assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
    const rejected = results.find((x) => x.status === "rejected") as PromiseRejectedResult;
    assert.ok(isCode("ADMIN_EXISTS")(rejected.reason));
  });
});

describe("tạo admin: nhiều công ty / công ty có sẵn", () => {
  let db: TestDb;
  before(async () => {
    db = await freshDb();
  });
  after(async () => {
    await db.close();
  });

  test("dùng công ty duy nhất có sẵn; nhiều công ty thì bắt buộc companyId", async () => {
    const a = await seedCompany("Công ty A");
    await seedCompany("Công ty B");
    await assert.rejects(
      createFirstAdmin({ email: "x@example.test", displayName: "X", password: STRONG }),
      isCode("COMPANY_REQUIRED"),
    );
    await assert.rejects(
      createFirstAdmin({
        email: "x@example.test",
        displayName: "X",
        password: STRONG,
        companyId: "00000000-0000-4000-8000-000000000000",
      }),
      isCode("NOT_FOUND"),
    );
    const r = await createFirstAdmin({
      email: "x@example.test",
      displayName: "X",
      password: STRONG,
      companyId: a.companyId,
    });
    assert.equal(r.companyId, a.companyId);
  });
});

describe("scripts/create-admin.ts (CLI)", () => {
  let db: TestDb;
  before(async () => {
    db = await freshDb();
  });
  after(async () => {
    await db.close();
  });

  const run = (envVars: Record<string, string>, stdin: string) => {
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${db.name}`;
    return spawnSync("npx", ["--no-install", "tsx", "scripts/create-admin.ts"], {
      env: {
        NODE_ENV: "test",
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        DATABASE_URL: url.toString(),
        ...envVars,
      },
      input: stdin,
      encoding: "utf8",
      timeout: 60_000,
    });
  };
  const who = { ADMIN_EMAIL: "cli@example.test", ADMIN_NAME: "Quản trị CLI", COMPANY_NAME: "Công ty CLI" };

  test("thiếu ADMIN_EMAIL/ADMIN_NAME → exit 2", () => {
    assert.equal(run({}, STRONG).status, 2);
  });

  test("mật khẩu yếu qua stdin → exit 1, không in mật khẩu, không tạo gì", async () => {
    const r = run(who, "ngan\n");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /WEAK_PASSWORD/);
    assert.equal(r.stdout.includes("ngan") || r.stderr.includes("ngan\n"), false);
    assert.equal((await db.admin.query("SELECT count(*)::int AS n FROM app_user")).rows[0].n, 0);
  });

  test("mật khẩu mạnh qua stdin → exit 0 và đăng nhập được; chạy lại → exit 1 (đã có admin)", async () => {
    const ok = run(who, `${STRONG}\n`);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /cli@example\.test/);
    assert.equal(ok.stdout.includes(STRONG) || ok.stderr.includes(STRONG), false);
    const res = await loginThrough("cli@example.test", STRONG);
    assert.equal(res.status, 200);

    const again = run({ ...who, ADMIN_EMAIL: "khac@example.test" }, `${STRONG}\n`);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /ADMIN_EXISTS/);
  });

  test("mật khẩu qua biến ADMIN_PASSWORD hoạt động (một lần) và không bị in", async () => {
    await db.admin.query("UPDATE role_grant SET revoked_at = now() WHERE role = 'sysadmin'");
    const r = run({ ...who, ADMIN_EMAIL: "env@example.test", ADMIN_PASSWORD: STRONG }, "");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.includes(STRONG) || r.stderr.includes(STRONG), false);
  });
});
