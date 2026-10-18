// ARC-INT-001 / BE-API-008 / BE-REL-006: Idempotency-Key cho POST ghi nghiệp vụ + giới hạn tần suất theo user.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { postLeave, postOt } from "../../lib/attendance/request-routes.ts";
import { postComment } from "../../lib/files/routes.ts";
import { canonicalJson, setRateClockForTest } from "../../lib/http/idempotency.ts";
import { loginHandler } from "../../lib/identity/routes.ts";
import { postSync } from "../../lib/offline/sync-route.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { cookieFrom, PASSWORD, req, seedCompany, seedUser, setTestEnv } from "../helpers/fixtures.ts";

setTestEnv();
interface S {
  cookie: string;
  csrf: string;
  userId: string;
}
async function login(email: string, userId: string): Promise<S> {
  const r = await loginHandler(req("POST", "/api/app/auth/login", { body: { email, password: PASSWORD } }));
  return { cookie: cookieFrom(r), csrf: (await r.json()).csrf_token, userId };
}

describe("idempotency + giới hạn tần suất (T-028)", () => {
  let db: TestDb;
  let a: S, b: S;
  let leaveType: string;
  const leaveBody = (minutes = 240) => ({
    start_at: "2026-11-02T08:00:00+07:00",
    end_at: "2026-11-02T12:00:00+07:00",
    minutes,
  });
  const sendLeave = (s: S, key: string | null, body: Record<string, unknown>) =>
    postLeave(
      req("POST", "/api/app/leave-requests", {
        cookie: s.cookie,
        csrf: s.csrf,
        body: { ...body, leave_type_id: leaveType },
        idempotencyKey: key,
      }),
    );
  const countLeaves = async () =>
    Number((await db.admin.query("SELECT count(*) AS n FROM leave_request")).rows[0].n);
  const recordCount = async (key: string) =>
    Number(
      (await db.admin.query("SELECT count(*) AS n FROM idempotency_record WHERE key = $1", [key])).rows[0].n,
    );

  before(async () => {
    db = await freshDb();
    const org = await seedCompany();
    const ua = await seedUser(org.companyId);
    const ub = await seedUser(org.companyId);
    leaveType = (
      await db.admin.query(
        "INSERT INTO leave_type (company_id, code, name, requires_balance) VALUES ($1, 'KL', 'Không lương', false) RETURNING id",
        [org.companyId],
      )
    ).rows[0].id;
    a = await login(ua.email, ua.userId);
    b = await login(ub.email, ub.userId);
  });
  after(async () => {
    await db.close();
  });

  test("canonicalJson: thứ tự khoá không ảnh hưởng; mảng giữ thứ tự; null/rỗng", () => {
    assert.equal(
      canonicalJson({ b: 1, a: [2, { d: null, c: "é" }] }),
      canonicalJson({ a: [2, { c: "é", d: null }], b: 1 }),
    );
    assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
    assert.equal(canonicalJson(null), "null");
    assert.equal(canonicalJson({}), "{}");
  });

  test("thiếu / sai định dạng khoá → 400 IDEMPOTENCY_KEY_REQUIRED (problem+json), không ghi gì", async () => {
    for (const key of [null, "", "ngan", "co khoang trang 123", "x".repeat(256)]) {
      const r = await sendLeave(a, key, leaveBody());
      assert.equal(r.status, 400, String(key));
      assert.match(r.headers.get("content-type") ?? "", /application\/problem\+json/);
      assert.equal((await r.json()).code, "IDEMPOTENCY_KEY_REQUIRED");
    }
    assert.equal(await countLeaves(), 0);
  });

  test("lặp cùng khoá + cùng payload (kể cả khác thứ tự khoá) → đúng phản hồi cũ, chỉ 1 bản ghi", async () => {
    const key = randomUUID();
    const r1 = await sendLeave(a, key, leaveBody());
    assert.equal(r1.status, 201);
    const text1 = await r1.text();
    const reordered = Object.fromEntries(Object.entries(leaveBody()).reverse());
    const r2 = await sendLeave(a, key, reordered);
    assert.equal(r2.status, 201);
    assert.equal(await r2.text(), text1);
    assert.equal(r2.headers.get("idempotent-replayed"), "true");
    assert.equal(r1.headers.get("idempotent-replayed"), null);
    assert.equal(await countLeaves(), 1);
    const rec = (
      await db.admin.query(
        "SELECT state, response_status, expires_at - created_at >= interval '24 hours' AS ttl_ok FROM idempotency_record WHERE key = $1",
        [key],
      )
    ).rows;
    assert.equal(rec.length, 1);
    assert.equal(rec[0].state, "done");
    assert.equal(rec[0].response_status, 201);
    assert.equal(rec[0].ttl_ok, true, "TTL >= 24h");
  });

  test("cùng khoá khác payload (hoặc khác route) → 422 IDEMPOTENCY_KEY_REUSED, không ghi thêm", async () => {
    const key = randomUUID();
    assert.equal((await sendLeave(a, key, leaveBody(240))).status, 201);
    const n = await countLeaves();
    const r = await sendLeave(a, key, leaveBody(120));
    assert.equal(r.status, 422);
    assert.equal((await r.json()).code, "IDEMPOTENCY_KEY_REUSED");
    assert.equal(await countLeaves(), n);
    const ot = await postOt(
      req("POST", "/api/app/ot-requests", {
        cookie: a.cookie,
        csrf: a.csrf,
        body: leaveBody(240),
        idempotencyKey: key,
      }),
    );
    assert.equal(ot.status, 422);
  });

  test("đồng thời 2 request cùng khoá → chỉ 1 ghi (bên kia 409 đang xử lý hoặc phát lại)", async () => {
    const key = randomUUID();
    const n = await countLeaves();
    const rs = await Promise.all([sendLeave(a, key, leaveBody(111)), sendLeave(a, key, leaveBody(111))]);
    const statuses = rs.map((r) => r.status).sort();
    assert.ok(statuses.includes(201), JSON.stringify(statuses));
    for (const r of rs) assert.ok([201, 409].includes(r.status), String(r.status));
    assert.equal((await countLeaves()) - n, 1);
    for (const r of rs.filter((x) => x.status === 409)) {
      assert.equal((await r.json()).code, "IDEMPOTENCY_IN_PROGRESS");
      assert.ok(r.headers.get("retry-after"));
    }
  });

  test("đang xử lý còn mới → 409; processing quá hạn (tiến trình chết) → chạy lại được", async () => {
    // Lấy hash thật của payload bằng một khoá thăm dò, rồi dựng bản ghi processing cùng hash.
    const probe = randomUUID();
    await sendLeave(a, probe, leaveBody(78));
    const key = randomUUID();
    await db.admin.query(
      `INSERT INTO idempotency_record (company_id, user_id, key, request_hash, state)
       SELECT company_id, user_id, $2, request_hash, 'processing' FROM idempotency_record WHERE key = $1`,
      [probe, key],
    );
    const busy = await sendLeave(a, key, leaveBody(78));
    assert.equal(busy.status, 409);
    assert.equal((await busy.json()).code, "IDEMPOTENCY_IN_PROGRESS");
    await db.admin.query(
      "UPDATE idempotency_record SET created_at = now() - interval '10 minutes' WHERE key = $1",
      [key],
    );
    assert.equal((await sendLeave(a, key, leaveBody(78))).status, 201);
  });

  test("phản hồi lỗi không bị lưu: sửa payload rồi gửi lại cùng khoá được", async () => {
    const key = randomUUID();
    const bad = await sendLeave(a, key, { ...leaveBody(), minutes: -5 });
    assert.equal(bad.status, 400);
    assert.equal(await recordCount(key), 0);
    assert.equal((await sendLeave(a, key, leaveBody(95))).status, 201);
  });

  test("khoá hết hạn (TTL) → coi như khoá mới", async () => {
    const key = randomUUID();
    const n = await countLeaves();
    assert.equal((await sendLeave(a, key, leaveBody(97))).status, 201);
    await db.admin.query(
      "UPDATE idempotency_record SET expires_at = now() - interval '1 second' WHERE key = $1",
      [key],
    );
    assert.equal((await sendLeave(a, key, leaveBody(97))).status, 201);
    assert.equal((await countLeaves()) - n, 2);
  });

  test("khoá của user A không dùng được cho user B (mỗi người một không gian khoá)", async () => {
    const key = randomUUID();
    const ra = await sendLeave(a, key, leaveBody(61));
    const rb = await sendLeave(b, key, leaveBody(61));
    assert.equal(ra.status, 201);
    assert.equal(rb.status, 201);
    assert.notEqual((await ra.json()).id, (await rb.json()).id);
    assert.equal(rb.headers.get("idempotent-replayed"), null);
    assert.equal(await recordCount(key), 2);
    // B khác payload với khoá của A vẫn không bị 422: khoá của A không tồn tại với B
    const other = await sendLeave(b, key, leaveBody(62));
    assert.equal(other.status, 422); // ... mà là xung đột với khoá CỦA CHÍNH B
  });

  test("giới hạn tần suất: vượt ngưỡng → 429 + Retry-After; theo từng user", async (t) => {
    // Cố định đồng hồ giữa một cửa sổ phút: 61 lượt không vắt qua ranh giới (trước đây flake khi chạy cả bộ).
    setRateClockForTest(() => new Date("2026-10-18T10:00:30Z"));
    t.after(() => setRateClockForTest(null));
    const comment = (s: S) =>
      postComment(
        req("POST", "/api/app/comments", {
          cookie: s.cookie,
          csrf: s.csrf,
          body: { object_type: "task", object_id: randomUUID(), body: "x" },
        }),
      );
    let last: Response | undefined;
    for (let i = 0; i < 60; i++) {
      last = await comment(b);
      assert.notEqual(last.status, 429, `lượt ${i + 1}`);
    }
    last = await comment(b);
    assert.equal(last.status, 429);
    const ra = Number(last.headers.get("retry-after"));
    assert.ok(ra >= 1 && ra <= 60, String(ra));
    assert.equal((await last.json()).code, "RATE_LIMITED");
    assert.notEqual((await comment(a)).status, 429); // người khác không bị ảnh hưởng
  });

  test("sync giới hạn theo user nhưng không đòi Idempotency-Key header (khoá theo id bản ghi)", async (t) => {
    setRateClockForTest(() => new Date("2026-10-18T11:00:30Z"));
    t.after(() => setRateClockForTest(null));
    const sync = (s: S) =>
      postSync(
        req("POST", "/api/app/sync", {
          cookie: s.cookie,
          csrf: s.csrf,
          body: { items: [] },
          idempotencyKey: null,
        }),
      );
    const r = await sync(a); // items rỗng → 400 VALIDATION (không phải 400 thiếu khoá)
    assert.equal(r.status, 400);
    assert.equal((await r.json()).code, "VALIDATION");
    for (let i = 0; i < 59; i++) await sync(a);
    assert.equal((await sync(a)).status, 429);
  });
});
