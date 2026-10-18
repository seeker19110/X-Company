import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { postSync } from "../../lib/offline/sync-route.ts";
import { flush, memoryStore, newItem, type ItemResult, type QueueItem } from "../../lib/offline/queue.ts";
import { loginHandler } from "../../lib/identity/routes.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { cookieFrom, PASSWORD, req, seedCompany, seedUser, setTestEnv } from "../helpers/fixtures.ts";

setTestEnv();
interface S {
  cookie: string;
  csrf: string;
}
async function login(email: string): Promise<S> {
  const r = await loginHandler(req("POST", "/api/app/auth/login", { body: { email, password: PASSWORD } }));
  return { cookie: cookieFrom(r), csrf: (await r.json()).csrf_token };
}
const sync = (s: S, items: unknown) =>
  postSync(req("POST", "/api/app/sync", { cookie: s.cookie, csrf: s.csrf, body: { items } }));
/** Bộ gửi thật: hàng chờ (lib/offline) → handler /api/app/sync, như client trong trình duyệt. */
const sender =
  (s: S) =>
  async (items: QueueItem[]): Promise<ItemResult[]> => {
    const res = await sync(
      s,
      items.map((i) => ({ id: i.id, kind: i.kind, payload: i.payload, created_at: i.createdAt })),
    );
    if (res.status === 401) throw new Error("401");
    return (await res.json()).results;
  };

describe("đồng bộ hàng chờ /api/app/sync (T-021, AT05)", () => {
  let db: TestDb;
  let companyId: string;
  let u: Awaited<ReturnType<typeof seedUser>>;
  let s: S;

  before(async () => {
    db = await freshDb();
    ({ companyId } = await seedCompany());
    u = await seedUser(companyId, { grants: [{ role: "employee", scopeType: "self" }] });
    s = await login(u.email);
  });
  after(async () => {
    await db.close();
  });

  test("S-PWA-01: mất phản hồi sau khi server đã ghi → gửi lại cùng id → vẫn đúng 1 sự kiện, client thành confirmed", async () => {
    const store = memoryStore();
    const it = newItem(
      u.userId,
      "attendance",
      { kind: "in", device_time: new Date(Date.now() - 60 * 60_000).toISOString(), source: "gps" },
      randomUUID(),
    );
    await store.put(it);
    // Lần 1: server nhận và ghi, nhưng phản hồi mất (timeout) → client coi như lỗi mạng.
    await flush(
      store,
      async (items) => {
        await sender(s)(items);
        throw new Error("timeout");
      },
      Date.now(),
      true,
    );
    assert.equal((await store.all())[0]!.state, "pending");
    // Lần 2: gửi lại cùng id.
    await flush(store, sender(s), Date.now(), true);
    const final = (await store.all())[0]!;
    assert.equal(final.state, "confirmed");
    const n = await db.admin.query(
      "SELECT count(*)::int AS n, bool_and(queued) AS q FROM attendance_event WHERE idempotency_key = $1",
      [it.id],
    );
    assert.deepEqual(n.rows[0], { n: 1, q: true });
  });

  test("mỗi bản ghi độc lập: bản hỏng không làm hỏng bản tốt; hàng chờ quá 72 giờ → needs_review", async () => {
    const good = randomUUID();
    const old = randomUUID();
    const bad = randomUUID();
    const res = await sync(s, [
      {
        id: good,
        kind: "attendance",
        payload: { kind: "out", device_time: new Date().toISOString(), source: "gps" },
        created_at: new Date().toISOString(),
      },
      {
        id: old,
        kind: "attendance",
        payload: {
          kind: "out",
          device_time: new Date(Date.now() - 80 * 3600_000).toISOString(),
          source: "gps",
        },
        created_at: new Date().toISOString(),
      },
      {
        id: bad,
        kind: "attendance",
        payload: { kind: "nhay", device_time: "x", source: "gps" },
        created_at: new Date().toISOString(),
      },
    ]);
    assert.equal(res.status, 200);
    const r = (await res.json()).results as ItemResult[];
    const by = new Map(r.map((x) => [x.id, x]));
    assert.deepEqual(by.get(good), {
      id: good,
      ok: true,
      status: "accepted",
      reviewReason: null,
      eventId: (by.get(good) as { eventId: string }).eventId,
    });
    assert.equal((by.get(old) as { status: string }).status, "needs_review");
    assert.equal((by.get(old) as { reviewReason: string }).reviewReason, "OFFLINE_TOO_OLD");
    assert.deepEqual(
      [(by.get(bad) as { ok: boolean }).ok, (by.get(bad) as { httpStatus: number }).httpStatus],
      [false, 400],
    );
  });

  test("S-PWA-03: nhân viên nghỉ việc → bản chờ bị từ chối 403, client đánh dấu rejected, không thử lại", async () => {
    const v = await seedUser(companyId, { grants: [{ role: "employee", scopeType: "self" }] });
    const sv = await login(v.email);
    const store = memoryStore();
    await store.put(
      newItem(
        v.userId,
        "attendance",
        { kind: "in", device_time: new Date().toISOString(), source: "gps" },
        randomUUID(),
      ),
    );
    await db.admin.query("UPDATE employee SET terminated_on = current_date - 1 WHERE id = $1", [
      v.employeeId,
    ]);
    const rep = await flush(store, sender(sv), Date.now(), true);
    assert.equal(rep.rejected, 1);
    const it = (await store.all())[0]!;
    assert.deepEqual([it.state, it.lastError], ["rejected", "Hồ sơ nhân viên không còn hiệu lực"]);
    assert.equal(
      (
        await db.admin.query("SELECT count(*)::int AS n FROM attendance_event WHERE employee_id = $1", [
          v.employeeId,
        ])
      ).rows[0].n,
      0,
    );
  });

  test("phiên hết hạn → 401 cả lô, client giữ pending; lô rỗng/quá 50/sai kiểu → 400", async () => {
    const store = memoryStore();
    await store.put(
      newItem(
        u.userId,
        "attendance",
        { kind: "in", device_time: new Date().toISOString(), source: "gps" },
        randomUUID(),
      ),
    );
    const rep = await flush(store, sender({ cookie: "xc_session=het-han", csrf: "x" }), Date.now(), true);
    assert.equal(rep.networkError, true);
    assert.equal((await store.all())[0]!.state, "pending");
    assert.equal((await sync(s, [])).status, 400);
    const many = Array.from({ length: 51 }, () => ({
      id: randomUUID(),
      kind: "attendance",
      payload: {},
      created_at: new Date().toISOString(),
    }));
    assert.equal((await sync(s, many)).status, 400);
    assert.equal(
      (
        await sync(s, [
          { id: randomUUID(), kind: "approve", payload: {}, created_at: new Date().toISOString() },
        ])
      ).status,
      400,
    );
  });
});
