// API thông báo trong ứng dụng (T-080): GET /api/app/notifications, POST /api/app/notifications/read — chỉ dữ liệu của chính
// người gọi (BOLA), phân trang chuẩn, 401 khi chưa đăng nhập, thân sai → 400, id của người khác không đổi gì.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { withTx } from "../../lib/db/index.ts";
import { loginHandler } from "../../lib/identity/routes.ts";
import { addNotifications } from "../../lib/notify/index.ts";
import { getNotifications, postNotificationsRead } from "../../lib/notify/routes.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { cookieFrom, PASSWORD, req, seedCompany, seedUser, setTestEnv } from "../helpers/fixtures.ts";

setTestEnv();

interface S {
  cookie: string;
  csrf: string;
}
async function login(email: string): Promise<S> {
  const r = await loginHandler(req("POST", "/api/app/auth/login", { body: { email, password: PASSWORD } }));
  assert.equal(r.status, 200);
  return { cookie: cookieFrom(r), csrf: (await r.json()).csrf_token };
}
const list = (s: S | null, qs = "") =>
  getNotifications(req("GET", `/api/app/notifications${qs}`, { cookie: s?.cookie }));
const read = (s: S | null, body: unknown, opts: { csrf?: string | null } = {}) =>
  postNotificationsRead(
    req("POST", "/api/app/notifications/read", {
      cookie: s?.cookie,
      csrf: opts.csrf === undefined ? s?.csrf : opts.csrf,
      body,
      idempotencyKey: null,
    }),
  );

interface Item {
  id: string;
  topic: string;
  ref_type: string;
  ref_id: string;
  code: string | null;
  created_at: string;
  read_at: string | null;
}

