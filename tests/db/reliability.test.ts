// Độ tin cậy & toàn vẹn dữ liệu (T-027): timeout phụ thuộc, timeout cấp vai trò, ON CONFLICT, đồng thời số dư/hạn mức,
// FK ON DELETE + index, EXPLAIN đường nóng, bù blob mồ côi. Test DB thật (không skip).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import pg from "pg";
import { loadActor } from "../../lib/authz/load.ts";
import type { ActorContext } from "../../lib/authz/index.ts";
import { recordEvent } from "../../lib/attendance/events.ts";
import { PENDING_APPROVALS_SQL } from "../../lib/attendance/approvals.ts";
import {
  decideLeave,
  LEAVE_BALANCE_SQL,
  leaveBalance,
  postLedger,
  requestLeave,
} from "../../lib/attendance/leave.ts";
import { decideOt, requestOt } from "../../lib/attendance/ot.ts";
import { NEEDS_REVIEW_SQL } from "../../lib/attendance/period.ts";
import {
  closePool,
  getPool,
  PG_SESSION_OPTIONS,
  POOL_TIMEOUTS,
  setPool,
  withTx,
} from "../../lib/db/index.ts";
import { uploadFile } from "../../lib/files/index.ts";
import { diskStorage, setStorage, type Storage } from "../../lib/files/storage.ts";
import { ApplicationInput, InquiryInput, submitApplication, submitInquiry } from "../../lib/inquiry/index.ts";
import { AppError } from "../../lib/nen/app-error.ts";
import { assignEmployment } from "../../lib/org/index.ts";
import { TODAY_EVENTS_SQL } from "../../lib/today/index.ts";
import { MY_TASKS_SQL } from "../../lib/work/routes.ts";
import { createProject } from "../../lib/work/tasks.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { seedCompany, seedUser, setTestEnv } from "../helpers/fixtures.ts";
import { within } from "../helpers/wait.ts";

setTestEnv();
const isCode = (code: string) => (e: unknown) => e instanceof AppError && e.code === code;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ROOT = process.cwd();

// ───────────────────────── Timeout phụ thuộc (ARC-RES-001, BE-REL-001, BASE-ERR-004, DB-PERF-004) ─────────────────────────
describe("timeout tường minh cho phụ thuộc", () => {
  test("pool ứng dụng: timeout kết nối/truy vấn khác 0, query_timeout > statement_timeout; max tường minh", async () => {
    setPool(undefined);
    const pool = getPool();
    try {
      const o = (pool as unknown as { options: Record<string, unknown> }).options;
      assert.ok(Number(o.connectionTimeoutMillis) > 0 && Number(o.connectionTimeoutMillis) <= 10_000);
      assert.ok(Number(o.query_timeout) > 30_000, "client chỉ là lưới an toàn sau statement_timeout 30 s");
      assert.ok(Number(o.max) > 0);
    } finally {
      await closePool();
    }
    assert.match(PG_SESSION_OPTIONS, /statement_timeout=30000/);
    assert.match(PG_SESSION_OPTIONS, /idle_in_transaction_session_timeout=60000/);
  });

  test("phụ thuộc treo (nhận TCP, không bắt tay): lỗi timeout trong hạn, không treo", async () => {
    const sockets = new Set<net.Socket>();
    const srv = net.createServer((s) => (sockets.add(s), s.on("error", () => {})));
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const port = (srv.address() as net.AddressInfo).port;
    // Cùng cấu hình sản xuất, chỉ rút ngắn hạn kết nối để test nhanh (giá trị sản xuất được kiểm ở test trên).
    const pool = new pg.Pool({
      connectionString: `postgres://u:p@127.0.0.1:${port}/d`,
      max: 1,
      ...POOL_TIMEOUTS,
      connectionTimeoutMillis: 300,
    });
    try {
      const t0 = Date.now();
      await assert.rejects(pool.query("SELECT 1"), /timeout/i);
      assert.ok(Date.now() - t0 < 2000, `mất ${Date.now() - t0} ms`);
    } finally {
      await Promise.race([pool.end().catch(() => {}), sleep(1500)]);
      for (const s of sockets) s.destroy();
      await new Promise((r) => srv.close(r));
    }
  });

  test("DB-TX-003: lib/ (nơi chứa withTx) không có client mạng — gọi ngoài phải qua outbox, không trong giao dịch", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".ts")) {
          // `isIP` của node:net chỉ kiểm chuỗi, không mở kết nối — không tính là client mạng.
          const src = readFileSync(p, "utf8").replace(/import \{ isIP \} from "node:net";/g, "");
          // lib/nen/shutdown.ts chỉ móc vào http.Server của chính tiến trình (không gọi ra ngoài).
          if (
            /\bfetch\(|node:https?["']|undici|node:net["']|nodemailer/.test(src) &&
            !p.endsWith("shutdown.ts")
          )
            hits.push(path.relative(ROOT, p));
        }
      }
    };
    walk(path.join(ROOT, "lib"));
    assert.deepEqual(hits, []);
  });

  test("mọi fetch phía client có AbortSignal.timeout (grep cấu hình client)", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
      }
    };
    walk(path.join(ROOT, "app"));
    let found = 0;
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\bfetch\(/g)) {
        found++;
        const window = src.slice(m.index, m.index + 700);
        assert.match(window, /AbortSignal\.timeout\(/, `${path.relative(ROOT, f)}: fetch thiếu timeout`);
      }
    }
    assert.ok(found >= 3, "phải tìm thấy các lời gọi fetch của api.ts, contact-form.tsx, sync-client.ts");
  });
});

