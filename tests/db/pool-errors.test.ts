import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { getPool } from "../../lib/db/index.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";

// Hồi quy: kết nối nhàn rỗi bị máy chủ ngắt ("terminating connection due to administrator command") từng làm test
// dashboard flake bằng uncaughtException; ở production là tiến trình chết khi DB khởi động lại/failover.
describe("pool chịu được kết nối nhàn rỗi bị ngắt (ARC-RES)", () => {
  let db: TestDb;
  before(async () => {
    db = await freshDb();
  });
  after(async () => {
    await db.close();
  });

  test("ngắt mọi kết nối nhàn rỗi của pool ứng dụng → không uncaughtException; truy vấn kế tiếp mở kết nối mới", async () => {
    const pool = getPool();
    assert.equal(pool.listenerCount("error") > 0, true, "pool ứng dụng phải có listener error");
    const pid = (await pool.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
    let uncaught: unknown = null;
    const onUncaught = (e: unknown) => {
      uncaught = e;
    };
    process.on("uncaughtException", onUncaught);
    try {
      const killed = await db.admin.query<{ ok: boolean }>("SELECT pg_terminate_backend($1) AS ok", [pid]);
      assert.equal(killed.rows[0]!.ok, true);
      await new Promise((r) => setTimeout(r, 200)); // để sự kiện lỗi của kết nối nhàn rỗi tới
      assert.equal(uncaught, null);
      const r = await pool.query<{ n: number }>("SELECT 1 AS n");
      assert.equal(r.rows[0]!.n, 1);
    } finally {
      process.off("uncaughtException", onUncaught);
    }
  });

  test("pool admin của test cũng có listener error", () => {
    assert.ok(db.admin.listenerCount("error") > 0);
  });
});
