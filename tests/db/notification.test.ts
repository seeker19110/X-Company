// Thông báo trong ứng dụng (T-080, D-058; SPEC-work W3/AT11): worker ghi đúng người nhận theo topic, lũy đẳng (kể cả hai
// worker song song), rút đồng ý → không báo, tài khoản vô hiệu → bỏ qua, retention xoá đúng hạn. Postgres thật.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, test } from "node:test";
import { SYSTEM_ACTOR } from "../../lib/authz/index.ts";
import { withTx } from "../../lib/db/index.ts";
import { createEmployee } from "../../lib/org/index.ts";
import { enqueue } from "../../lib/outbox/index.ts";
import { recordConsent, withdrawConsent } from "../../lib/privacy/consent.ts";
import { addNotifications, markRead, unreadCount, usersWhoCan } from "../../lib/notify/index.ts";
import { defaultRegistry, runOnce, type Channel, type DeliveryMessage } from "../../lib/worker/index.ts";
import {
  NOTIFICATION_READ_DAYS,
  NOTIFICATION_UNREAD_DAYS,
  retentionConfig,
  runRetention,
} from "../../lib/worker/retention.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { seedCompany, seedUser, setTestEnv } from "../helpers/fixtures.ts";

setTestEnv();

const T0 = new Date(Date.now() + 3_600_000);

class FakeChannel implements Channel {
  readonly name = "fake";
  on = true;
  sent: DeliveryMessage[] = [];
  enabled = () => this.on;
  deliver(msg: DeliveryMessage): Promise<void> {
    this.sent.push(msg);
    return Promise.resolve();
  }
}