// ───────────────────────── Timeout cấp vai trò (DB-PERF-005) ─────────────────────────
describe("timeout ở mức vai trò ứng dụng (migration 0018)", () => {
  let db: TestDb;
  const probe = `xc_probe_${randomUUID().slice(0, 8)}`;
  before(async () => {
    db = await freshDb();
  });
  after(async () => {
    await db.admin.query(`DROP ROLE IF EXISTS ${probe}`);
    await db.close();
  });

  test("vai trò xc_app_rw có statement_timeout và idle_in_transaction_session_timeout (≠ 0)", async () => {
    const { rows } = await db.admin.query<{ rolconfig: string[] }>(
      "SELECT rolconfig FROM pg_roles WHERE rolname = 'xc_app_rw'",
    );
    const cfg = rows[0]!.rolconfig;
    assert.ok(cfg.includes("statement_timeout=30s"), String(cfg));
    assert.ok(cfg.includes("idle_in_transaction_session_timeout=60s"), String(cfg));
  });

  test("kết nối của role ứng dụng (như pool production): SHOW ≠ 0", async () => {
    const a = await db.app.query("SHOW idle_in_transaction_session_timeout");
    assert.notEqual(a.rows[0].idle_in_transaction_session_timeout, "0");
    const b = await db.app.query("SHOW statement_timeout");
    assert.equal(b.rows[0].statement_timeout, "30s");
  });

  test("migration idempotent và phủ vai trò đăng nhập là thành viên xc_app_rw", async () => {
    await db.admin.query(`CREATE ROLE ${probe} LOGIN NOSUPERUSER`);
    await db.admin.query(`GRANT xc_app_rw TO ${probe}`);
    const sql = readFileSync(path.join(ROOT, "migrations", "0018_role_timeouts.sql"), "utf8");
    for (let i = 0; i < 2; i++) await db.admin.query(sql); // chạy lại không lỗi, cùng kết quả
    const { rows } = await db.admin.query<{ rolconfig: string[] }>(
      "SELECT rolconfig FROM pg_roles WHERE rolname = $1",
      [probe],
    );
    assert.deepEqual([...rows[0]!.rolconfig].sort(), [
      "idle_in_transaction_session_timeout=60s",
      "statement_timeout=30s",
    ]);
  });

  test("idle in transaction bị máy chủ ngắt (giữ khoá không vô hạn)", async () => {
    const url = new URL(db.app.options.connectionString!);
    const c = new pg.Client({
      connectionString: url.toString(),
      options: "-c idle_in_transaction_session_timeout=300", // rút ngắn để test nhanh; cơ chế giống production
    });
    // Máy chủ ngắt phiên → client phát "error"/"end": chờ sự kiện đó (có hạn) thay cho sleep cố định (AUD-TEST-001).
    const terminated = new Promise<void>((resolve) => {
      c.once("error", () => resolve());
      c.once("end", () => resolve());
    });
    c.on("error", () => {});
    await c.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT 1");
      await within(terminated, "máy chủ ngắt phiên idle in transaction");
      await assert.rejects(
        c.query("SELECT 1"),
        /terminating connection|idle-in-transaction|Connection terminated|not queryable/i,
      );
    } finally {
      await c.end().catch(() => {});
    }
  });
});

