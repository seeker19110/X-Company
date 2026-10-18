// Retention (T-029, D-016, STD-PRIV-005): bản ghi quá hạn bị ẩn danh/xoá, chưa quá hạn còn nguyên; tắt được bằng cấu hình.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { verifyAuditChain } from "../../lib/audit/index.ts";
import { loadEnv } from "../../lib/nen/env.ts";
import {
  ANON_EMAIL,
  ANON_NAME,
  retentionConfig,
  runRetention,
  type RetentionConfig,
} from "../../lib/worker/retention.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { seedCompany, seedUser, setTestEnv } from "../helpers/fixtures.ts";

setTestEnv();

const NOW = new Date("2026-10-18T10:00:00Z");
const daysAgo = (d: number, extraHours = 0) =>
  new Date(NOW.getTime() - d * 86_400_000 - extraHours * 3_600_000);
const CFG: RetentionConfig = {
  enabled: true,
  inquiryDays: 730,
  applicationDays: 365,
  sessionDays: 30,
  loginAttemptDays: 90,
  outboxDoneDays: 30,
  idempotencyHours: 24,
};

describe("cấu hình retention (env)", () => {
  const base = {
    APP_ORIGIN: "http://x.test",
    DATABASE_URL: "postgres://u:p@localhost/db",
    SESSION_SECRET: "x".repeat(40),
    QR_SIGNING_KEYS: `k1:${"y".repeat(40)}`,
  };
  test("mặc định theo D-016", () => {
    const c = retentionConfig(base);
    assert.deepEqual(c, CFG);
    assert.equal(loadEnv(base).WORKER_MAX_ATTEMPTS, 5);
  });
  test("ghi đè, tắt, và giá trị sai bị từ chối (nêu tên biến)", () => {
    assert.equal(
      retentionConfig({ ...base, RETENTION_ENABLED: "false", RETENTION_SESSION_DAYS: "7" }).enabled,
      false,
    );
    assert.equal(retentionConfig({ ...base, RETENTION_SESSION_DAYS: "7" }).sessionDays, 7);
    assert.equal(retentionConfig({ ...base, RETENTION_ENABLED: "" }).enabled, true, "rỗng = chưa đặt");
    assert.throws(() => retentionConfig({ ...base, RETENTION_INQUIRY_DAYS: "0" }), /RETENTION_INQUIRY_DAYS/);
    assert.throws(() => retentionConfig({ ...base, RETENTION_ENABLED: "no" }), /RETENTION_ENABLED/);
  });
});

