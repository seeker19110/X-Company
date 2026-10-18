import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, test } from "node:test";
import { withTx } from "../../lib/db/index.ts";
import { listApplications, listInquiries, postApplication, postInquiry } from "../../lib/inquiry/routes.ts";
import { submitInquiry, updateInquiry, InquiryInput } from "../../lib/inquiry/index.ts";
import { addBusinessDays, localDate } from "../../lib/nen/time.ts";
import { loginHandler } from "../../lib/identity/routes.ts";
import { approve, createPage, publish, submitForReview } from "../../lib/cms/index.ts";
import { AppError } from "../../lib/nen/app-error.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { cookieFrom, PASSWORD, req, seedCompany, seedUser, setTestEnv } from "../helpers/fixtures.ts";

setTestEnv();
const isCode = (code: string) => (e: unknown) => e instanceof AppError && e.code === code;

let ipSeq = 0;
function form(overrides: Record<string, unknown> = {}) {
  return {
    submission_id: randomUUID(),
    name: "Nguyễn Văn Khách",
    email: "khach@example.vn",
    phone: null,
    message: "Cần tư vấn hệ thống điện",
    consent: true,
    website: "",
    elapsed_ms: 15000,
    ...overrides,
  };
}
/** Mỗi test một IP riêng (sau proxy tin cậy) để giới hạn tần suất không lẫn giữa các test. */
function post(handler: typeof postInquiry, path: string, body: unknown, ip = `10.0.0.${++ipSeq}`) {
  return handler(req("POST", path, { body, headers: { "x-forwarded-for": ip } }));
}

