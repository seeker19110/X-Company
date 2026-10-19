// HTTP quyền chủ thể dữ liệu (T-040): 401/403 (BFLA), BOLA giữa công ty, Idempotency-Key, luồng tạo → bắt đầu → xử lý → xuất.
// Tên test TĨNH, có tag api1-bola/api5-bfla và "METHOD /api/app/<mẫu>" để `npm run check:authz` đối chiếu.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { loginHandler } from "../../lib/identity/routes.ts";
import { InquiryInput, submitInquiry } from "../../lib/inquiry/index.ts";
import { getRequestExport, getRequests, postRequest, postRequestAction } from "../../lib/privacy/routes.ts";
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
const BASE = "/api/app/privacy/requests";

describe("API quyền chủ thể dữ liệu (T-040)", () => {
  let db: TestDb;
  let hr: S, hr2: S, emp: S;
  let code: string;
  let companyId: string;

  before(async () => {
    db = await freshDb();
    const org = await seedCompany();
    companyId = org.companyId;
    const org2 = await seedCompany("Công ty Hai");
    hr = await login(
      (await seedUser(org.companyId, { grants: [{ role: "hr", scopeType: "company" }] })).email,
    );
    hr2 = await login(
      (await seedUser(org2.companyId, { grants: [{ role: "hr", scopeType: "company" }] })).email,
    );
    emp = await login(
      (await seedUser(org.companyId, { grants: [{ role: "employee", scopeType: "self" }] })).email,
    );
    const r = await submitInquiry(
      db.app,
      org.companyId,
      InquiryInput.parse({
        submission_id: randomUUID(),
        name: "Khách HTTP",
        email: "khach.http@example.test",
        message: "Cần báo giá",
        consent: true,
        elapsed_ms: 9000,
      }),
      { ip: "10.5.5.5" },
    );
    code = r.code;
  });
  after(async () => {
    await db.close();
  });

  const create = (s: S | null, body: unknown, key?: string | null) =>
    postRequest(req("POST", BASE, { cookie: s?.cookie, csrf: s?.csrf, body, idempotencyKey: key }));
  const act = (s: S | null, id: string, action: string, body: unknown = {}) =>
    postRequestAction(req("POST", `${BASE}/${id}/${action}`, { cookie: s?.cookie, csrf: s?.csrf, body }));
  const body = (kind: string, ref = code) => ({ subject_type: "inquiry", subject_ref: ref, kind });

  test("api5-bfla GET /api/app/privacy/requests POST /api/app/privacy/requests — chưa đăng nhập 401, không phải HR 403 (kể cả audit denied)", async () => {
    assert.equal((await getRequests(req("GET", BASE))).status, 401);
    assert.equal((await create(null, body("access"))).status, 401);
    const g = await getRequests(req("GET", BASE, { cookie: emp.cookie }));
    assert.equal(g.status, 403);
    assert.equal(g.headers.get("cache-control"), "no-store");
    assert.equal((await create(emp, body("access"))).status, 403);
    const denied = await db.admin.query(
      "SELECT 1 FROM audit_event WHERE action = 'privacy.manage' AND result = 'denied'",
    );
    assert.ok(denied.rowCount! >= 2);
    assert.equal((await db.admin.query("SELECT 1 FROM data_subject_request")).rowCount, 0);
  });

  test("api1-bola GET /api/app/privacy/requests — HR công ty khác không thấy yêu cầu của công ty này", async () => {
    const c = await create(hr, body("restrict"));
    assert.equal(c.status, 201);
    const mine = (await (await getRequests(req("GET", BASE, { cookie: hr.cookie }))).json()).items;
    assert.equal(mine.length, 1);
    assert.equal(typeof mine[0].overdue, "boolean");
    const theirs = (await (await getRequests(req("GET", BASE, { cookie: hr2.cookie }))).json()).items;
    assert.deepEqual(theirs, []);
    const bad = await getRequests(req("GET", `${BASE}?status=zzz`, { cookie: hr.cookie }));
    assert.equal(bad.status, 400);
    const overdue = await getRequests(req("GET", `${BASE}?overdue=1`, { cookie: hr.cookie }));
    assert.deepEqual((await overdue.json()).items, []);
  });

  test("api1-bola api5-bfla POST /api/app/privacy/requests — Idempotency-Key bắt buộc; gửi lại cùng khoá không tạo thêm; mã công ty khác 404; đầu vào sai 400", async () => {
    assert.equal((await create(hr, body("access"), null)).status, 400);
    const key = randomUUID();
    const a = await create(hr, body("access"), key);
    const b = await create(hr, body("access"), key);
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal((await a.json()).request.id, (await b.json()).request.id);
    assert.equal(
      (await db.admin.query("SELECT 1 FROM data_subject_request WHERE kind = 'access'")).rowCount,
      1,
    );
    assert.equal((await create(hr2, body("access"))).status, 404, "mã hồ sơ của công ty khác");
    assert.equal(
      (await create(hr, { ...body("access"), subject_ref: "khach.http@example.test" })).status,
      400,
    );
    assert.equal((await create(hr, body("xoa-het"))).status, 400);
    const dup = await create(hr, body("access"));
    assert.equal(dup.status, 409, "đang có yêu cầu mở cùng loại");
  });

  test("api1-bola api5-bfla POST /api/app/privacy/requests/[id]/[action] — HR công ty khác 404, người không phải HR 403, action lạ 404, reject thiếu căn cứ 422", async () => {
    const id = (await db.admin.query("SELECT id FROM data_subject_request WHERE kind = 'access'")).rows[0].id;
    assert.equal((await act(null, id, "start")).status, 401);
    assert.equal((await act(emp, id, "start")).status, 403);
    assert.equal((await act(hr2, id, "start")).status, 404);
    assert.equal((await act(hr, id, "boom")).status, 404);
    assert.equal((await act(hr, "khong-phai-uuid", "start")).status, 404);
    assert.equal((await act(hr, id, "reject", {})).status, 422);
    const started = await act(hr, id, "start");
    assert.equal(started.status, 200);
    assert.equal((await started.json()).request.status, "in_progress");
    assert.equal((await act(hr, id, "start")).status, 409);
  });

  test("api1-bola api5-bfla GET /api/app/privacy/requests/[id]/[action] — xuất dữ liệu: HR đúng công ty mới được; không phải HR 403; công ty khác 404; yêu cầu không phải access 409", async () => {
    const access = (await db.admin.query("SELECT id FROM data_subject_request WHERE kind = 'access'")).rows[0]
      .id;
    const exp = (s: S | null, id: string, action = "export") =>
      getRequestExport(req("GET", `${BASE}/${id}/${action}`, { cookie: s?.cookie }));
    assert.equal((await exp(null, access)).status, 401);
    assert.equal((await exp(emp, access)).status, 403);
    assert.equal((await exp(hr2, access)).status, 404);
    assert.equal((await exp(hr, access, "khac")).status, 404);
    const ok = await exp(hr, access);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("cache-control"), "no-store");
    const j = await ok.json();
    assert.equal(j.data.inquiry.email, "khach.http@example.test");
    const restrict = (await db.admin.query("SELECT id FROM data_subject_request WHERE kind = 'restrict'"))
      .rows[0].id;
    assert.equal((await exp(hr, restrict)).status, 409);
  });

  test("luồng HR: tạo → bắt đầu → hoàn tất yêu cầu xoá qua HTTP; danh sách phản ánh, phản hồi phát lại theo khoá", async () => {
    const r2 = await submitInquiry(
      db.app,
      companyId,
      InquiryInput.parse({
        submission_id: randomUUID(),
        name: "Khách Cần Xoá HTTP",
        email: "xoa.http@example.test",
        message: "Xoá giúp",
        consent: true,
        elapsed_ms: 9000,
      }),
      { ip: "10.5.5.6" },
    );
    const created = await (await create(hr, body("delete", r2.code))).json();
    const id = created.request.id as string;
    assert.equal((await act(hr, id, "start")).status, 200);
    const key = randomUUID();
    const send = () =>
      postRequestAction(
        req("POST", `${BASE}/${id}/complete`, {
          cookie: hr.cookie,
          csrf: hr.csrf,
          body: {},
          idempotencyKey: key,
        }),
      );
    const first = await send();
    assert.equal(first.status, 200);
    const done = (await first.json()).request;
    assert.equal(done.status, "done");
    assert.equal(done.result.outcome, "anonymized");
    const replay = await send();
    assert.equal(replay.status, 200, "cùng khoá → phát lại, không 409");
    const row = (await db.admin.query("SELECT name, status FROM inquiry WHERE code = $1", [r2.code])).rows[0];
    assert.equal(row.name, "[đã ẩn danh]");
    assert.equal(row.status, "processing_stopped");
  });

  test("api5-bfla POST /api/app/privacy/requests/[id]/[action] — API trả hạn theo loại; respond/extend: thiếu lý do 422, gia hạn lần hai 409, không phải HR 403", async () => {
    const r3 = await submitInquiry(
      db.app,
      companyId,
      InquiryInput.parse({
        submission_id: randomUUID(),
        name: "Khách Hạn",
        email: "khach.han@example.test",
        message: "Cần báo giá",
        consent: true,
        elapsed_ms: 9000,
      }),
      { ip: "10.5.5.7" },
    );
    const c = await (await create(hr, body("delete", r3.code))).json();
    const rq = c.request;
    const ms = (a: string, b: string) => Date.parse(a) - Date.parse(b);
    assert.equal(ms(rq.due_at, rq.received_at), 20 * 86_400_000, "xoá = 20 ngày");
    assert.equal(typeof rq.respond_due_at, "string", "có hạn phản hồi");
    assert.equal(rq.responded_at, null);
    assert.equal((await act(emp, rq.id, "respond")).status, 403);
    assert.equal((await act(emp, rq.id, "extend", { reason: "x" })).status, 403);
    const resp = await act(hr, rq.id, "respond");
    assert.equal(resp.status, 200);
    assert.equal(typeof (await resp.json()).request.responded_at, "string");
    assert.equal((await act(hr, rq.id, "extend", {})).status, 422, "thiếu lý do");
    const ext = await act(hr, rq.id, "extend", { reason: "Cần xác minh danh tính chủ thể" });
    assert.equal(ext.status, 200);
    const extended = (await ext.json()).request;
    assert.equal(ms(extended.due_at, rq.due_at), 15 * 86_400_000);
    assert.equal(extended.extension_days, 15);
    const second = await act(hr, rq.id, "extend", { reason: "Lần hai" });
    assert.equal(second.status, 409);
    assert.equal((await second.json()).error.code, "EXTENSION_ALREADY_USED");
    assert.equal((await act(hr2, rq.id, "extend", { reason: "Công ty khác" })).status, 404);
    const listed = (await (await getRequests(req("GET", BASE, { cookie: hr.cookie }))).json()).items.find(
      (x: { id: string }) => x.id === rq.id,
    );
    assert.equal(listed.respond_overdue, false);
    assert.equal(listed.overdue, false);
  });
});