describe("thông báo trong ứng dụng (worker)", () => {
  let db: TestDb;
  let companyId: string;
  let otherCompanyId: string;
  let deptId: string;
  before(async () => {
    db = await freshDb();
    const org = await seedCompany();
    companyId = org.companyId;
    deptId = org.deptId;
    otherCompanyId = (await seedCompany("Công ty khác")).companyId;
  });
  after(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.admin.query("DELETE FROM notification");
    await db.admin.query("DELETE FROM processed_message");
    await db.admin.query("DELETE FROM outbox_event");
  });

  const add = async (company: string | null, topic: string, payload: unknown) => {
    await withTx((tx) => enqueue(tx, company, topic, payload));
    return Number((await db.admin.query("SELECT max(id) AS id FROM outbox_event")).rows[0].id);
  };
  const run = (ch = new FakeChannel()) => runOnce({ registry: defaultRegistry(ch), now: () => T0 });
  const notes = async () =>
    (
      await db.admin.query<{
        user_id: string;
        topic: string;
        ref_type: string;
        ref_id: string;
        code: string | null;
        source_event_id: string;
        company_id: string;
      }>(
        "SELECT user_id, topic, ref_type, ref_id, code, source_event_id, company_id FROM notification ORDER BY user_id",
      )
    ).rows;
  const status = async (id: number) =>
    (await db.admin.query("SELECT status FROM outbox_event WHERE id = $1", [id])).rows[0].status;

  test("inquiry.assigned → chỉ người được phân công; lưu mã, không PII; kênh phụ vẫn giao", async () => {
    const a = await seedUser(companyId, { grants: [{ role: "sales", scopeType: "company" }] });
    await seedUser(companyId, { grants: [{ role: "sales", scopeType: "company" }] });
    const inquiryId = randomUUID();
    const ch = new FakeChannel();
    const id = await add(companyId, "inquiry.assigned", {
      inquiryId,
      code: "LH-7",
      assigneeUserId: a.userId,
    });
    const s = await run(ch);
    assert.equal(s.done, 1);
    assert.equal(await status(id), "done");
    assert.deepEqual(await notes(), [
      {
        user_id: a.userId,
        topic: "inquiry.assigned",
        ref_type: "inquiry",
        ref_id: inquiryId,
        code: "LH-7",
        source_event_id: String(id),
        company_id: companyId,
      },
    ]);
    assert.equal(ch.sent.length, 1, "kênh phụ (log) vẫn nhận sự kiện");
  });

  test("AUD-SEC-009: inquiry.assigned kiểm lại quyền inquiry.manage lúc worker xử lý — grant bị thu hồi/hết hạn/chỉ phạm vi phòng ban/không có grant → không báo; còn quyền → báo", async () => {
    const ok = await seedUser(companyId, { grants: [{ role: "sales", scopeType: "company" }] });
    const revoked = await seedUser(companyId, { grants: [{ role: "sales", scopeType: "company" }] });
    const expired = await seedUser(companyId, { grants: [{ role: "sales", scopeType: "company" }] });
    const deptScoped = await seedUser(companyId, {
      grants: [{ role: "sales", scopeType: "department", scopeId: deptId }],
    });
    const noGrant = await seedUser(companyId);
    const ids = [];
    for (const u of [ok, revoked, expired, deptScoped, noGrant])
      ids.push(
        await add(companyId, "inquiry.assigned", { inquiryId: randomUUID(), assigneeUserId: u.userId }),
      );
    // Thu hồi SAU khi phân công, trước khi worker chạy.
    await db.admin.query("UPDATE role_grant SET revoked_at = now() WHERE user_id = $1", [revoked.userId]);
    await db.admin.query(
      "UPDATE role_grant SET valid_from = now() - interval '2 day', valid_to = now() - interval '1 day' WHERE user_id = $1",
      [expired.userId],
    );
    const s = await run();
    assert.equal(s.done, 5, "mọi sự kiện đều đóng (kể cả không có người nhận)");
    for (const id of ids) assert.equal(await status(id), "done");
    assert.deepEqual(
      (await notes()).map((r) => r.user_id),
      [ok.userId],
    );
  });

  test("inquiry.assigned không mã (gán lại thủ công) → code NULL", async () => {
    const a = await seedUser(companyId, { grants: [{ role: "sales", scopeType: "company" }] });
    await add(companyId, "inquiry.assigned", { inquiryId: randomUUID(), assigneeUserId: a.userId });
    await run();
    const rows = await notes();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.code, null);
  });

  test("lũy đẳng: chạy lại cùng sự kiện (redrive sau khi mất dấu processed_message) không tạo bản trùng", async () => {
    const a = await seedUser(companyId, { grants: [{ role: "sales", scopeType: "company" }] });
    const id = await add(companyId, "inquiry.assigned", {
      inquiryId: randomUUID(),
      assigneeUserId: a.userId,
    });
    await run();
    // Giả lập chạy lại sự kiện đã xử lý: xoá dấu khử trùng consumer và đưa về pending.
    await db.admin.query("DELETE FROM processed_message WHERE event_id = $1", [id]);
    await db.admin.query(
      "UPDATE outbox_event SET status = 'pending', next_attempt_at = now() WHERE id = $1",
      [id],
    );
    assert.equal((await run()).done, 1);
    assert.equal((await notes()).length, 1);
  });

  test("đồng thời: hai giao dịch thêm cùng (sự kiện, người nhận) song song → đúng một hàng", async () => {
    const a = await seedUser(companyId);
    const n = {
      companyId,
      topic: "task.assigned",
      refType: "task" as const,
      refId: randomUUID(),
      code: null,
      sourceEventId: 987_654,
    };
    const counts = await Promise.all([
      withTx((tx) => addNotifications(tx, n, [a.userId, a.userId])),
      withTx((tx) => addNotifications(tx, n, [a.userId])),
      withTx((tx) => addNotifications(tx, n, [a.userId])),
    ]);
    assert.equal(
      counts.reduce((x, y) => x + y, 0),
      1,
    );
    assert.equal((await notes()).length, 1);
    assert.equal(await withTx((tx) => addNotifications(tx, n, [])), 0, "danh sách rỗng → không ghi");
  });

  test("đồng thời: hai worker chạy song song trên nhiều sự kiện → mỗi (sự kiện, người) đúng một hàng", async () => {
    const a = await seedUser(companyId, { grants: [{ role: "sales", scopeType: "company" }] });
    for (let i = 0; i < 8; i++)
      await add(companyId, "inquiry.assigned", { inquiryId: randomUUID(), assigneeUserId: a.userId });
    const [r1, r2] = await Promise.all([run(), run()]);
    assert.equal(r1.done + r2.done, 8);
    const rows = await notes();
    assert.equal(rows.length, 8);
    assert.equal(new Set(rows.map((r) => r.source_event_id)).size, 8);
  });

  test("task.* → tài khoản của nhân viên bị ảnh hưởng; trừ người thao tác, nhân viên không có tài khoản, tài khoản vô hiệu", async () => {
    const resp = await seedUser(companyId);
    const rev = await seedUser(companyId);
    const by = await seedUser(companyId);
    const off = await seedUser(companyId);
    await db.admin.query("UPDATE app_user SET disabled_at = now() WHERE id = $1", [off.userId]);
    const noAccount = await withTx((tx) =>
      createEmployee(tx, SYSTEM_ACTOR, companyId, {
        code: `NA-${randomUUID().slice(0, 6)}`,
        fullName: "Không tài khoản",
      }),
    );
    const taskId = randomUUID();
    await add(companyId, "task.submit", {
      taskId,
      employeeIds: [resp.employeeId, rev.employeeId, by.employeeId, off.employeeId, noAccount],
      byUserId: by.userId,
    });
    await run();
    const rows = await notes();
    assert.deepEqual(rows.map((r) => r.user_id).sort(), [resp.userId, rev.userId].sort());
    assert.ok(rows.every((r) => r.topic === "task.submit" && r.ref_type === "task" && r.ref_id === taskId));
    assert.ok(rows.every((r) => r.code === null));
  });

  test("task.* với nhân viên công ty khác trong payload → không báo chéo công ty", async () => {
    const foreign = await seedUser(otherCompanyId);
    const by = await seedUser(companyId);
    await add(companyId, "task.assigned", {
      taskId: randomUUID(),
      employeeIds: [foreign.employeeId],
      byUserId: by.userId,
    });
    assert.equal((await run()).done, 1);
    assert.deepEqual(await notes(), []);
  });

  test("application.received → người đang có quyền application.read (HR cả công ty); không: HR phạm vi phòng ban, vai khác, grant thu hồi/hết hạn, tài khoản vô hiệu, công ty khác", async () => {
    const hr = await seedUser(companyId, { grants: [{ role: "hr", scopeType: "company" }] });
    const hrDept = await seedUser(companyId, {
      grants: [{ role: "hr", scopeType: "department", scopeId: deptId }],
    });
    const sales = await seedUser(companyId, { grants: [{ role: "sales", scopeType: "company" }] });
    const revoked = await seedUser(companyId, { grants: [{ role: "hr", scopeType: "company" }] });
    await db.admin.query("UPDATE role_grant SET revoked_at = now() WHERE user_id = $1", [revoked.userId]);
    const expired = await seedUser(companyId, { grants: [{ role: "hr", scopeType: "company" }] });
    await db.admin.query(
      "UPDATE role_grant SET valid_from = now() - interval '2 day', valid_to = now() - interval '1 day' WHERE user_id = $1",
      [expired.userId],
    );
    const disabled = await seedUser(companyId, { grants: [{ role: "hr", scopeType: "company" }] });
    await db.admin.query("UPDATE app_user SET disabled_at = now() WHERE id = $1", [disabled.userId]);
    const foreignHr = await seedUser(otherCompanyId, { grants: [{ role: "hr", scopeType: "company" }] });

    // Cùng quyết định với route: ai qua được can("application.read") thì được báo.
    assert.deepEqual(await usersWhoCan(db.app, "application.read", { companyId }), [hr.userId]);

    const applicationId = randomUUID();
    await add(companyId, "application.received", { applicationId, code: "UV-9" });
    await run();
    const rows = await notes();
    assert.deepEqual(
      rows.map((r) => r.user_id),
      [hr.userId],
    );
    assert.equal(rows[0]!.ref_type, "job_application");
    assert.equal(rows[0]!.code, "UV-9");
    for (const u of [hrDept, sales, revoked, expired, disabled, foreignHr])
      assert.ok(!rows.some((r) => r.user_id === u.userId));
  });

  test("chủ thể đã rút đồng ý → không báo (cả trong ứng dụng lẫn kênh phụ), sự kiện vẫn đóng", async () => {
    const hr = await seedUser(companyId, { grants: [{ role: "hr", scopeType: "company" }] });
    const assignee = await seedUser(companyId, { grants: [{ role: "sales", scopeType: "company" }] });
    const applicationId = randomUUID();
    const inquiryId = randomUUID();
    await withTx(async (tx) => {
      for (const [type, id, purpose] of [
        ["job_application", applicationId, "job_application"],
        ["inquiry", inquiryId, "inquiry_contact"],
      ] as const) {
        await recordConsent(tx, {
          companyId,
          subjectType: type,
          subjectId: id,
          purposeId: purpose,
          policyVersion: "v1",
          channel: "test",
          at: new Date(),
        });
        await withdrawConsent(tx, companyId, type, id, new Date(), "test");
      }
    });
    const ch = new FakeChannel();
    const a = await add(companyId, "application.received", { applicationId, code: "UV-1" });
    const b = await add(companyId, "inquiry.assigned", { inquiryId, assigneeUserId: assignee.userId });
    assert.equal((await run(ch)).done, 2);
    assert.deepEqual([await status(a), await status(b)], ["done", "done"]);
    assert.deepEqual(await notes(), []);
    assert.equal(ch.sent.length, 0);
    assert.ok(
      (await usersWhoCan(db.app, "application.read", { companyId })).includes(hr.userId),
      "HR có quyền nhưng không được báo",
    );
  });

  test("người được phân công đã bị vô hiệu / không tồn tại / khác công ty → bỏ qua, sự kiện đóng", async () => {
    const off = await seedUser(companyId);
    await db.admin.query("UPDATE app_user SET disabled_at = now() WHERE id = $1", [off.userId]);
    const foreign = await seedUser(otherCompanyId);
    const ids = [
      await add(companyId, "inquiry.assigned", { inquiryId: randomUUID(), assigneeUserId: off.userId }),
      await add(companyId, "inquiry.assigned", { inquiryId: randomUUID(), assigneeUserId: randomUUID() }),
      await add(companyId, "inquiry.assigned", { inquiryId: randomUUID(), assigneeUserId: foreign.userId }),
    ];
    assert.equal((await run()).done, 3);
    for (const id of ids) assert.equal(await status(id), "done");
    assert.deepEqual(await notes(), []);
  });

  test("sự kiện không gắn công ty → không thông báo trong ứng dụng, kênh phụ vẫn giao", async () => {
    const a = await seedUser(companyId);
    const ch = new FakeChannel();
    await add(null, "inquiry.assigned", { inquiryId: randomUUID(), assigneeUserId: a.userId });
    assert.equal((await run(ch)).done, 1);
    assert.deepEqual(await notes(), []);
    assert.equal(ch.sent.length, 1);
  });

  test("kênh phụ tắt → giao dịch hoãn: chưa có thông báo; bật lại → có đúng một", async () => {
    const a = await seedUser(companyId, { grants: [{ role: "sales", scopeType: "company" }] });
    const ch = new FakeChannel();
    ch.on = false;
    const id = await add(companyId, "inquiry.assigned", {
      inquiryId: randomUUID(),
      assigneeUserId: a.userId,
    });
    assert.equal((await runOnce({ registry: defaultRegistry(ch), now: () => T0 })).deferred, 1);
    assert.deepEqual(await notes(), []);
    ch.on = true;
    await runOnce({ registry: defaultRegistry(ch), now: () => new Date(T0.getTime() + 3_600_000) });
    assert.equal(await status(id), "done");
    assert.equal((await notes()).length, 1);
  });

  test("đánh dấu đã đọc: chỉ của mình; giữ mốc cũ (lũy đẳng); 'all' và danh sách rỗng", async () => {
    const a = await seedUser(companyId);
    const b = await seedUser(companyId);
    const base = { companyId, topic: "task.assigned", refType: "task" as const, code: null };
    await withTx(async (tx) => {
      await addNotifications(tx, { ...base, refId: randomUUID(), sourceEventId: 1 }, [a.userId, b.userId]);
      await addNotifications(tx, { ...base, refId: randomUUID(), sourceEventId: 2 }, [a.userId]);
    });
    const bIds = (
      await db.admin.query("SELECT id FROM notification WHERE user_id = $1", [b.userId])
    ).rows.map((r: { id: string }) => r.id);
    assert.equal(await markRead(db.app, companyId, a.userId, bIds), 0, "id của người khác không đổi gì");
    assert.equal(await unreadCount(db.app, companyId, b.userId), 1);
    assert.equal(await markRead(db.app, companyId, a.userId, []), 0);
    const first = new Date("2026-10-01T00:00:00Z");
    assert.equal(await markRead(db.app, companyId, a.userId, "all", first), 2);
    assert.equal(await markRead(db.app, companyId, a.userId, "all", new Date()), 0);
    const r = await db.admin.query("SELECT read_at FROM notification WHERE user_id = $1", [a.userId]);
    assert.ok(r.rows.every((x: { read_at: Date }) => x.read_at.getTime() === first.getTime()));
    assert.equal(await unreadCount(db.app, companyId, a.userId), 0);
    assert.equal(await unreadCount(db.app, otherCompanyId, b.userId), 0, "lọc theo công ty");
  });
});

