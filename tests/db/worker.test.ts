// Worker outbox (T-029): SKIP LOCKED, retry/backoff, DLQ, khử trùng consumer, kênh tắt → giữ pending, gửi sau.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { withTx } from "../../lib/db/index.ts";
import { enqueue } from "../../lib/outbox/index.ts";
import {
  ChannelDisabledError,
  claimEvents,
  defaultRegistry,
  nextAttemptDelay,
  PermanentJobError,
  redriveDead,
  Registry,
  runOnce,
  type Channel,
  type DeliveryMessage,
} from "../../lib/worker/index.ts";
import { BACKOFF_BASE_MS, BACKOFF_CAP_MS } from "../../lib/worker/backoff.pure.ts";
import { z } from "zod";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { setTestEnv } from "../helpers/fixtures.ts";

setTestEnv();

// Hàng mới có next_attempt_at = now() thật → mốc giả lập đặt sau đó.
const T0 = new Date(Date.now() + 3_600_000);
const inquiryPayload = () => ({ inquiryId: randomUUID(), code: "LH-1", assigneeUserId: randomUUID() });

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

describe("backoff (hàm thuần)", () => {
  test("tăng mũ, jitter trong [mũ/2, mũ], có trần", () => {
    assert.equal(nextAttemptDelay(1, 0), BACKOFF_BASE_MS / 2);
    assert.equal(nextAttemptDelay(2, 0), BACKOFF_BASE_MS);
    assert.equal(nextAttemptDelay(3, 0), BACKOFF_BASE_MS * 2);
    assert.ok(nextAttemptDelay(1, 0.999) < BACKOFF_BASE_MS);
    assert.ok(nextAttemptDelay(1, 0.999) > nextAttemptDelay(1, 0));
    assert.ok(nextAttemptDelay(3, 0.5) < nextAttemptDelay(4, 0.5));
    assert.equal(nextAttemptDelay(50, 0), BACKOFF_CAP_MS / 2);
    assert.ok(nextAttemptDelay(50, 0.9999) <= BACKOFF_CAP_MS);
    assert.ok(nextAttemptDelay(10_000, 1) <= BACKOFF_CAP_MS, "2**n tràn vẫn bị chặn ở trần");
  });
  test("ca biên: attempt 0/âm/NaN, rand ngoài khoảng/NaN", () => {
    assert.equal(nextAttemptDelay(0, 0), nextAttemptDelay(1, 0));
    assert.equal(nextAttemptDelay(-3, 0), nextAttemptDelay(1, 0));
    assert.equal(nextAttemptDelay(Number.NaN, 0), nextAttemptDelay(1, 0));
    assert.equal(nextAttemptDelay(1, -5), nextAttemptDelay(1, 0));
    assert.ok(nextAttemptDelay(1, 7) <= BACKOFF_BASE_MS);
    assert.equal(nextAttemptDelay(1, Number.NaN), nextAttemptDelay(1, 0));
  });
});