describe("API thông báo trong ứng dụng (T-080)", () => {
  let db: TestDb;
  let a: S, b: S, foreign: S;
  let aUser: string, bUser: string;
  let companyId: string;

  before(async () => {
    db = await freshDb();
    companyId = (await seedCompany()).companyId;
    const other = (await seedCompany("Công ty khác")).companyId;
    const ua = await seedUser(companyId);
    const ub = await seedUser(companyId);
    const uf = await seedUser(other);
    aUser = ua.userId;
    bUser = ub.userId;
    await withTx(async (tx) => {
      // A: 5 thông báo (sự kiện 1..5), B: 2 (sự kiện 1, 6), công ty khác: 1.
      for (let i = 1; i <= 5; i++)
        await addNotifications(
          tx,
          {
            companyId,
            topic: "task.assigned",
            refType: "task",
            refId: randomUUID(),
            code: null,
            sourceEventId: i,
          },
          i === 1 ? [ua.userId, ub.userId] : [ua.userId],
        );
      await addNotifications(
        tx,
        {
          companyId,
          topic: "application.received",
          refType: "job_application",
          refId: randomUUID(),
          code: "UV-1",
          sourceEventId: 6,
        },
        [ub.userId],
      );
      await addNotifications(
        tx,
        {
          companyId: other,
          topic: "task.assigned",
          refType: "task",
          refId: randomUUID(),
          code: null,
          sourceEventId: 7,
        },
        [uf.userId],
      );
    });
    // Thứ tự xác định: sự kiện i tạo lúc 2026-10-0i.
    await db.admin.query(
      "UPDATE notification SET created_at = make_timestamptz(2026, 10, source_event_id::int, 0, 0, 0, 'UTC')",
    );
    [a, b, foreign] = await Promise.all([login(ua.email), login(ub.email), login(uf.email)]);
  });
  after(async () => {
    await db.close();
  });

  test("chưa đăng nhập → 401 (GET và POST)", async () => {
    assert.equal((await list(null)).status, 401);
    assert.equal((await read(null, { all: true }, { csrf: null })).status, 401);
  });

  test("api1-bola GET /api/app/notifications — mỗi người chỉ thấy thông báo của mình, mới nhất trước, kèm unread; no-store", async () => {
    const ra = await list(a);
    assert.equal(ra.status, 200);
    assert.match(ra.headers.get("cache-control") ?? "", /no-store/);
    const pa = (await ra.json()) as { items: Item[]; unread: number; next_offset: number | null };
    assert.equal(pa.items.length, 5);
    assert.equal(pa.unread, 5);
    assert.equal(pa.next_offset, null);
    const days = pa.items.map((x) => new Date(x.created_at).getUTCDate());
    assert.deepEqual(days, [5, 4, 3, 2, 1]);
    assert.deepEqual(Object.keys(pa.items[0]!).sort(), [
      "code",
      "created_at",
      "id",
      "read_at",
      "ref_id",
      "ref_type",
      "topic",
    ]);

    const pb = (await (await list(b)).json()) as { items: Item[]; unread: number };
    assert.deepEqual(
      pb.items.map((x) => x.topic),
      ["application.received", "task.assigned"],
    );
    assert.equal(pb.items[0]!.code, "UV-1");
    const aIds = new Set(pa.items.map((x) => x.id));
    assert.ok(!pb.items.some((x) => aIds.has(x.id)), "không lẫn thông báo của A");

    const pf = (await (await list(foreign)).json()) as { items: Item[]; unread: number };
    assert.equal(pf.items.length, 1, "công ty khác chỉ thấy của mình");
    assert.ok(!pf.items.some((x) => aIds.has(x.id)));

    // Tham số lạ (thử xem của người khác) bị bỏ qua — vẫn chỉ của mình.
    const sneaky = (await (await list(b, `?user_id=${aUser}`)).json()) as { items: Item[] };
    assert.equal(sneaky.items.length, 2);
  });

  test("phân trang chuẩn: limit/offset, next_offset; tham số sai → 400", async () => {
    const p1 = (await (await list(a, "?limit=2")).json()) as {
      items: Item[];
      limit: number;
      offset: number;
      next_offset: number | null;
      unread: number;
    };
    assert.deepEqual([p1.items.length, p1.limit, p1.offset, p1.next_offset, p1.unread], [2, 2, 0, 2, 5]);
    const p3 = (await (await list(a, "?limit=2&offset=4")).json()) as { items: Item[]; next_offset: null };
    assert.equal(p3.items.length, 1);
    assert.equal(p3.next_offset, null);
    for (const qs of ["?limit=0", "?limit=abc", "?offset=-1", "?limit=201"])
      assert.equal((await list(a, qs)).status, 400, qs);
  });

  test("api1-bola POST /api/app/notifications/read — id của người khác không đổi gì; id của mình → đã đọc", async () => {
    const bItems = ((await (await list(b)).json()) as { items: Item[] }).items;
    const aItems = ((await (await list(a)).json()) as { items: Item[] }).items;

    // A gửi id của B (và một id không tồn tại): 200, updated 0 — không phân biệt "không tồn tại" và "của người khác".
    const r = await read(a, { ids: [...bItems.map((x) => x.id), randomUUID()] });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { updated: 0, unread: 5 });
    const still = await db.admin.query(
      "SELECT count(*)::int AS n FROM notification WHERE user_id = $1 AND read_at IS NULL",
      [bUser],
    );
    assert.equal(still.rows[0].n, 2, "thông báo của B vẫn chưa đọc");

    // Trộn id của mình và của người khác: chỉ của mình đổi.
    const r2 = await read(a, { ids: [aItems[0]!.id, aItems[1]!.id, bItems[0]!.id] });
    assert.deepEqual(await r2.json(), { updated: 2, unread: 3 });
    // Lặp lại: lũy đẳng.
    const r3 = await read(a, { ids: [aItems[0]!.id] });
    assert.deepEqual(await r3.json(), { updated: 0, unread: 3 });
    const after1 = ((await (await list(a)).json()) as { items: Item[] }).items;
    assert.ok(after1[0]!.read_at !== null && after1[2]!.read_at === null);

    // all: true chỉ đánh dấu của A.
    const r4 = await read(a, { all: true });
    assert.deepEqual(await r4.json(), { updated: 3, unread: 0 });
    const pb = (await (await list(b)).json()) as { unread: number };
    assert.equal(pb.unread, 2);
  });

  test("thân sai → 400 VALIDATION: rỗng, ids rỗng, > 100 id, id không phải uuid, all: false, trộn khoá, khoá lạ", async () => {
    const bad: unknown[] = [
      {},
      { ids: [] },
      { ids: Array.from({ length: 101 }, () => randomUUID()) },
      { ids: ["abc"] },
      { all: false },
      { all: "true" },
      { all: true, ids: [randomUUID()] },
      { ids: [randomUUID()], userId: bUser },
      [],
      null,
    ];
    for (const body of bad) {
      const r = await read(b, body);
      assert.equal(r.status, 400, JSON.stringify(body)?.slice(0, 80));
      assert.equal(((await r.json()) as { code: string }).code, "VALIDATION");
    }
    // Đúng trần 100 id vẫn hợp lệ.
    const ok = await read(b, { ids: Array.from({ length: 100 }, () => randomUUID()) });
    assert.equal(ok.status, 200);
    const pb = (await (await list(b)).json()) as { unread: number };
    assert.equal(pb.unread, 2, "thân sai không đổi gì");
  });

  test("POST không CSRF → 403, không đổi gì", async () => {
    const r = await read(b, { all: true }, { csrf: null });
    assert.equal(r.status, 403);
    const pb = (await (await list(b)).json()) as { unread: number };
    assert.equal(pb.unread, 2);
  });

  test("đồng thời: nhiều yêu cầu đánh dấu song song → tổng updated đúng bằng số chưa đọc, không đếm trùng", async () => {
    const before = ((await (await list(b)).json()) as { unread: number }).unread;
    const rs = await Promise.all([read(b, { all: true }), read(b, { all: true }), read(b, { all: true })]);
    const total = (await Promise.all(rs.map((r) => r.json() as Promise<{ updated: number }>))).reduce(
      (x, y) => x + y.updated,
      0,
    );
    assert.equal(total, before);
    assert.equal(((await (await list(b)).json()) as { unread: number }).unread, 0);
  });
});