// ───────────────────────── Đồng thời (DB-TX-001, QA-UNIT-008) ─────────────────────────
describe("đồng thời: số dư phép và hạn mức OT", () => {
  let db: TestDb;
  let org: Awaited<ReturnType<typeof seedCompany>>;
  let emp: ActorContext, lead: ActorContext, hr: ActorContext;
  let annual: string;

  before(async () => {
    db = await freshDb();
    org = await seedCompany("Công ty Đồng thời");
    const e = await seedUser(org.companyId, { grants: [{ role: "employee", scopeType: "self" }] });
    const l = await seedUser(org.companyId, {
      grants: [{ role: "team_lead", scopeType: "department", scopeId: org.deptId }],
    });
    const h = await seedUser(org.companyId, { grants: [{ role: "hr", scopeType: "company" }] });
    await withTx(async (tx) => {
      for (const u of [e, l])
        await assignEmployment(tx, { userId: null }, org.companyId, u.employeeId!, {
          departmentId: org.deptId,
          validFrom: "2026-01-01",
        });
    });
    emp = (await loadActor(db.app, e.userId))!;
    lead = (await loadActor(db.app, l.userId))!;
    hr = (await loadActor(db.app, h.userId))!;
    const t = await db.admin.query(
      `INSERT INTO leave_type (company_id, code, name, paid, requires_balance) VALUES ($1, 'PN', 'Phép năm', true, true) RETURNING id`,
      [org.companyId],
    );
    annual = t.rows[0].id;
  });
  after(async () => {
    await db.close();
  });

  test("6 đơn nghỉ 100' duyệt đồng thời với số dư 480' → đúng 4 đơn được duyệt, số dư không âm (= 80')", async () => {
    await withTx((tx) =>
      postLedger(tx, hr, {
        employeeId: emp.employeeId!,
        leaveTypeId: annual,
        entryType: "accrual",
        minutes: 480,
        reason: "kỳ 1",
      }),
    );
    const ids: string[] = [];
    for (let day = 1; day <= 6; day++)
      ids.push(
        await withTx((tx) =>
          requestLeave(tx, emp, {
            leaveTypeId: annual,
            startAt: new Date(`2026-12-0${day}T01:00:00Z`),
            endAt: new Date(`2026-12-0${day}T03:00:00Z`),
            minutes: 100,
          }),
        ),
      );
    const results = await Promise.allSettled(
      ids.map((id) => withTx((tx) => decideLeave(tx, lead, id, "approve"))),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    assert.equal(ok, 4);
    assert.equal(rejected.length, 2);
    for (const r of rejected) assert.ok(isCode("INSUFFICIENT_BALANCE")(r.reason), String(r.reason));
    const bal = await leaveBalance(db.app, emp.employeeId!, annual);
    assert.equal(bal, 80);
    const sum = await db.admin.query(
      "SELECT sum(minutes)::int AS s FROM leave_ledger WHERE employee_id = $1",
      [emp.employeeId],
    );
    assert.ok(sum.rows[0].s >= 0, "số dư (tổng sổ) không bao giờ âm");
  });

  test("2 đơn nghỉ cùng chiếm hết số dư duyệt đồng thời → một duyệt, một INSUFFICIENT_BALANCE, số dư 0 (không -N)", async () => {
    const e2 = await seedUser(org.companyId, { grants: [{ role: "employee", scopeType: "self" }] });
    await withTx((tx) =>
      assignEmployment(tx, { userId: null }, org.companyId, e2.employeeId!, {
        departmentId: org.deptId,
        validFrom: "2026-01-01",
      }),
    );
    const emp2 = (await loadActor(db.app, e2.userId))!;
    await withTx((tx) =>
      postLedger(tx, hr, {
        employeeId: emp2.employeeId!,
        leaveTypeId: annual,
        entryType: "accrual",
        minutes: 480,
        reason: "kỳ 1",
      }),
    );
    const a = await withTx((tx) =>
      requestLeave(tx, emp2, {
        leaveTypeId: annual,
        startAt: new Date("2027-01-04T01:00:00Z"),
        endAt: new Date("2027-01-04T10:00:00Z"),
        minutes: 480,
      }),
    );
    const b = await withTx((tx) =>
      requestLeave(tx, emp2, {
        leaveTypeId: annual,
        startAt: new Date("2027-01-05T01:00:00Z"),
        endAt: new Date("2027-01-05T10:00:00Z"),
        minutes: 480,
      }),
    );
    const rs = await Promise.allSettled(
      [a, b].map((id) => withTx((tx) => decideLeave(tx, lead, id, "approve"))),
    );
    assert.equal(rs.filter((r) => r.status === "fulfilled").length, 1);
    const bad = rs.find((r) => r.status === "rejected") as PromiseRejectedResult;
    assert.ok(isCode("INSUFFICIENT_BALANCE")(bad.reason), String(bad.reason));
    assert.equal(await leaveBalance(db.app, emp2.employeeId!, annual), 0);
  });

  test("4 đơn OT 120' duyệt đồng thời với hạn mức tháng 300' → đúng 2 đơn, tổng OT đã duyệt ≤ 300'", async () => {
    await db.admin.query(
      "INSERT INTO ot_policy (company_id, valid_from, max_month_minutes, source_note) VALUES ($1, '2026-01-01', 300, 'test đồng thời')",
      [org.companyId],
    );
    const e3 = await seedUser(org.companyId, { grants: [{ role: "employee", scopeType: "self" }] });
    await withTx((tx) =>
      assignEmployment(tx, { userId: null }, org.companyId, e3.employeeId!, {
        departmentId: org.deptId,
        validFrom: "2026-01-01",
      }),
    );
    const emp3 = (await loadActor(db.app, e3.userId))!;
    const ids: string[] = [];
    for (const day of ["02", "03", "04", "05"])
      ids.push(
        await withTx((tx) =>
          requestOt(tx, emp3, {
            businessDate: `2026-11-${day}`,
            minutes: 120,
            reason: "gấp tiến độ",
            consent: true,
          }),
        ),
      );
    const rs = await Promise.allSettled(ids.map((id) => withTx((tx) => decideOt(tx, lead, id, "approve"))));
    assert.equal(rs.filter((r) => r.status === "fulfilled").length, 2);
    for (const r of rs.filter((x) => x.status === "rejected") as PromiseRejectedResult[])
      assert.ok(isCode("OT_LIMIT_MONTH")(r.reason), String(r.reason));
    const sum = await db.admin.query(
      "SELECT sum(minutes)::int AS s FROM ot_request WHERE employee_id = $1 AND status = 'approved'",
      [emp3.employeeId],
    );
    assert.equal(sum.rows[0].s, 240);
    assert.ok(sum.rows[0].s <= 300);
  });
});

// ───────────────────────── Idempotency bằng UNIQUE + ON CONFLICT (DB-TX-004) ─────────────────────────
describe("trùng khoá idempotency xử lý bằng ON CONFLICT", () => {
  let db: TestDb;
  let companyId: string;
  before(async () => {
    db = await freshDb();
    ({ companyId } = await seedCompany());
    process.env.TRUST_PROXY = "1";
  });
  after(async () => {
    delete process.env.TRUST_PROXY;
    await db.close();
  });

  test("chấm công: 6 lần gửi cùng khoá + nội dung đồng thời → một bản ghi; khác nội dung → đúng một 409", async () => {
    const u = await seedUser(companyId);
    const actor = { userId: u.userId, companyId, employeeId: u.employeeId! };
    const key = randomUUID();
    const base = { idempotencyKey: key, kind: "in" as const, deviceTime: new Date(), source: "gps" as const };
    const same = await Promise.all(Array.from({ length: 6 }, () => recordEvent(db.app, actor, base)));
    assert.equal(new Set(same.map((r) => r.eventId)).size, 1);
    assert.equal(same.filter((r) => !r.replayed).length, 1);

    const key2 = randomUUID();
    const rs = await Promise.allSettled([
      recordEvent(db.app, actor, { ...base, idempotencyKey: key2, kind: "in" }),
      recordEvent(db.app, actor, { ...base, idempotencyKey: key2, kind: "out" }),
    ]);
    assert.equal(rs.filter((r) => r.status === "fulfilled").length, 1);
    const bad = rs.find((r) => r.status === "rejected") as PromiseRejectedResult;
    assert.ok(isCode("IDEMPOTENCY_CONFLICT")(bad.reason), String(bad.reason));
    const n = await db.admin.query(
      "SELECT count(*)::int AS n FROM attendance_event WHERE employee_id = $1 AND idempotency_key = ANY($2)",
      [u.employeeId, [key, key2]],
    );
    assert.equal(n.rows[0].n, 2);
  });

  test("liên hệ: 8 lần gửi đồng thời cùng submission_id → một hồ sơ, cùng mã, không đốt số mã", async () => {
    const input = InquiryInput.parse({
      submission_id: randomUUID(),
      name: "Khách Đồng Thời",
      email: "dongthoi@example.test",
      message: "Cần tư vấn",
      consent: true,
      elapsed_ms: 15000,
    });
    const day = new Date("2026-10-20T03:00:00Z");
    const rs = await Promise.all(
      Array.from({ length: 8 }, () => submitInquiry(db.app, companyId, input, { ip: "10.9.9.9" }, day)),
    );
    assert.equal(new Set(rs.map((r) => r.code)).size, 1);
    assert.equal(rs.filter((r) => r.created).length, 1);
    const n = await db.admin.query("SELECT count(*)::int AS n FROM inquiry WHERE submission_id = $1", [
      input.submission_id,
    ]);
    assert.equal(n.rows[0].n, 1);
    const hist = await db.admin.query(
      "SELECT count(*)::int AS n FROM inquiry_history h JOIN inquiry i ON i.id = h.inquiry_id WHERE i.submission_id = $1",
      [input.submission_id],
    );
    assert.equal(hist.rows[0].n, 1, "bên thua cuộc đua không để lại lịch sử");
    // Bên thua rollback → bộ đếm ngày không bị đốt: hồ sơ kế tiếp trong ngày là số kế tiếp liền kề.
    const next = await submitInquiry(
      db.app,
      companyId,
      InquiryInput.parse({ ...input, submission_id: randomUUID() }),
      { ip: "10.9.9.8" },
      day,
    );
    const seq = (c: string) => Number(c.slice(-4));
    assert.equal(seq(next.code), seq(rs[0]!.code) + 1);
  });

  test("ứng tuyển: gửi đồng thời cùng submission_id → một hồ sơ; honeypot vẫn giả thành công, không lưu", async () => {
    const input = ApplicationInput.parse({
      submission_id: randomUUID(),
      name: "Ứng Viên Đồng Thời",
      email: "uv@example.test",
      consent: true,
      elapsed_ms: 20000,
    });
    const rs = await Promise.all(
      Array.from({ length: 6 }, () => submitApplication(db.app, companyId, input, { ip: "10.8.8.8" })),
    );
    assert.equal(new Set(rs.map((r) => r.code)).size, 1);
    assert.equal(rs.filter((r) => r.created).length, 1);
    const spam = ApplicationInput.parse({ ...input, submission_id: randomUUID(), website: "http://bot" });
    const fake = await submitApplication(db.app, companyId, spam, { ip: "10.8.8.7" });
    assert.equal(fake.created, false);
    const n = await db.admin.query(
      "SELECT count(*)::int AS n FROM job_application WHERE submission_id = $1",
      [spam.submission_id],
    );
    assert.equal(n.rows[0].n, 0);
  });
});

// ───────────────────────── FK ON DELETE + index (DB-MODEL-004) ─────────────────────────
describe("khoá ngoại: ON DELETE tường minh + index (catalog)", () => {
  let db: TestDb;
  before(async () => {
    db = await freshDb();
  });
  after(async () => {
    await db.close();
  });

  /*
   * Cách diễn giải "tường minh": catalog không phân biệt `NO ACTION` ghi rõ với mặc định (confdeltype = 'a' cho cả hai),
   * nên quy ước dự án là: MỌI FK phải có confdeltype ≠ 'a' (RESTRICT 'r', CASCADE 'c', SET NULL 'n', SET DEFAULT 'd'),
   * trừ khi nằm trong NO_ACTION_ALLOWED kèm lý do (hiện rỗng). CASCADE chỉ cho bản ghi thuần phụ thuộc vòng đời cha và
   * phải nằm trong CASCADE_ALLOWED; không FK nào liên quan audit_event được cascade (nhật ký chỉ thêm).
   * "Có index" = tồn tại index (không phải partial) mà các cột đứng đầu của nó, theo tập, trùng đúng tập cột FK.
   */
  const NO_ACTION_ALLOWED = new Map<string, string>();
  const CASCADE_ALLOWED = new Map<string, string>([
    ["session_user_id_fkey", "phiên đăng nhập thuần phụ thuộc vòng đời tài khoản"],
  ]);

  async function foreignKeys() {
    const { rows } = await db.admin.query<{
      tbl: string;
      conname: string;
      refd: string;
      del: string;
      indexed: boolean;
    }>(`
      SELECT c.conrelid::regclass::text AS tbl, c.conname, c.confrelid::regclass::text AS refd, c.confdeltype AS del,
        EXISTS (
          SELECT 1 FROM pg_index i
          WHERE i.indrelid = c.conrelid AND i.indisvalid AND i.indpred IS NULL AND i.indnkeyatts >= cardinality(c.conkey)
            AND (SELECT array_agg(x ORDER BY x) FROM unnest((i.indkey::int2[])[0:cardinality(c.conkey) - 1]) x)
              = (SELECT array_agg(x ORDER BY x) FROM unnest(c.conkey) x)
        ) AS indexed
      FROM pg_constraint c WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace ORDER BY 1, 2`);
    return rows;
  }

  test("0 FK thiếu index", async () => {
    const missing = (await foreignKeys()).filter((f) => !f.indexed).map((f) => `${f.tbl}.${f.conname}`);
    assert.deepEqual(missing, []);
  });

  test("mọi FK khai ON DELETE khác mặc định 'a' (trừ allowlist có lý do); CASCADE chỉ trong allowlist", async () => {
    const fks = await foreignKeys();
    assert.ok(fks.length >= 70, `chỉ thấy ${fks.length} FK — catalog đọc sai?`);
    const implicit = fks
      .filter((f) => f.del === "a" && !NO_ACTION_ALLOWED.has(f.conname))
      .map((f) => f.conname);
    assert.deepEqual(implicit, []);
    const cascades = fks.filter((f) => f.del === "c").map((f) => f.conname);
    for (const c of cascades) assert.ok(CASCADE_ALLOWED.has(c), `CASCADE chưa được duyệt: ${c}`);
    assert.ok(!fks.some((f) => f.del === "c" && (f.tbl === "audit_event" || f.refd === "audit_event")));
    assert.deepEqual(cascades, ["session_user_id_fkey"], "allowlist không có mục thừa");
  });

  test("RESTRICT thật: xoá bản ghi cha còn con bị chặn; xoá user thì phiên đi theo (CASCADE)", async () => {
    const org = await seedCompany("Công ty FK");
    const u = await seedUser(org.companyId);
    await assert.rejects(
      db.admin.query("DELETE FROM employee WHERE id = $1", [u.employeeId]),
      /violates foreign key constraint|app_user_company_id_employee_id_fkey/,
    );
    await assert.rejects(db.admin.query("DELETE FROM company WHERE id = $1", [org.companyId]), /foreign key/);
    const sess = await db.admin.query(
      "SELECT 1 FROM pg_constraint WHERE conname = 'session_user_id_fkey' AND confdeltype = 'c'",
    );
    assert.equal(sess.rowCount, 1);
  });
});

// ───────────────────────── EXPLAIN đường nóng (DB-PERF-001) ─────────────────────────
describe("EXPLAIN các truy vấn lõi: không Seq Scan trên bảng lớn", () => {
  let db: TestDb;
  let companyId: string;
  let empId: string;
  let leaveTypeId: string;
  const LARGE = [
    "task",
    "attendance_event",
    "leave_request",
    "ot_request",
    "leave_ledger",
    "attendance_adjustment",
  ];
  const SEED_NOTE =
    "1.000 nhân viên · 30.000 task · 60.000 sự kiện công · 20.000 đơn nghỉ · 20.000 đơn OT · 5.000 điều chỉnh công · 40.000 bút toán phép (sau ANALYZE)";

  interface Core {
    name: string;
    from: string;
    sql: string;
    params: () => unknown[];
  }
  const CORE: Core[] = [
    {
      name: "tasks-mine",
      from: "lib/work/routes.ts MY_TASKS_SQL — danh sách việc của tôi",
      sql: MY_TASKS_SQL,
      params: () => [companyId, empId, 201, 0], // LIMIT $3 (= trần 200 + 1) OFFSET $4
    },
    {
      name: "attendance-events-today",
      from: "lib/today/index.ts TODAY_EVENTS_SQL — sự kiện công theo nhân viên + ngày",
      sql: TODAY_EVENTS_SQL,
      params: () => [empId],
    },
    {
      name: "approvals-pending",
      from: "lib/attendance/approvals.ts PENDING_APPROVALS_SQL — hàng chờ duyệt",
      sql: PENDING_APPROVALS_SQL,
      params: () => [companyId, null, null],
    },
    {
      name: "attendance-needs-review",
      from: "lib/attendance/period.ts NEEDS_REVIEW_SQL — sự kiện cần xác minh trong kỳ",
      sql: NEEDS_REVIEW_SQL,
      params: () => [companyId, "2026-01-01", "2027-12-31"],
    },
    {
      name: "leave-balance",
      from: "lib/attendance/leave.ts LEAVE_BALANCE_SQL — số dư phép",
      sql: LEAVE_BALANCE_SQL,
      params: () => [empId, leaveTypeId],
    },
  ];

  before(async () => {
    db = await freshDb();
    ({ companyId } = await seedCompany("Công ty EXPLAIN"));
    const a = db.admin;
    await a.query(
      "INSERT INTO employee (company_id, code, full_name) SELECT $1, 'PERF' || g, 'NV ' || g FROM generate_series(1, 1000) g",
      [companyId],
    );
    empId = (await a.query("SELECT id FROM employee WHERE code = 'PERF7' AND company_id = $1", [companyId]))
      .rows[0].id;
    const proj = await a.query(
      "INSERT INTO project (company_id, code, name, manager_employee_id) VALUES ($1, 'PERF', 'Hiệu năng', $2) RETURNING id",
      [companyId, empId],
    );
    leaveTypeId = (
      await a.query(
        "INSERT INTO leave_type (company_id, code, name) VALUES ($1, 'PERFPN', 'Phép') RETURNING id",
        [companyId],
      )
    ).rows[0].id;
    // Dùng một client (bảng tạm theo phiên) để join số thứ tự nhân viên.
    const c = await a.connect();
    try {
      await c.query(
        `CREATE TEMP TABLE e AS SELECT id, row_number() OVER (ORDER BY code)::int AS n FROM employee WHERE code LIKE 'PERF%' AND company_id = $1`,
        [companyId],
      );
      await c.query("CREATE INDEX ON e (n)");
      await c.query(
        `INSERT INTO task (company_id, project_id, title, responsible_employee_id, reviewer_employee_id, acceptance_criteria, status, created_by_user_id)
         SELECT $1, $2, 'T' || g, r.id, v.id, 'tiêu chí',
           CASE WHEN g % 10 = 0 THEN 'todo' WHEN g % 10 = 1 THEN 'in_progress' WHEN g % 10 = 2 THEN 'awaiting_acceptance' ELSE 'done' END,
           gen_random_uuid()
         FROM generate_series(1, 30000) g JOIN e r ON r.n = (g % 1000) + 1 JOIN e v ON v.n = ((g + 7) % 1000) + 1`,
        [companyId, proj.rows[0].id],
      );
      await c.query(
        `INSERT INTO leave_request (company_id, employee_id, leave_type_id, start_at, end_at, minutes, status, created_by_user_id, created_at)
         SELECT $1, e.id, $2, timestamptz '2026-01-01 01:00+00' + (g / 1000) * interval '1 day',
                timestamptz '2026-01-01 03:00+00' + (g / 1000) * interval '1 day', 120,
                CASE WHEN g % 40 = 0 THEN 'pending' ELSE 'approved' END, gen_random_uuid(), now() - g * interval '1 minute'
         FROM generate_series(1, 20000) g JOIN e ON e.n = (g % 1000) + 1`,
        [companyId, leaveTypeId],
      );
      await c.query(
        `INSERT INTO ot_request (company_id, employee_id, business_date, minutes, reason, employee_consent_at, status, created_by_user_id, created_at)
         SELECT $1, e.id, date '2026-01-01' + (g / 1000), 60, 'x', now(),
                CASE WHEN g % 40 = 0 THEN 'pending' ELSE 'approved' END, gen_random_uuid(), now() - g * interval '1 minute'
         FROM generate_series(1, 20000) g JOIN e ON e.n = (g % 1000) + 1`,
        [companyId],
      );
      await c.query(
        `INSERT INTO attendance_adjustment (company_id, employee_id, action, new_kind, new_at, reason, status, created_by_user_id, created_at)
         SELECT $1, e.id, 'add_event', 'in', now(), 'x', CASE WHEN g % 40 = 0 THEN 'pending' ELSE 'approved' END,
                gen_random_uuid(), now() - g * interval '1 minute'
         FROM generate_series(1, 5000) g JOIN e ON e.n = (g % 1000) + 1`,
        [companyId],
      );
      await c.query(
        `INSERT INTO attendance_event (company_id, employee_id, idempotency_key, request_hash, kind, device_time, source, status, review_reason)
         SELECT $1, e.id, 'perf-key-' || g, 'h', 'in', now() - (g / 1000) * interval '12 hours' - (g % 1000) * interval '1 second', 'gps',
                CASE WHEN g % 100 = 0 THEN 'needs_review' ELSE 'accepted' END, CASE WHEN g % 100 = 0 THEN 'CLOCK_SKEW' END
         FROM generate_series(1, 60000) g JOIN e ON e.n = (g % 1000) + 1`,
        [companyId],
      );
      await c.query(
        `INSERT INTO leave_ledger (company_id, employee_id, leave_type_id, entry_type, minutes, reason)
         SELECT $1, e.id, $2, 'accrual', 60, 'seed' FROM generate_series(1, 40000) g JOIN e ON e.n = (g % 1000) + 1`,
        [companyId, leaveTypeId],
      );
    } finally {
      c.release();
    }
    for (const t of LARGE) await a.query(`ANALYZE ${t}`);
  });
  after(async () => {
    await db.close();
  });

  interface PlanNode {
    "Node Type": string;
    "Relation Name"?: string;
    Plans?: PlanNode[];
  }
  function scans(n: PlanNode, kind: string, out: string[] = []): string[] {
    if (n["Node Type"] === kind && n["Relation Name"]) out.push(n["Relation Name"]);
    for (const c of n.Plans ?? []) scans(c, kind, out);
    return out;
  }
  const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
  const docPath = (name: string) => path.join(ROOT, "docs", "db", "explain", `${name}.txt`);

  for (const q of CORE) {
    test(
      `${q.name}: plan không Seq Scan trên bảng lớn; docs/db/explain/${q.name}.txt khớp truy vấn hiện tại`,
      { timeout: 120_000 },
      async () => {
        const j = await db.admin.query({
          text: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${q.sql}`,
          values: q.params(),
        });
        const plan = (j.rows[0]["QUERY PLAN"] as { Plan: PlanNode }[])[0]!.Plan;
        const seq = scans(plan, "Seq Scan").filter((t) => LARGE.includes(t));
        assert.deepEqual(seq, [], `Seq Scan trên bảng lớn: ${seq.join(", ")}`);
        assert.ok(JSON.stringify(plan).includes("Index"), "plan phải dùng index");

        // Bản text cho docs (ANALYZE, BUFFERS) — ghi lại khi đặt XT_WRITE_EXPLAIN=1 (cập nhật khi đổi truy vấn/index).
        if (process.env.XT_WRITE_EXPLAIN === "1") {
          const t = await db.admin.query({ text: `EXPLAIN (ANALYZE, BUFFERS) ${q.sql}`, values: q.params() });
          const body = [
            `-- ${q.name}: ${q.from}`,
            `-- Dữ liệu seed: ${SEED_NOTE}`,
            "-- Truy vấn:",
            ...q.sql.split("\n").map((l) => `--   ${l.trimEnd()}`),
            `-- Tham số: ${JSON.stringify(q.params())}`,
            "-- Lệnh: EXPLAIN (ANALYZE, BUFFERS) <truy vấn> — sinh lại bằng XT_WRITE_EXPLAIN=1 npm run test:file -- tests/db/reliability.test.ts",
            "",
            ...t.rows.map((r: { "QUERY PLAN": string }) => r["QUERY PLAN"]),
            "",
          ].join("\n");
          writeFileSync(docPath(q.name), body);
        }
        const doc = readFileSync(docPath(q.name), "utf8");
        const m = /-- Truy vấn:\n([\s\S]*?)\n-- Tham số:/.exec(doc);
        assert.ok(m, "file docs thiếu khối truy vấn");
        const recorded = collapse(
          m[1]!
            .split("\n")
            .map((l) => l.replace(/^--\s{3}/, ""))
            .join(" "),
        );
        assert.equal(
          recorded,
          collapse(q.sql),
          `docs/db/explain/${q.name}.txt lỗi thời — sinh lại bằng XT_WRITE_EXPLAIN=1`,
        );
        assert.doesNotMatch(
          doc
            .split("\n")
            .filter((l) => !l.startsWith("--"))
            .join("\n"),
          new RegExp(`Seq Scan on (${LARGE.join("|")})\\b`),
        );
      },
    );
  }

  test("bộ phát hiện hoạt động: Seq Scan trên bảng lớn bị bắt (truy vấn cột không có index)", async () => {
    const j = await db.admin.query("EXPLAIN (FORMAT JSON) SELECT id FROM task WHERE title = 'T5'");
    const plan = (j.rows[0]["QUERY PLAN"] as { Plan: PlanNode }[])[0]!.Plan;
    assert.deepEqual(scans(plan, "Seq Scan"), ["task"]);
  });
});

// ───────────────────────── Bù blob mồ côi (BASE-DATA-009) ─────────────────────────
describe("upload tệp: giao dịch lỗi → xoá bù blob", () => {
  let db: TestDb;
  let dir: string;
  let pm: ActorContext;
  let projectId: string;
  const PDF = Buffer.from("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  const blobs = () =>
    readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length;

  before(async () => {
    db = await freshDb();
    dir = mkdtempSync(path.join(tmpdir(), "xc-blob-"));
    setStorage(diskStorage(dir));
    const org = await seedCompany("Công ty Blob");
    const exec = await seedUser(org.companyId, { grants: [{ role: "executive", scopeType: "company" }] });
    const p = await seedUser(org.companyId);
    const execA = (await loadActor(db.app, exec.userId))!;
    pm = (await loadActor(db.app, p.userId))!;
    projectId = await withTx((tx) =>
      createProject(tx, execA, { code: "B", name: "B", managerEmployeeId: p.employeeId! }),
    );
  });
  after(async () => {
    setStorage(undefined);
    await db.close();
  });

  /** Pool bọc: chạy thật, nhưng ném lỗi giả khi câu lệnh khớp `match` (trước hoặc sau khi thực thi thật). */
  function flaky(match: RegExp, when: "before" | "after" = "before"): pg.Pool {
    return {
      query: (...a: unknown[]) => (db.app.query as (...x: unknown[]) => unknown)(...a),
      connect: async () => {
        const c = await db.app.connect();
        const origQuery = c.query;
        const real = c.query.bind(c) as (...x: unknown[]) => Promise<unknown>;
        (c as unknown as { query: unknown }).query = async (...a: unknown[]) => {
          const text = typeof a[0] === "string" ? a[0] : ((a[0] as { text?: string })?.text ?? "");
          if (match.test(text)) {
            if (when === "after") await real(...a);
            throw new Error("giả lỗi giữa bước");
          }
          return real(...a);
        };
        // Trả kết nối về pool thì gỡ lớp bọc, để test sau không dính lỗi giả của test trước.
        const release = c.release.bind(c);
        (c as unknown as { release: unknown }).release = (err?: boolean | Error) => {
          (c as unknown as { query: unknown }).query = origQuery;
          return release(err);
        };
        return c;
      },
    } as unknown as pg.Pool;
  }
  const input = (extra: Record<string, unknown> = {}) => ({
    objectType: "project" as const,
    objectId: projectId,
    originalName: "bien-ban.pdf",
    data: PDF,
    ...extra,
  });

  test("đường thường: có blob + bản ghi file_object", async () => {
    const before = blobs();
    const r = await uploadFile(db.app, pm, input());
    assert.equal(blobs(), before + 1);
    const n = await db.admin.query("SELECT count(*)::int AS n FROM file_object WHERE id = $1", [r.fileId]);
    assert.equal(n.rows[0].n, 1);
  });

  test("lỗi DB giữa giao dịch (INSERT document_version) → blob bị xoá, không có file_object, lỗi gốc ném lại", async () => {
    const before = blobs();
    const rows = await db.admin.query("SELECT count(*)::int AS n FROM file_object");
    await assert.rejects(uploadFile(flaky(/INSERT INTO document_version/), pm, input()), /giả lỗi giữa bước/);
    assert.equal(blobs(), before, "blob mồ côi phải được xoá bù");
    const after = await db.admin.query("SELECT count(*)::int AS n FROM file_object");
    assert.equal(after.rows[0].n, rows.rows[0].n);
  });

  test("lỗi nghiệp vụ trong giao dịch (tài liệu không thuộc đối tượng → 404) cũng xoá bù blob", async () => {
    const before = blobs();
    await assert.rejects(uploadFile(db.app, pm, input({ documentId: randomUUID() })), isCode("NOT_FOUND"));
    assert.equal(blobs(), before);
  });

  test("COMMIT báo lỗi nhưng đã áp dụng (mất kết nối sau commit) → KHÔNG xoá blob (tránh bản ghi trỏ hụt)", async () => {
    const before = blobs();
    const rows = () => db.admin.query("SELECT count(*)::int AS n FROM file_object");
    const rowsBefore = (await rows()).rows[0].n;
    await assert.rejects(uploadFile(flaky(/^COMMIT$/, "after"), pm, input()), /giả lỗi giữa bước/);
    assert.equal((await rows()).rows[0].n, rowsBefore + 1, "giao dịch đã commit thật");
    assert.equal(blobs(), before + 1);
  });

  test("xoá bù lỗi (kho lỗi) không che lỗi gốc; remove blob không tồn tại là no-op", async () => {
    const real = diskStorage(dir);
    const broken: Storage = {
      put: (d) => real.put(d),
      get: (k) => real.get(k),
      remove: async () => {
        throw new Error("kho lỗi");
      },
    };
    setStorage(broken);
    try {
      await assert.rejects(
        uploadFile(flaky(/INSERT INTO document_version/), pm, input()),
        /giả lỗi giữa bước/,
      );
    } finally {
      setStorage(real);
    }
    await real.remove("00/" + "a".repeat(40)); // không tồn tại → bỏ qua
    await assert.rejects(real.remove("../../etc/passwd"), /Khoá tệp không hợp lệ/);
  });
});