describe("liên hệ & tuyển dụng (T-010)", () => {
  let db: TestDb;
  let companyId: string;
  let sales: { userId: string; email: string };

  before(async () => {
    process.env.TRUST_PROXY = "1";
    db = await freshDb();
    ({ companyId } = await seedCompany());
    process.env.SITE_COMPANY_ID = companyId;
    sales = await seedUser(companyId, { grants: [{ role: "sales", scopeType: "company" }] });
    const sales2 = await seedUser(companyId, { grants: [{ role: "sales", scopeType: "company" }] });
    await db.admin.query(
      "INSERT INTO inquiry_route (company_id, service_slug, assignee_user_id) VALUES ($1, NULL, $2), ($1, 'dien', $3)",
      [companyId, sales.userId, sales2.userId],
    );
  });
  beforeEach(() => {
    process.env.TRUST_PROXY = "1";
  });
  after(async () => {
    delete process.env.TRUST_PROXY;
    await db.close();
  });

  test("S-WEB-01 (AT01): hợp lệ → 201 + mã; đúng 1 hồ sơ assigned có hạn; gửi lại cùng submission_id → cùng mã", async () => {
    const body = form();
    const r1 = await post(postInquiry, "/api/public/inquiries", body);
    assert.equal(r1.status, 201);
    const { code } = await r1.json();
    assert.match(code, /^YC-\d{8}-\d{4}$/);
    assert.equal(code.slice(3, 11), localDate(new Date()).replaceAll("-", ""));
    const r2 = await post(postInquiry, "/api/public/inquiries", body);
    assert.equal(r2.status, 200);
    assert.equal((await r2.json()).code, code);
    const { rows } = await db.admin.query(
      "SELECT status, assignee_user_id, due_at, created_at, consent_notice_version, ip_hash FROM inquiry WHERE submission_id = $1",
      [body.submission_id],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "assigned");
    assert.equal(rows[0].assignee_user_id, sales.userId);
    assert.ok(rows[0].due_at > rows[0].created_at);
    assert.ok(rows[0].consent_notice_version);
    assert.match(rows[0].ip_hash, /^[0-9a-f]{32}$/, "IP lưu dạng băm");
    const outbox = await db.admin.query("SELECT topic FROM outbox_event WHERE payload->>'code' = $1", [code]);
    assert.deepEqual(
      outbox.rows.map((r) => r.topic),
      ["inquiry.assigned"],
    );
  });

  test("gửi đồng thời cùng submission_id → vẫn 1 hồ sơ", async () => {
    const body = form();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        submitInquiry(db.app, companyId, InquiryInput.parse(body), { ip: "x" }),
      ),
    );
    assert.equal(new Set(results.map((r) => r.code)).size, 1);
    assert.equal(results.filter((r) => r.created).length, 1);
  });

  test("định tuyến theo dịch vụ; mã tăng dần trong ngày", async () => {
    const a = await (await post(postInquiry, "/api/public/inquiries", form({ service: "dien" }))).json();
    const b = await (await post(postInquiry, "/api/public/inquiries", form())).json();
    const { rows } = await db.admin.query(
      "SELECT code, service_slug, assignee_user_id <> $1 AS other FROM inquiry WHERE code = ANY($2) ORDER BY code",
      [sales.userId, [a.code, b.code]],
    );
    assert.deepEqual(
      rows.map((r) => [r.service_slug, r.other]),
      [
        ["dien", true],
        [null, false],
      ],
    );
    assert.ok(Number(a.code.slice(-4)) < Number(b.code.slice(-4)));
  });

  test("S-WEB-04: honeypot → 201 giả, không lưu; điền < 3 s → lưu nhưng đánh dấu nghi spam", async () => {
    const before = (await db.admin.query("SELECT count(*)::int AS n FROM inquiry")).rows[0].n;
    const hp = await post(postInquiry, "/api/public/inquiries", form({ website: "http://spam" }));
    assert.equal(hp.status, 200);
    assert.match((await hp.json()).code, /^YC-/);
    assert.equal((await db.admin.query("SELECT count(*)::int AS n FROM inquiry")).rows[0].n, before);
    const fast = await post(postInquiry, "/api/public/inquiries", form({ elapsed_ms: 800 }));
    const { code } = await fast.json();
    const { rows } = await db.admin.query("SELECT suspected_spam FROM inquiry WHERE code = $1", [code]);
    assert.equal(rows[0].suspected_spam, true);
  });

  test("giới hạn 5 lần / 10 phút / IP → 429 có Retry-After", async () => {
    const ip = "203.0.113.9";
    for (let i = 0; i < 5; i++)
      assert.ok((await post(postInquiry, "/api/public/inquiries", form(), ip)).status < 300);
    const sixth = await post(postInquiry, "/api/public/inquiries", form(), ip);
    assert.equal(sixth.status, 429);
    assert.ok(Number(sixth.headers.get("retry-after")) > 0);
  });

  test("kiểm dữ liệu: thiếu cả email lẫn điện thoại / không đồng ý / email sai → 400 có chi tiết", async () => {
    const none = await post(postInquiry, "/api/public/inquiries", form({ email: null, phone: null }));
    assert.equal(none.status, 400);
    assert.equal((await none.json()).error.details.issues[0].path, "email");
    assert.equal((await post(postInquiry, "/api/public/inquiries", form({ consent: false }))).status, 400);
    assert.equal(
      (await post(postInquiry, "/api/public/inquiries", form({ email: "khong-phai-email" }))).status,
      400,
    );
    const phoneOnly = await post(
      postInquiry,
      "/api/public/inquiries",
      form({ email: null, phone: "+84 912 345 678" }),
    );
    assert.equal(phoneOnly.status, 201);
  });

  test("ứng tuyển: theo vị trí đã đăng; vị trí lạ → 404", async () => {
    const author = await seedUser(companyId);
    const reviewer = await seedUser(companyId);
    await withTx(async (tx) => {
      const r = await createPage(
        tx,
        { userId: author.userId, companyId },
        { type: "job", slug: "ky-su-dien" },
        { title: "Kỹ sư điện", bodyMarkdown: "" },
      );
      await submitForReview(tx, { userId: author.userId, companyId }, r.id);
      await approve(tx, { userId: reviewer.userId, companyId }, r.id);
      await publish(tx, { userId: reviewer.userId, companyId }, r.id);
    });
    const app = {
      submission_id: randomUUID(),
      job_slug: "ky-su-dien",
      name: "Ứng viên A",
      email: "uv@x.vn",
      consent: true,
    };
    const res = await post(postApplication as typeof postInquiry, "/api/public/applications", app);
    assert.equal(res.status, 201);
    assert.match((await res.json()).code, /^UV-\d{8}-\d{4}$/);
    const missing = await post(postApplication as typeof postInquiry, "/api/public/applications", {
      ...app,
      submission_id: randomUUID(),
      job_slug: "khong-co",
    });
    assert.equal(missing.status, 404);
  });

  test("S-WEB-05: sales đọc hộp yêu cầu, KHÔNG đọc hồ sơ ứng viên; HR thì ngược lại", async () => {
    const hr = await seedUser(companyId, { grants: [{ role: "hr", scopeType: "company" }] });
    const login = async (email: string) =>
      cookieFrom(
        await loginHandler(req("POST", "/api/app/auth/login", { body: { email, password: PASSWORD } })),
      );
    const sc = await login(sales.email);
    const hc = await login(hr.email);
    assert.equal((await listInquiries(req("GET", "/api/app/inquiries", { cookie: sc }))).status, 200);
    assert.equal((await listApplications(req("GET", "/api/app/applications", { cookie: sc }))).status, 403);
    assert.equal((await listApplications(req("GET", "/api/app/applications", { cookie: hc }))).status, 200);
    assert.equal((await listInquiries(req("GET", "/api/app/inquiries", { cookie: hc }))).status, 403);
    const denied = await db.admin.query(
      "SELECT count(*)::int AS n FROM audit_event WHERE result = 'denied' AND action = 'application.read' AND actor_user_id = $1",
      [sales.userId],
    );
    assert.equal(denied.rows[0].n, 1);
  });

  test("đổi trạng thái hồ sơ theo luồng, có lịch sử; chuyển sai → INVALID_STATE", async () => {
    const { code } = await (await post(postInquiry, "/api/public/inquiries", form())).json();
    const id = (await db.admin.query("SELECT id FROM inquiry WHERE code = $1", [code])).rows[0].id;
    const actor = { userId: sales.userId, companyId };
    await withTx((tx) => updateInquiry(tx, actor, id, { status: "in_progress", note: "đã gọi" }));
    await assert.rejects(
      withTx((tx) => updateInquiry(tx, actor, id, { status: "new" })),
      isCode("INVALID_STATE"),
    );
    await withTx((tx) => updateInquiry(tx, actor, id, { status: "qualified" }));
    await withTx((tx) => updateInquiry(tx, actor, id, { status: "closed" }));
    const h = await db.admin.query(
      "SELECT to_status FROM inquiry_history WHERE inquiry_id = $1 ORDER BY id",
      [id],
    );
    assert.deepEqual(
      h.rows.map((r) => r.to_status),
      ["assigned", "in_progress", "qualified", "closed"],
    );
    await assert.rejects(
      withTx((tx) => updateInquiry(tx, actor, randomUUID(), { status: "closed" })),
      isCode("NOT_FOUND"),
    );
  });

  test("hạn xử lý +1 ngày làm việc (bỏ T7/CN, giờ VN)", () => {
    // Thứ Sáu 2026-10-16 15:00 giờ VN → Thứ Hai 2026-10-19.
    const fri = new Date("2026-10-16T08:00:00Z");
    assert.equal(localDate(addBusinessDays(fri, 1)), "2026-10-19");
    // Thứ Ba → Thứ Tư.
    assert.equal(localDate(addBusinessDays(new Date("2026-10-13T08:00:00Z"), 1)), "2026-10-14");
    // 23:30 Thứ Sáu giờ VN (16:30Z) → Thứ Hai theo ngày VN.
    assert.equal(localDate(addBusinessDays(new Date("2026-10-16T16:30:00Z"), 1)), "2026-10-19");
  });
});