describe("retention thông báo", () => {
  let db: TestDb;
  let companyId: string;
  let userId: string;
  const NOW = new Date("2026-10-18T10:00:00Z");
  const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
  before(async () => {
    db = await freshDb();
    companyId = (await seedCompany()).companyId;
    userId = (await seedUser(companyId)).userId;
  });
  after(async () => {
    await db.close();
  });

  test(`đã đọc > ${NOTIFICATION_READ_DAYS} ngày và chưa đọc > ${NOTIFICATION_UNREAD_DAYS} ngày bị xoá theo lô; còn hạn giữ; chạy lại = 0`, async () => {
    let ev = 0;
    const put = async (label: string, createdAt: Date, readAt: Date | null) =>
      db.admin.query(
        `INSERT INTO notification (company_id, user_id, topic, ref_type, ref_id, code, source_event_id, created_at, read_at)
         VALUES ($1, $2, 'task.assigned', 'task', $3, $4, $5, $6, $7)`,
        [companyId, userId, randomUUID(), label, ++ev, createdAt, readAt],
      );
    // Quá hạn: đã đọc 91 ngày trước (×3, để thử chia lô), chưa đọc tạo 366 ngày trước.
    for (let i = 0; i < 3; i++) await put("doc-cu", daysAgo(400), daysAgo(NOTIFICATION_READ_DAYS + 1));
    await put("chua-doc-cu", daysAgo(NOTIFICATION_UNREAD_DAYS + 1), null);
    // Còn hạn: đã đọc 89 ngày trước (dù tạo đã lâu), chưa đọc tạo 364 ngày trước.
    await put("doc-moi", daysAgo(500), daysAgo(NOTIFICATION_READ_DAYS - 1));
    await put("chua-doc-moi", daysAgo(NOTIFICATION_UNREAD_DAYS - 1), null);

    const r = await runRetention({ config: retentionConfig(), now: NOW, batchSize: 2 });
    assert.equal(r.notificationDeleted, 4);
    const left = await db.admin.query("SELECT code FROM notification ORDER BY code");
    assert.deepEqual(
      left.rows.map((x: { code: string }) => x.code),
      ["chua-doc-moi", "doc-moi"],
    );
    const aud = await db.admin.query(
      "SELECT sum((after->>'count')::int)::int AS n FROM audit_event WHERE object_type = 'notification' AND action = 'retention.purge'",
    );
    assert.equal(aud.rows[0].n, 4, "audit chỉ đếm");
    assert.equal(
      (await runRetention({ config: retentionConfig(), now: NOW, batchSize: 2 })).notificationDeleted,
      0,
    );
  });

  test("retention tắt → không xoá thông báo", async () => {
    await db.admin.query(
      `INSERT INTO notification (company_id, user_id, topic, ref_type, ref_id, source_event_id, created_at, read_at)
       VALUES ($1, $2, 'task.assigned', 'task', $3, 999, $4, $4)`,
      [companyId, userId, randomUUID(), daysAgo(1000)],
    );
    const r = await runRetention({ config: { ...retentionConfig(), enabled: false }, now: NOW });
    assert.equal(r.skipped, true);
    assert.equal(r.notificationDeleted, 0);
    assert.equal(
      (await db.admin.query("SELECT 1 FROM notification WHERE source_event_id = 999")).rowCount,
      1,
    );
  });
});