describe("worker outbox", () => {
  let db: TestDb;
  before(async () => {
    db = await freshDb();
  });
  after(async () => {
    await db.close();
  });
  const reset = async () => {
    await db.admin.query("DELETE FROM processed_message");
    await db.admin.query("DELETE FROM outbox_event");
  };
  const row = async (id: number | string) =>
    (await db.admin.query("SELECT * FROM outbox_event WHERE id = $1", [id])).rows[0];
  const add = async (topic = "inquiry.assigned", payload: unknown = inquiryPayload(), jobKey?: string) => {
    await withTx((tx) => enqueue(tx, null, topic, payload, jobKey));
    return Number((await db.admin.query("SELECT max(id) AS id FROM outbox_event")).rows[0].id);
  };

  test("hai worker song song không lấy trùng việc (SKIP LOCKED)", async () => {
    await reset();
    for (let i = 0; i < 30; i++) await add();
    const rounds = await Promise.all([
      claimEvents(db.app, 20, 60_000, T0),
      claimEvents(db.app, 20, 60_000, T0),
      claimEvents(db.app, 20, 60_000, T0),
    ]);
    const ids = rounds.flat().map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length, "không id nào bị lấy hai lần");
    assert.equal(ids.length, 30);
    const left = await db.admin.query("SELECT count(*)::int AS n FROM outbox_event WHERE status = 'pending'");
    assert.equal(left.rows[0].n, 0);
  });

  test("việc đang bị khoá bởi worker khác bị bỏ qua, không chờ", async () => {
    await reset();
    const a = await add();
    const b = await add();
    const c = await db.admin.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT id FROM outbox_event WHERE id = $1 FOR UPDATE", [a]);
      const got = await claimEvents(db.app, 10, 60_000, T0);
      assert.deepEqual(
        got.map((e) => e.id),
        [b],
      );
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });

  test("thuê hết hạn → việc kẹt ở processing được lấy lại; chưa hết hạn thì không", async () => {
    await reset();
    const id = await add();
    await claimEvents(db.app, 10, 60_000, T0);
    assert.equal((await claimEvents(db.app, 10, 60_000, new Date(T0.getTime() + 30_000))).length, 0);
    const again = await claimEvents(db.app, 10, 60_000, new Date(T0.getTime() + 61_000));
    assert.deepEqual(
      again.map((e) => [e.id, e.attempts]),
      [[id, 2]],
    );
  });

  test("chạy thành công: done, processed_at, ghi processed_message", async () => {
    await reset();
    const ch = new FakeChannel();
    const id = await add();
    const s = await runOnce({ registry: defaultRegistry(ch), now: () => T0 });
    assert.deepEqual([s.claimed, s.done], [1, 1]);
    const r = await row(id);
    assert.equal(r.status, "done");
    assert.equal(r.attempts, 1);
    assert.notEqual(r.processed_at, null);
    assert.equal(ch.sent.length, 1);
    const pm = await db.admin.query("SELECT consumer FROM processed_message WHERE event_id = $1", [id]);
    assert.deepEqual(
      pm.rows.map((x) => x.consumer),
      ["notify.inquiry"],
    );
  });

  test("lỗi tạm → thử lại với backoff, đúng lần tối đa rồi dead (giữ payload + lỗi + số lần)", async () => {
    await reset();
    let calls = 0;
    const reg = new Registry().register({
      consumer: "flaky",
      match: "inquiry.assigned",
      schema: z.object({ inquiryId: z.uuid() }).loose(),
      handle: () => {
        calls++;
        return Promise.reject(new Error("SMTP 421 tạm thời"));
      },
    });
    const payload = inquiryPayload();
    const id = await add("inquiry.assigned", payload);
    let now = T0;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const s = await runOnce({ registry: reg, now: () => now, rand: () => 0, maxAttempts: 5 });
      assert.equal(s.claimed, 1, `lần ${attempt}`);
      const r = await row(id);
      if (attempt < 5) {
        assert.equal(r.status, "pending");
        assert.equal(r.attempts, attempt);
        const wait = new Date(r.next_attempt_at).getTime() - now.getTime();
        assert.equal(wait, nextAttemptDelay(attempt, 0));
        // Chưa tới hạn → không lấy.
        assert.equal((await runOnce({ registry: reg, now: () => now })).claimed, 0);
        now = new Date(r.next_attempt_at);
      }
    }
    const dead = await row(id);
    assert.equal(dead.status, "dead");
    assert.equal(dead.attempts, 5);
    assert.equal(calls, 5);
    assert.match(dead.last_error, /SMTP 421/);
    assert.notEqual(dead.dead_at, null);
    assert.equal(dead.payload.code, "LH-1", "payload còn nguyên để redrive");
    assert.equal((await runOnce({ registry: reg, now: () => new Date(now.getTime() + 9e9) })).claimed, 0);
  });

  test("payload sai schema → dead ngay, không gọi handler, lỗi không lộ giá trị", async () => {
    await reset();
    let calls = 0;
    const reg = defaultRegistry({
      name: "x",
      enabled: () => true,
      deliver: () => {
        calls++;
        return Promise.resolve();
      },
    });
    const id = await add("inquiry.assigned", {
      inquiryId: "khong-phai-uuid-bi-mat-123",
      assigneeUserId: randomUUID(),
    });
    const s = await runOnce({ registry: reg, now: () => T0 });
    assert.equal(s.dead, 1);
    const r = await row(id);
    assert.deepEqual([r.status, r.attempts], ["dead", 1]);
    assert.match(r.last_error, /inquiryId/);
    assert.doesNotMatch(r.last_error, /bi-mat-123/);
    assert.equal(calls, 0);
  });

  test("topic lạ và payload rỗng/null → dead ngay", async () => {
    await reset();
    const a = await add("khong.co.handler", { x: 1 });
    const b = await add("application.received", null);
    const s = await runOnce({ registry: defaultRegistry(new FakeChannel()), now: () => T0 });
    assert.equal(s.dead, 2);
    assert.match((await row(a)).last_error, /không có handler/);
    assert.equal((await row(b)).status, "dead");
  });

  test("lỗi vĩnh viễn (PermanentJobError) → dead ngay ở lần 1, không retry", async () => {
    await reset();
    const reg = new Registry().register({
      consumer: "perm",
      match: /./,
      schema: z.unknown(),
      handle: () => Promise.reject(new PermanentJobError("người nhận không tồn tại (4xx)")),
    });
    const id = await add();
    await runOnce({ registry: reg, now: () => T0 });
    const r = await row(id);
    assert.deepEqual([r.status, r.attempts], ["dead", 1]);
  });

  test("handler lỗi giữa chừng → tác động DB rollback, không để processed_message mồ côi", async () => {
    await reset();
    const reg = new Registry().register({
      consumer: "half",
      match: /./,
      schema: z.unknown(),
      handle: async (tx) => {
        await tx.query("INSERT INTO outbox_event (topic, payload) VALUES ('side.effect', '{}')");
        throw new Error("hỏng sau khi ghi");
      },
    });
    const id = await add();
    await runOnce({ registry: reg, now: () => T0 });
    const n = await db.admin.query("SELECT count(*)::int AS n FROM outbox_event WHERE topic = 'side.effect'");
    assert.equal(n.rows[0].n, 0);
    const pm = await db.admin.query("SELECT count(*)::int AS n FROM processed_message WHERE event_id = $1", [
      id,
    ]);
    assert.equal(pm.rows[0].n, 0);
  });

  test("processed_message chống lặp: cùng sự kiện giao 2 lần → tác động 1 lần; UNIQUE ở DB", async () => {
    await reset();
    const ch = new FakeChannel();
    const reg = defaultRegistry(ch);
    const id = await add();
    await runOnce({ registry: reg, now: () => T0 });
    assert.equal(ch.sent.length, 1);
    // Giả lập relay at-least-once: việc quay lại pending (vd crash sau commit tác động ở hệ khác).
    await db.admin.query("UPDATE outbox_event SET status = 'pending', processed_at = NULL WHERE id = $1", [
      id,
    ]);
    const s = await runOnce({ registry: reg, now: () => T0 });
    assert.deepEqual([s.claimed, s.done], [1, 1]);
    assert.equal(ch.sent.length, 1, "tác động không lặp");
    assert.equal((await row(id)).status, "done");
    await assert.rejects(
      db.admin.query("INSERT INTO processed_message (consumer, event_id) VALUES ('notify.inquiry', $1)", [
        id,
      ]),
      /unique|duplicate/i,
    );
  });

  test("job_key: enqueue cùng khoá hai lần → một hàng; không khoá thì không khử trùng", async () => {
    await reset();
    const key = `inq-assigned:${randomUUID()}`;
    const [x, y] = [
      await withTx((tx) => enqueue(tx, null, "inquiry.assigned", inquiryPayload(), key)),
      await withTx((tx) => enqueue(tx, null, "inquiry.assigned", inquiryPayload(), key)),
    ];
    assert.deepEqual([x, y], [true, false]);
    await withTx((tx) => enqueue(tx, null, "inquiry.assigned", inquiryPayload()));
    await withTx((tx) => enqueue(tx, null, "inquiry.assigned", inquiryPayload()));
    const n = await db.admin.query("SELECT count(*)::int AS n FROM outbox_event");
    assert.equal(n.rows[0].n, 3);
  });

  test("kênh tắt → sự kiện vẫn được ghi, giữ pending (không tính lần lỗi), gửi sau khi kênh bật", async () => {
    await reset();
    const ch = new FakeChannel();
    ch.on = false;
    const reg = defaultRegistry(ch);
    const id = await add();
    const s1 = await runOnce({ registry: reg, now: () => T0, channelOffDelayMs: 1000 });
    assert.deepEqual([s1.claimed, s1.deferred, s1.dead], [1, 1, 0]);
    let r = await row(id);
    assert.deepEqual([r.status, r.attempts], ["pending", 0]);
    assert.equal(ch.sent.length, 0);
    assert.match(r.last_error, /kênh fake đang tắt/);
    // Kênh tắt nhiều vòng vẫn không bao giờ vào DLQ.
    for (let i = 1; i <= 8; i++) {
      await runOnce({ registry: reg, now: () => new Date(T0.getTime() + i * 2000), channelOffDelayMs: 1000 });
    }
    assert.equal((await row(id)).status, "pending");
    ch.on = true;
    const s2 = await runOnce({ registry: reg, now: () => new Date(T0.getTime() + 60_000) });
    assert.equal(s2.done, 1);
    r = await row(id);
    assert.equal(r.status, "done");
    assert.equal(ch.sent.length, 1);
    assert.equal(r.last_error, null);
  });

  test("redrive: dead → pending, xử lý lại được", async () => {
    await reset();
    const ch = new FakeChannel();
    const id = await add("application.received", { applicationId: "sai" });
    await runOnce({ registry: defaultRegistry(ch), now: () => T0 });
    assert.equal((await row(id)).status, "dead");
    await db.admin.query("UPDATE outbox_event SET payload = $2 WHERE id = $1", [
      id,
      JSON.stringify({ applicationId: randomUUID(), code: "UV-1" }),
    ]);
    assert.equal(await redriveDead(db.app, [id]), 1);
    assert.equal(await redriveDead(db.app, [id]), 0, "đã redrive thì không lặp");
    const s = await runOnce({ registry: defaultRegistry(ch) });
    assert.equal(s.done, 1);
  });

  test("ChannelDisabledError là lớp riêng (không phải PermanentJobError)", () => {
    assert.ok(!(new ChannelDisabledError("x") instanceof PermanentJobError));
  });
});
