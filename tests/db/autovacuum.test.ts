// DB-PERF-008 (T-098): autovacuum bật, bảng ghi nhiều có tham số autovacuum riêng (migration 0033), tín hiệu cảnh báo tuổi XID
// (wraparound) và tỷ lệ hàng chết (bloat) đọc từ DB thật; lỗi truy vấn → không có dữ liệu (null), không báo 0 giả.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type pg from "pg";
import {
  AlertEngine,
  DEAD_TUPLES_RATIO_MAX_SQL,
  XID_AGE_MAX_SQL,
  type AlertNotification,
  type AlertRule,
  type AlertSink,
} from "../../lib/ops/index.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { setTestEnv } from "../helpers/fixtures.ts";

setTestEnv();

/** Bảng ghi nhiều và tham số mong đợi — khớp migrations/0033_autovacuum_tuning.sql. */
const CHURN = { vacuum: "0.05", analyze: "0.02", insert: "0.05" };
const APPEND = { vacuum: "0.1", analyze: "0.02", insert: "0.05" };
const EXPECTED: Record<string, typeof CHURN> = {
  outbox_event: CHURN,
  session: CHURN,
  idempotency_record: CHURN,
  api_rate_window: CHURN,
  public_rate_event: CHURN,
  login_attempt: CHURN,
  notification: CHURN,
  processed_message: CHURN,
  audit_event: APPEND,
  attendance_event: APPEND,
  rum_sample: APPEND,
};

const rule = (over: Partial<AlertRule>): AlertRule => ({
  id: "XCTestDbHealth",
  summary: "Luật thử nghiệm cho kiểm thử",
  severity: "ticket",
  owner: "tester",
  runbook: "docs/ops/RUNBOOK.md#4-cảnh-báo--playbook",
  signal: "xid_age_max",
  op: "gt",
  threshold: 0,
  forSeconds: 0,
  ...over,
});
const memSink = (): AlertSink & { got: AlertNotification[] } => {
  const got: AlertNotification[] = [];
  return {
    name: "mem",
    got,
    send(n) {
      got.push(n);
      return Promise.resolve();
    },
  };
};
const valueOf = async (pool: Pick<pg.Pool, "query">, r: AlertRule): Promise<number | null> =>
  (await new AlertEngine([r], { sinks: [], pool }).evaluate())[0]!.value;

let db: TestDb;
before(async () => {
  db = await freshDb();
});
after(async () => {
  await db.close();
});

