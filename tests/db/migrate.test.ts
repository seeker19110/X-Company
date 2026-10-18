import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { listMigrations, runMigrations } from "../../lib/db/migrate.ts";
import { withTx } from "../../lib/db/index.ts";
import { emptyDb, freshDb, type TestDb } from "../helpers/db.ts";

function tmpMigrations(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "xc-mig-"));
  for (const [name, sql] of Object.entries(files)) writeFileSync(path.join(dir, name), sql);
  return dir;
}

describe("bộ chạy migration", () => {
  test("áp theo thứ tự, ghi checksum, chạy lại không áp lần hai", async () => {
    const db = await emptyDb();
    try {
      const dir = tmpMigrations({
        "0002_b.sql": "INSERT INTO t VALUES (2);",
        "0001_a.sql": "CREATE TABLE t (x int);",
      });
      assert.deepEqual(await runMigrations(db.pool, dir), ["0001_a.sql", "0002_b.sql"]);
      assert.deepEqual(await runMigrations(db.pool, dir), []);
      const { rows } = await db.pool.query("SELECT count(*)::int AS n FROM t");
      assert.equal(rows[0].n, 1);
      const sums = await db.pool.query("SELECT checksum FROM schema_migrations ORDER BY name");
      assert.equal(sums.rows.length, 2);
      assert.match(sums.rows[0].checksum, /^[0-9a-f]{64}$/);
    } finally {
      await db.close();
    }
  });

  test("file đã áp bị sửa → lỗi, không áp gì thêm", async () => {
    const db = await emptyDb();
    try {
      const dir = tmpMigrations({ "0001_a.sql": "CREATE TABLE t (x int);" });
      await runMigrations(db.pool, dir);
      writeFileSync(path.join(dir, "0001_a.sql"), "CREATE TABLE t (x bigint);");
      writeFileSync(path.join(dir, "0002_b.sql"), "CREATE TABLE u (x int);");
      await assert.rejects(runMigrations(db.pool, dir), /bị sửa/);
      const u = await db.pool.query("SELECT to_regclass('u') AS r");
      assert.equal(u.rows[0].r, null);
    } finally {
      await db.close();
    }
  });

  test("file đã áp bị xoá → lỗi append-only", async () => {
    const db = await emptyDb();
    try {
      const dir = tmpMigrations({ "0001_a.sql": "CREATE TABLE t (x int);" });
      await runMigrations(db.pool, dir);
      const dir2 = tmpMigrations({ "0002_b.sql": "SELECT 1;" });
      await assert.rejects(runMigrations(db.pool, dir2), /append-only/);
    } finally {
      await db.close();
    }
  });

  test("migration lỗi được rollback trọn file và báo tên file", async () => {
    const db = await emptyDb();
    try {
      const dir = tmpMigrations({ "0001_a.sql": "CREATE TABLE t (x int); SELECT nope_fn();" });
      await assert.rejects(runMigrations(db.pool, dir), /0001_a\.sql/);
      const t = await db.pool.query("SELECT to_regclass('t') AS r");
      assert.equal(t.rows[0].r, null);
    } finally {
      await db.close();
    }
  });

  test("tên sai quy ước hoặc trùng số bị từ chối", () => {
    assert.throws(() => listMigrations(tmpMigrations({ "1_a.sql": "" })), /quy ước/);
    assert.throws(() => listMigrations(tmpMigrations({ "0001_a.sql": "", "0001_b.sql": "" })), /Trùng số/);
  });
});

describe("role ứng dụng (THREAT-MODEL T12)", () => {
  let db: TestDb;
  before(async () => {
    db = await freshDb();
  });
  after(async () => {
    await db.close();
  });

  test("migrations của repo áp sạch", () => {
    assert.ok(listMigrations().length >= 1);
  });

  test("role ứng dụng không superuser, không BYPASSRLS, không tạo bảng được", async () => {
    const { rows } = await db.app.query(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
    );
    assert.deepEqual(rows[0], { rolsuper: false, rolbypassrls: false });
    await assert.rejects(db.app.query("CREATE TABLE hack (x int)"), /permission denied/);
  });

  test("withTx commit khi thành công, rollback khi lỗi", async () => {
    await db.admin.query("CREATE TABLE tx_probe (x int)");
    await withTx(async (tx) => {
      await tx.query("INSERT INTO tx_probe VALUES (1)");
    });
    await assert.rejects(
      withTx(async (tx) => {
        await tx.query("INSERT INTO tx_probe VALUES (2)");
        throw new Error("boom");
      }),
      /boom/,
    );
    const { rows } = await db.admin.query("SELECT array_agg(x) AS xs FROM tx_probe");
    assert.deepEqual(rows[0].xs, [1]);
  });
});
