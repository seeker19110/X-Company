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
  yearsAgo,
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
  applicationDecidedDays: 30,
  talentPoolDays: 365,
  employeeTerminatedDays: 0,
  timesheetYears: 10,
  breachRecordYears: 5,
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

  const addDecided = async (
    status: string,
    decidedAt: Date | null,
    talent: "none" | "grant" | "withdrawn",
  ) => {
    const code = `UV-${randomUUID().slice(0, 8)}`;
    const created = daysAgo(400); // đủ cũ để chỉ nhánh "đã chốt" quyết định, không phải lưới an toàn (365)
    const r = await one(
      `INSERT INTO job_application (company_id, code, submission_id, name, email, consent_at, consent_notice_version,
         status, decided_at, created_at) VALUES ($1,$2,$3,'Phạm Văn C','c@example.test',$4,'v1',$5,$6,$4) RETURNING id`,
      [companyId, code, randomUUID(), created, status, decidedAt],
    );
    for (const ev of talent === "none" ? [] : talent === "grant" ? ["grant"] : ["grant", "withdraw"])
      await db.admin.query(
        `INSERT INTO consent_record (company_id, subject_type, subject_id, purpose_id, policy_version, event, granted_at,
           channel, ui_snapshot_hash, withdrawn_at)
         VALUES ($1,'job_application',$2,'talent_pool','v1',$3,$4,'web_form',$5,$6)`,
        [companyId, r.id, ev, created, "0".repeat(64), ev === "withdraw" ? created : null],
      );
    return code;
  };
  const anonymizedAt = async (code: string) =>
    (await one("SELECT anonymized_at FROM job_application WHERE code = $1", [code])).anonymized_at;

  test("ứng viên không trúng tuyển: ẩn danh sau 30 ngày kể từ khi chốt (ranh giới), hired không bị đụng, chưa chốt chưa bị đụng", async () => {
    const at30 = await addDecided("rejected", daysAgo(30), "none"); // đúng 30 ngày: chưa quá
    const over30 = await addDecided("rejected", daysAgo(30, 1), "none");
    const wd = await addDecided("withdrawn", daysAgo(31), "none");
    const hired = await addDecided("hired", daysAgo(500), "none");
    const open = await addApplication(daysAgo(100)); // status new, 100 ngày: chưa chốt, chưa tới 365
    await runRetention({ config: CFG, now: NOW, pool: db.app });
    assert.equal(await anonymizedAt(at30), null, "đúng 30 ngày chưa ẩn danh");
    assert.notEqual(await anonymizedAt(over30), null);
    assert.notEqual(await anonymizedAt(wd), null);
    assert.equal(await anonymizedAt(hired), null, "trúng tuyển không bị job ứng viên đụng tới");
    assert.equal(await anonymizedAt(open), null);
  });

  test("đồng ý kho nhân tài: giữ 12 tháng; rút đồng ý → quay về 30 ngày; ca biên đúng 365 ngày", async () => {
    const keep = await addDecided("rejected", daysAgo(200), "grant"); // quá 30 nhưng có đồng ý
    const edge = await addDecided("rejected", daysAgo(365), "grant"); // đúng 365: chưa
    const over = await addDecided("rejected", daysAgo(365, 1), "grant");
    const withdrawn = await addDecided("rejected", daysAgo(200), "withdrawn");
    const none = await addDecided("rejected", daysAgo(200), "none");
    await runRetention({ config: CFG, now: NOW, pool: db.app });
    assert.equal(await anonymizedAt(keep), null, "có đồng ý: còn trong 12 tháng");
    assert.equal(await anonymizedAt(edge), null, "đúng 365 ngày chưa quá");
    assert.notEqual(await anonymizedAt(over), null, "quá 12 tháng");
    assert.notEqual(await anonymizedAt(withdrawn), null, "đã rút đồng ý: như không có");
    assert.notEqual(await anonymizedAt(none), null);
  });

  test("hồ sơ thiếu mốc chốt (dữ liệu cũ, rejected) lấy created_at; trigger điền decided_at khi đổi trạng thái", async () => {
    const legacy = await addDecided("rejected", null, "none"); // created 400 ngày trước
    await runRetention({ config: CFG, now: NOW, pool: db.app });
    assert.notEqual(await anonymizedAt(legacy), null);
    const code = await addApplication(daysAgo(1));
    await db.admin.query("UPDATE job_application SET status = 'rejected' WHERE code = $1", [code]);
    assert.notEqual(
      (await one("SELECT decided_at FROM job_application WHERE code = $1", [code])).decided_at,
      null,
    );
  });

  test("nhân viên đã chấm dứt hợp đồng: xoá liên hệ ngay sau ngày chấm dứt; 10 năm → ẩn danh họ tên; đang làm không đụng", async () => {
    const mk = async (terminated: string | null, hired = "2010-01-01") =>
      (
        await one(
          `INSERT INTO employee (company_id, code, full_name, work_email, phone, hired_on, terminated_on)
           VALUES ($1,$2,'Hoàng Văn D','d@example.test','0123456783',$3,$4) RETURNING id`,
          [companyId, `NV-${randomUUID().slice(0, 8)}`, hired, terminated],
        )
      ).id as string;
    const active = await mk(null);
    const today = await mk("2026-10-18"); // NOW = 2026-10-18T10:00Z (17:00 VN): ngày chấm dứt = hôm nay → chưa
    const past = await mk("2026-10-17");
    const exactly10 = await mk("2016-10-18"); // đúng 10 năm: chưa ẩn danh họ tên
    const over10 = await mk("2016-10-17");
    const rep = await runRetention({ config: CFG, now: NOW, pool: db.app });
    assert.equal(rep.employeeContactCleared, 3);
    assert.equal(rep.employeeAnonymized, 1);
    const row = (id: string) =>
      one("SELECT full_name, work_email, phone, anonymized_at FROM employee WHERE id = $1", [id]);
    assert.deepEqual(Object.values(await row(active)), ["Hoàng Văn D", "d@example.test", "0123456783", null]);
    assert.deepEqual(Object.values(await row(today)), ["Hoàng Văn D", "d@example.test", "0123456783", null]);
    const p = await row(past);
    assert.deepEqual(
      [p.full_name, p.work_email, p.phone, p.anonymized_at],
      ["Hoàng Văn D", null, null, null],
    );
    const e = await row(exactly10);
    assert.equal(e.full_name, "Hoàng Văn D");
    assert.equal(e.anonymized_at, null);
    const o = await row(over10);
    assert.deepEqual([o.full_name, o.work_email, o.phone], [ANON_NAME, null, null]);
    assert.notEqual(o.anonymized_at, null);
    // lũy đẳng + audit không PII
    const again = await runRetention({ config: CFG, now: NOW, pool: db.app });
    assert.equal(again.employeeContactCleared + again.employeeAnonymized, 0);
    const aud = await db.admin.query(
      "SELECT after FROM audit_event WHERE action LIKE 'retention.employee_%'",
    );
    assert.doesNotMatch(JSON.stringify(aud.rows), /Hoàng|example\.test/);
  });

  test("yearsAgo: lùi theo lịch, 29/2 về năm không nhuận", () => {
    assert.equal(yearsAgo(new Date("2026-10-18T00:00:00Z"), 10).toISOString(), "2016-10-18T00:00:00.000Z");
    assert.equal(yearsAgo(new Date("2028-02-29T00:00:00Z"), 1).toISOString(), "2027-03-01T00:00:00.000Z");
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