/** Lệnh trên cùng một kết nối + ép đẩy thống kê (PostgreSQL ≥ 15 đẩy pg_stat không đồng bộ). */
async function onOneConnection(sqls: string[]): Promise<void> {
  const c = await db.admin.connect();
  try {
    for (const q of sqls) await c.query(q);
    await c.query("SELECT pg_stat_force_next_flush()");
  } finally {
    c.release();
  }
}
async function waitStats(table: string, ok: (live: number, dead: number) => boolean): Promise<void> {
  for (let i = 0; i < 150; i++) {
    const r = await db.admin.query<{ live: string; dead: string }>(
      "SELECT n_live_tup AS live, n_dead_tup AS dead FROM pg_stat_user_tables WHERE relname = $1",
      [table],
    );
    const row = r.rows[0];
    if (row && ok(Number(row.live), Number(row.dead))) return;
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error(`thống kê của ${table} không cập nhật trong 15 giây`);
}

describe("autovacuum (DB-PERF-008)", () => {
  test("SHOW autovacuum = on và track_counts = on (autovacuum cần thống kê để chọn bảng)", async () => {
    assert.equal((await db.admin.query<{ autovacuum: string }>("SHOW autovacuum")).rows[0]!.autovacuum, "on");
    assert.equal(
      (await db.admin.query<{ track_counts: string }>("SHOW track_counts")).rows[0]!.track_counts,
      "on",
    );
  });

  test("mỗi bảng ghi nhiều có tham số autovacuum riêng đúng giá trị của migration 0033", async () => {
    const r = await db.admin.query<{ relname: string; reloptions: string[] | null }>(
      `SELECT c.relname, c.reloptions FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY($1)`,
      [Object.keys(EXPECTED)],
    );
    assert.equal(r.rowCount, Object.keys(EXPECTED).length, "mọi bảng trong danh sách đều tồn tại");
    for (const row of r.rows) {
      const opts = new Map((row.reloptions ?? []).map((o) => o.split("=") as [string, string]));
      const want = EXPECTED[row.relname]!;
      assert.equal(opts.get("autovacuum_vacuum_scale_factor"), want.vacuum, row.relname);
      assert.equal(opts.get("autovacuum_analyze_scale_factor"), want.analyze, row.relname);
      assert.equal(opts.get("autovacuum_vacuum_insert_scale_factor"), want.insert, row.relname);
      assert.equal(opts.has("autovacuum_enabled"), false, `${row.relname}: không tắt autovacuum`);
    }
    // Bảng không thuộc danh sách giữ mặc định toàn cụm (migration chỉ chạm đúng bảng đã chọn).
    const other = await db.admin.query<{ reloptions: string[] | null }>(
      "SELECT reloptions FROM pg_class WHERE oid = 'public.company'::regclass",
    );
    assert.equal(other.rows[0]!.reloptions, null);
  });
});

describe("tín hiệu cảnh báo xid_age_max / dead_tuples_ratio_max", () => {
  test("xid_age_max: số nguyên dương, dưới 2^31, khớp max(age(datfrozenxid)) và tăng khi tiêu thụ XID", async () => {
    const before = await valueOf(db.admin, rule({ signal: "xid_age_max" }));
    assert.ok(before !== null && Number.isInteger(before) && before > 0 && before < 2 ** 31, String(before));
    for (let i = 0; i < 20; i++) await db.admin.query("SELECT pg_current_xact_id()");
    const later = await valueOf(db.admin, rule({ signal: "xid_age_max" }));
    assert.ok(later! >= before + 20, `${before} → ${later}`);
    const direct = Number((await db.admin.query<{ n: string }>(XID_AGE_MAX_SQL)).rows[0]!.n);
    assert.ok(direct >= later!);
  });

  test("dead_tuples_ratio_max: DB mới → 0; bảng ≥ min_live_tuples có 25% hàng chết → 0,25 và luật > 0,2 bắn; VACUUM → hết", async () => {
    const r = rule({
      id: "XCTestDeadTuples",
      signal: "dead_tuples_ratio_max",
      threshold: 0.2,
      params: { min_live_tuples: 10_000 },
    });
    assert.equal(await valueOf(db.admin, r), 0, "không bảng nào đủ lớn → 0, không null");
    await onOneConnection([
      "CREATE TABLE t_bloat (id int PRIMARY KEY) WITH (autovacuum_enabled = false)",
      "INSERT INTO t_bloat SELECT generate_series(1, 20000)",
      "DELETE FROM t_bloat WHERE id > 15000",
    ]);
    await waitStats("t_bloat", (live, dead) => live === 15_000 && dead === 5_000);
    const v = await valueOf(db.admin, r);
    assert.ok(v !== null && Math.abs(v - 0.25) < 1e-9, String(v));
    // Bảng nhỏ hơn ngưỡng hàng sống bị loại (tránh báo phình cho bảng vài trăm hàng).
    assert.equal(await valueOf(db.admin, { ...r, params: { min_live_tuples: 15_001 } }), 0);
    // Role ứng dụng (quyền production, không phải owner) đọc được cả hai tín hiệu.
    assert.ok(Math.abs((await valueOf(db.app, r))! - 0.25) < 1e-9);
    assert.ok((await valueOf(db.app, rule({ signal: "xid_age_max" })))! > 0);

    const sink = memSink();
    const e = new AlertEngine([r], { sinks: [sink], pool: db.admin });
    assert.equal((await e.evaluate())[0]!.notified, "firing");
    await onOneConnection(["VACUUM t_bloat"]);
    await waitStats("t_bloat", (_live, dead) => dead === 0);
    assert.equal((await e.evaluate())[0]!.notified, "resolved");
    assert.deepEqual(
      sink.got.map((n) => n.status),
      ["firing", "resolved"],
    );
  });

  test("ca biên: min_live_tuples = 0 bị chặn về 1 (bảng rỗng không chia cho 0); thiếu params dùng mặc định 10.000", async () => {
    await db.admin.query("CREATE TABLE t_empty (id int)");
    await onOneConnection(["ANALYZE t_empty"]);
    const v0 = await valueOf(
      db.admin,
      rule({ signal: "dead_tuples_ratio_max", params: { min_live_tuples: 0 } }),
    );
    assert.ok(v0 !== null && v0 >= 0 && v0 <= 1, String(v0));
    // Truy vấn thô với $1 = 0 chính là lỗi chia cho 0 mà phép chặn tránh được.
    await assert.rejects(db.admin.query(DEAD_TUPLES_RATIO_MAX_SQL, [0]), /division by zero/);
    const vd = await valueOf(db.admin, rule({ signal: "dead_tuples_ratio_max" }));
    assert.ok(vd !== null && vd >= 0 && vd <= 1);
  });

  test("đồng thời: nhiều lượt đánh giá song song cho cùng kết quả hợp lệ", async () => {
    const rules = [
      rule({ id: "XCXid", signal: "xid_age_max", threshold: 2e9 }),
      rule({ id: "XCDead", signal: "dead_tuples_ratio_max", threshold: 1 }),
    ];
    const outs = await Promise.all(
      Array.from({ length: 8 }, () => new AlertEngine(rules, { sinks: [], pool: db.app }).evaluate()),
    );
    for (const o of outs) {
      assert.ok(o[0]!.value !== null && o[0]!.value > 0);
      assert.ok(o[1]!.value !== null && o[1]!.value >= 0 && o[1]!.value <= 1);
      assert.ok(o.every((x) => x.notified === null));
    }
  });

  test("lỗi truy vấn / không có pool → null (không có dữ liệu, không báo 0 giả), không gửi gì", async () => {
    const broken = { query: () => Promise.reject(new Error("DB chết")) } as unknown as pg.Pool;
    const sink = memSink();
    const rules = [
      rule({ id: "XCXid", signal: "xid_age_max" }),
      rule({ id: "XCDead", signal: "dead_tuples_ratio_max", op: "gte" }),
    ];
    const out = await new AlertEngine(rules, { sinks: [sink], pool: broken }).evaluate();
    assert.deepEqual(
      out.map((o) => o.value),
      [null, null],
    );
    const bare = await new AlertEngine(rules, { sinks: [sink] }).evaluate();
    assert.deepEqual(
      bare.map((o) => o.value),
      [null, null],
    );
    assert.equal(sink.got.length, 0);
  });
});
