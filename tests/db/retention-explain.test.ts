// AUD-PERF-002 (T-064): job retention không quét/khoá cả bảng — cột lọc thời gian có index dùng được và xoá/ẩn danh
// theo lô (mỗi lô một giao dịch + một bản ghi audit chỉ đếm). Postgres thật.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { verifyAuditChain } from "../../lib/audit/index.ts";
import { retentionConfig, runRetention, RETENTION_SELECTORS } from "../../lib/worker/retention.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { seedCompany, setTestEnv } from "../helpers/fixtures.ts";

setTestEnv();
const NOW = new Date("2026-10-18T10:00:00Z");
const old = new Date("2025-01-01T00:00:00Z");

describe("retention: index + chia lô (AUD-PERF-002)", () => {
  let db: TestDb;
  let companyId: string;
  before(async () => {
    db = await freshDb();
    companyId = (await seedCompany()).companyId;
  });
  after(async () => {
    await db.close();
  });

  test("mỗi bộ chọn của retention dùng index (enable_seqscan=off vẫn không Seq Scan trên bảng)", async () => {
    const c = await db.admin.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL enable_seqscan = off");
      for (const { table, where } of RETENTION_SELECTORS) {
        // sql-interp-allow: `table`/`where` là hằng RETENTION_SELECTORS của lib/worker/retention.ts.
        const plan = await c.query(`EXPLAIN SELECT ctid FROM ${table} WHERE ${where} LIMIT 10`, [old]);
        const text = plan.rows.map((r: { "QUERY PLAN": string }) => r["QUERY PLAN"]).join("\n");
        assert.doesNotMatch(text, /Seq Scan/, `${table}: ${where}\n${text}`);
      }
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });

  test("xoá theo lô: 25 hàng quá hạn, lô 10 → xoá đủ 25 qua 3 giao dịch, audit 3 bản ghi tổng 25; hàng còn hạn giữ", async () => {
    await db.admin.query(
      `INSERT INTO login_attempt (email, ip, attempted_at, success)
       SELECT 'lo-' || g || '@x.test', '10.0.0.1', $1, false FROM generate_series(1, 25) g`,
      [old],
    );
    await db.admin.query(
      "INSERT INTO login_attempt (email, ip, attempted_at, success) VALUES ('moi@x.test', '10.0.0.1', $1, false)",
      [NOW],
    );
    const r = await runRetention({ config: retentionConfig(), now: NOW, batchSize: 10 });
    assert.equal(r.loginAttemptDeleted, 25);
    const left = await db.admin.query("SELECT email FROM login_attempt");
    assert.deepEqual(
      left.rows.map((x: { email: string }) => x.email),
      ["moi@x.test"],
    );
    const aud = await db.admin.query(
      "SELECT (after->>'count')::int AS n FROM audit_event WHERE object_type = 'login_attempt' AND action = 'retention.purge' ORDER BY seq",
    );
    assert.deepEqual(
      aud.rows.map((x: { n: number }) => x.n),
      [10, 10, 5],
    );
    assert.equal((await verifyAuditChain(db.admin)).ok, true);
  });

  test("ẩn danh theo lô: 12 liên hệ quá hạn, lô 5 → ẩn danh đủ 12; chạy lại không đổi gì", async () => {
    for (let i = 0; i < 12; i++)
      await db.admin.query(
        `INSERT INTO inquiry (company_id, code, submission_id, name, email, message, consent_at, consent_notice_version, status, due_at, created_at)
         VALUES ($1, $2, $3, 'Khách', 'k@example.test', 'riêng', $4, 'v1', 'new', $4, $4)`,
        [companyId, `LH-${randomUUID().slice(0, 8)}`, randomUUID(), old],
      );
    const cfg = { ...retentionConfig(), inquiryDays: 30 };
    const r = await runRetention({ config: cfg, now: NOW, batchSize: 5 });
    assert.equal(r.inquiryAnonymized, 12);
    assert.equal((await runRetention({ config: cfg, now: NOW, batchSize: 5 })).inquiryAnonymized, 0);
  });
});