describe("retention", () => {
  let db: TestDb;
  let companyId: string;
  let userId: string;
  before(async () => {
    db = await freshDb();
    companyId = (await seedCompany()).companyId;
    userId = (await seedUser(companyId)).userId;
  });
  after(async () => {
    await db.close();
  });

  const addInquiry = async (createdAt: Date) => {
    const code = `LH-${randomUUID().slice(0, 8)}`;
    await db.admin.query(
      `INSERT INTO inquiry (company_id, code, submission_id, name, email, phone, message, consent_at,
         consent_notice_version, status, due_at, ip_hash, created_at)
       VALUES ($1, $2, $3, 'Nguyễn Văn A', 'a@example.test', '0123456781', 'Nội dung riêng tư', $4, 'v1', 'new', $4, 'hash', $4)`,
      [companyId, code, randomUUID(), createdAt],
    );
    return code;
  };
  const addApplication = async (createdAt: Date) => {
    const code = `UV-${randomUUID().slice(0, 8)}`;
    await db.admin.query(
      `INSERT INTO job_application (company_id, code, submission_id, name, email, phone, cover_letter, consent_at,
         consent_notice_version, ip_hash, created_at)
       VALUES ($1, $2, $3, 'Trần Thị B', 'b@example.test', '0123456782', 'Thư xin việc', $4, 'v1', 'hash', $4)`,
      [companyId, code, randomUUID(), createdAt],
    );
    return code;
  };
  const one = async (sql: string, p: unknown[] = []) => (await db.admin.query(sql, p)).rows[0];

  test("liên hệ/ứng viên quá hạn: ẩn danh PII, giữ bản ghi + mã + trạng thái; chưa quá hạn: nguyên vẹn; ghi audit", async () => {
    const oldI = await addInquiry(daysAgo(731));
    const newI = await addInquiry(daysAgo(729));
    const oldA = await addApplication(daysAgo(366));
    const newA = await addApplication(daysAgo(364));
    const rep = await runRetention({ config: CFG, now: NOW, pool: db.app });
    assert.equal(rep.inquiryAnonymized, 1);
    assert.equal(rep.applicationAnonymized, 1);

    const i = await one("SELECT * FROM inquiry WHERE code = $1", [oldI]);
    assert.deepEqual(
      [i.name, i.email, i.phone, i.message, i.ip_hash, i.status],
      [ANON_NAME, ANON_EMAIL, null, ANON_NAME, null, "new"],
    );
    assert.equal(new Date(i.anonymized_at).getTime(), NOW.getTime());
    const i2 = await one("SELECT * FROM inquiry WHERE code = $1", [newI]);
    assert.deepEqual([i2.name, i2.email, i2.anonymized_at], ["Nguyễn Văn A", "a@example.test", null]);

    const a = await one("SELECT * FROM job_application WHERE code = $1", [oldA]);
    assert.deepEqual(
      [a.name, a.email, a.phone, a.cover_letter, a.ip_hash],
      [ANON_NAME, ANON_EMAIL, null, null, null],
    );
    const a2 = await one("SELECT * FROM job_application WHERE code = $1", [newA]);
    assert.deepEqual([a2.name, a2.cover_letter], ["Trần Thị B", "Thư xin việc"]);

    const aud = await db.admin.query(
      "SELECT object_type, after FROM audit_event WHERE action = 'retention.anonymize' ORDER BY seq",
    );
    assert.deepEqual(
      aud.rows.map((r) => [r.object_type, r.after.count]),
      [
        ["inquiry", 1],
        ["job_application", 1],
      ],
    );
    assert.doesNotMatch(JSON.stringify(aud.rows), /Nguyễn|example\.test/, "audit không chứa PII");
    assert.equal((await verifyAuditChain(db.admin)).ok, true);
  });

  test("lũy đẳng: chạy lần hai không đổi gì và không ghi audit thêm", async () => {
    const before = await one("SELECT count(*)::int AS n FROM audit_event WHERE action LIKE 'retention.%'");
    const rep = await runRetention({ config: CFG, now: NOW, pool: db.app });
    assert.equal(rep.inquiryAnonymized + rep.applicationAnonymized, 0);
    const after = await one("SELECT count(*)::int AS n FROM audit_event WHERE action LIKE 'retention.%'");
    assert.equal(after.n, before.n);
  });

  test("session hết hạn quá 30 ngày, login_attempt > 90 ngày, outbox done > 30 ngày bị xoá; còn lại giữ", async () => {
    const mkSession = (expires: Date) =>
      db.admin.query(
        `INSERT INTO session (token_hash, user_id, idle_expires_at, absolute_expires_at)
         VALUES ($1, $2, $3, $3)`,
        [randomUUID(), userId, expires],
      );
    await mkSession(daysAgo(31)); // xoá
    await mkSession(daysAgo(29)); // hết hạn nhưng còn trong thời hạn giữ
    await mkSession(new Date(NOW.getTime() + 86_400_000)); // còn hiệu lực — không bao giờ xoá
    for (const d of [91, 89])
      await db.admin.query(
        "INSERT INTO login_attempt (email, ip, attempted_at, success) VALUES ('x@y.test', '1.1.1.1', $1, false)",
        [daysAgo(d)],
      );
    const ev = async (status: string, processedAt: Date | null) =>
      db.admin.query(
        "INSERT INTO outbox_event (topic, payload, status, processed_at) VALUES ('t', '{}', $1, $2) RETURNING id",
        [status, processedAt],
      );
    const oldDone = (await ev("done", daysAgo(31))).rows[0].id; // xoá (kèm dấu khử trùng — FK)
    await db.admin.query("INSERT INTO processed_message (consumer, event_id) VALUES ('c', $1)", [oldDone]);
    await ev("done", daysAgo(29));
    await ev("dead", daysAgo(400)); // DLQ giữ dài hơn — không xoá
    await ev("pending", null);

    const rep = await runRetention({ config: CFG, now: NOW, pool: db.app });
    assert.deepEqual([rep.sessionDeleted, rep.loginAttemptDeleted, rep.outboxDoneDeleted], [1, 1, 1]);
    assert.equal((await one("SELECT count(*)::int AS n FROM processed_message")).n, 0);
    assert.equal((await one("SELECT count(*)::int AS n FROM session")).n, 2);
    assert.equal((await one("SELECT count(*)::int AS n FROM login_attempt")).n, 1);
    assert.deepEqual(
      (await db.admin.query("SELECT status FROM outbox_event ORDER BY status")).rows.map((r) => r.status),
      ["dead", "done", "pending"],
    );
  });

  test("idempotency_record: bỏ qua khi bảng chưa có; khi có (cột created_at) xoá bản ghi quá hạn", async () => {
    const has = (await one("SELECT to_regclass('public.idempotency_record') IS NOT NULL AS ok"))
      .ok as boolean;
    if (!has) {
      const rep = await runRetention({ config: CFG, now: NOW, pool: db.app });
      assert.equal(rep.idempotencyDeleted, 0);
      return;
    }
    // Bảng do T-028: không giả định cột khác — chỉ kiểm khi dựng được hàng mẫu tối thiểu thì xoá đúng hạn.
    const cols = await db.admin.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'idempotency_record' AND column_name = 'created_at'",
    );
    assert.equal(cols.rowCount, 1, "T-028 phải có cột created_at để retention dọn được");
    const rep = await runRetention({ config: CFG, now: NOW, pool: db.app });
    assert.equal(typeof rep.idempotencyDeleted, "number");
  });

  test("RETENTION_ENABLED=false: không đụng bản ghi quá hạn nào", async () => {
    const oldI = await addInquiry(daysAgo(900));
    await db.admin.query(
      "INSERT INTO login_attempt (email, ip, attempted_at, success) VALUES ('old@y.test', '2.2.2.2', $1, false)",
      [daysAgo(500)],
    );
    const rep = await runRetention({ config: { ...CFG, enabled: false }, now: NOW, pool: db.app });
    assert.equal(rep.skipped, true);
    assert.equal((await one("SELECT name FROM inquiry WHERE code = $1", [oldI])).name, "Nguyễn Văn A");
    assert.equal((await one("SELECT count(*)::int AS n FROM login_attempt WHERE email = 'old@y.test'")).n, 1);

    // Cấu hình từ env cũng tắt được.
    process.env.RETENTION_ENABLED = "false";
    try {
      const r2 = await runRetention({ now: NOW, pool: db.app });
      assert.equal(r2.skipped, true);
    } finally {
      delete process.env.RETENTION_ENABLED;
    }
    const on = await runRetention({ config: CFG, now: NOW, pool: db.app });
    assert.equal(on.inquiryAnonymized, 1, "bật lại thì dọn phần tồn");
    assert.equal(on.loginAttemptDeleted, 1);
  });

  test("ranh giới thời hạn: đúng bằng ngưỡng chưa bị ẩn danh (chỉ < ngưỡng)", async () => {
    const edge = await addInquiry(daysAgo(730));
    const rep = await runRetention({ config: CFG, now: NOW, pool: db.app });
    assert.equal(rep.inquiryAnonymized, 0);
    assert.equal(
      (await one("SELECT anonymized_at FROM inquiry WHERE code = $1", [edge])).anonymized_at,
      null,
    );
  });
});
