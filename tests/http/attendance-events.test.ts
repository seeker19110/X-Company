import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { getQr, postEvent } from "../../lib/attendance/routes.ts";
import { issueQr, verifyQrSignature } from "../../lib/attendance/qr.ts";
import { recordEvent } from "../../lib/attendance/events.ts";
import { disableUser } from "../../lib/identity/auth.ts";
import { withTx } from "../../lib/db/index.ts";
import { createWorksite } from "../../lib/org/index.ts";
import { AppError } from "../../lib/nen/app-error.ts";
import { setRateClockForTest } from "../../lib/http/idempotency.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { cookieFrom, req, seedCompany, seedUser, setTestEnv, loginThrough } from "../helpers/fixtures.ts";

setTestEnv();
process.env.QR_SIGNING_KEYS =
  "k2:new-key-0123456789abcdef0123456789abcdef,k1:old-key-0123456789abcdef0123456789abcdef";

const isCode = (code: string) => (e: unknown) => e instanceof AppError && e.code === code;

interface Session {
  cookie: string;
  csrf: string;
}
async function login(email: string): Promise<Session> {
  const res = await loginThrough(email);
  return { cookie: cookieFrom(res), csrf: (await res.json()).csrf_token };
}
function send(s: Session, body: Record<string, unknown>, key: string | null = randomUUID()) {
  return postEvent(
    req("POST", "/api/app/attendance/events", {
      cookie: s.cookie,
      csrf: s.csrf,
      body,
      idempotencyKey: key,
      headers: key ? { "idempotency-key": key } : {},
    }),
  );
}
const iso = (msFromNow = 0) => new Date(Date.now() + msFromNow).toISOString();

describe("sự kiện chấm công (T-012)", () => {
  let db: TestDb;
  let companyId: string, branchId: string, worksiteId: string, otherWorksite: string;
  let emp: Awaited<ReturnType<typeof seedUser>>;
  let s: Session;

  before(async () => {
    db = await freshDb();
    ({ companyId, branchId } = await seedCompany());
    worksiteId = await withTx((tx) =>
      createWorksite(tx, { userId: null }, companyId, { code: "CT1", name: "Công trường 1", branchId }),
    );
    otherWorksite = await withTx((tx) =>
      createWorksite(tx, { userId: null }, companyId, { code: "VP", name: "Văn phòng", branchId }),
    );
    emp = await seedUser(companyId, { grants: [{ role: "employee", scopeType: "self" }] });
    s = await login(emp.email);
  });
  after(async () => {
    await db.close();
  });

  test("S-AT-03 (AT04): gửi 3 lần cùng khoá → 1 bản ghi, cùng event_id (201 rồi 200)", async () => {
    const key = randomUUID();
    const body = { kind: "in", device_time: iso(), source: "gps", device: "p1" };
    const r1 = await send(s, body, key);
    const r2 = await send(s, body, key);
    const r3 = await send(s, body, key);
    assert.deepEqual([r1.status, r2.status, r3.status], [201, 200, 200]);
    const ids = await Promise.all([r1, r2, r3].map(async (r) => (await r.json()).event_id));
    assert.equal(new Set(ids).size, 1);
    const n = await db.admin.query(
      "SELECT count(*)::int AS n FROM attendance_event WHERE idempotency_key = $1",
      [key],
    );
    assert.equal(n.rows[0].n, 1);
  });

  test("S-AT-04: cùng khoá khác nội dung → 409 IDEMPOTENCY_CONFLICT + audit denied", async () => {
    const key = randomUUID();
    const t = iso();
    assert.equal(
      (await send(s, { kind: "in", device_time: t, source: "gps", device: "p1" }, key)).status,
      201,
    );
    const c = await send(s, { kind: "out", device_time: t, source: "gps", device: "p1" }, key);
    assert.equal(c.status, 409);
    assert.equal((await c.json()).error.code, "IDEMPOTENCY_CONFLICT");
    const a = await db.admin.query(
      "SELECT count(*)::int AS n FROM audit_event WHERE reason = 'IDEMPOTENCY_CONFLICT' AND result = 'denied'",
    );
    assert.equal(a.rows[0].n, 1);
  });

  test("gửi đồng thời cùng khoá → vẫn 1 bản ghi", async () => {
    const key = randomUUID();
    const input = {
      idempotencyKey: key,
      kind: "out" as const,
      deviceTime: new Date(),
      source: "gps" as const,
    };
    const actor = { userId: emp.userId, companyId, employeeId: emp.employeeId! };
    const rs = await Promise.all(Array.from({ length: 6 }, () => recordEvent(db.app, actor, input)));
    assert.equal(new Set(rs.map((r) => r.eventId)).size, 1);
    assert.equal(rs.filter((r) => !r.replayed).length, 1);
  });

  test("thiếu / sai Idempotency-Key → 400; body sai → 400", async () => {
    const r = await send(s, { kind: "in", device_time: iso(), source: "gps" }, null);
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error.code, "IDEMPOTENCY_KEY_REQUIRED");
    assert.equal((await send(s, { kind: "in", device_time: iso(), source: "gps" }, "short")).status, 400);
    // AUD-XFEAT-003: cùng luật ký tự với middleware (8–255 ký tự in được, không khoảng trắng); trần 100 theo CHECK của bảng.
    for (const bad of ["co khoang trang", "tab\tbên-trong", "x".repeat(101)]) {
      const r = await send(s, { kind: "in", device_time: iso(), source: "gps" }, bad);
      assert.equal(r.status, 400, bad);
      assert.equal((await r.json()).error.code, "IDEMPOTENCY_KEY_REQUIRED");
    }
    assert.equal((await send(s, { kind: "nap", device_time: iso(), source: "gps" })).status, 400);
    assert.equal((await send(s, { kind: "in", device_time: "hôm qua", source: "gps" })).status, 400);
  });

  test("AUD-XFEAT-004: giới hạn 60 lượt/phút theo người dùng như /sync → lượt 61 là 429 + Retry-After; người khác không bị ảnh hưởng", async (t) => {
    setRateClockForTest(() => new Date("2026-10-18T12:00:30Z")); // giữa cửa sổ phút: 61 lượt không vắt qua ranh giới
    t.after(() => setRateClockForTest(null));
    const flood = await seedUser(companyId, { grants: [{ role: "employee", scopeType: "self" }] });
    const fs = await login(flood.email);
    const bad = { kind: "nap", device_time: iso(), source: "gps" }; // body sai vẫn bị đếm (đếm trước khi xử lý)
    for (let i = 0; i < 60; i++) assert.equal((await send(fs, bad)).status, 400, `lượt ${i + 1}`);
    const over = await send(fs, { kind: "in", device_time: iso(), source: "gps" });
    assert.equal(over.status, 429);
    const ra = Number(over.headers.get("retry-after"));
    assert.ok(ra >= 1 && ra <= 60, String(ra));
    assert.equal((await send(s, bad)).status, 400);
  });

  test("C6: lệch giờ thiết bị trực tuyến > 5' → needs_review CLOCK_SKEW; tương lai → FUTURE_TIME", async () => {
    const skew = await (await send(s, { kind: "out", device_time: iso(-10 * 60_000), source: "gps" })).json();
    assert.equal(skew.status, "needs_review");
    assert.equal(skew.review_reason, "CLOCK_SKEW");
    const future = await (
      await send(s, { kind: "out", device_time: iso(10 * 60_000), source: "gps" })
    ).json();
    assert.equal(future.review_reason, "FUTURE_TIME");
  });

  test("S-AT-05 (AT05): hàng chờ 70 giờ trước → accepted; 80 giờ → needs_review OFFLINE_TOO_OLD", async () => {
    const ok = await (
      await send(s, { kind: "out", device_time: iso(-70 * 3600_000), source: "gps", queued: true })
    ).json();
    assert.equal(ok.status, "accepted");
    const old = await (
      await send(s, { kind: "out", device_time: iso(-80 * 3600_000), source: "gps", queued: true })
    ).json();
    assert.equal(old.status, "needs_review");
    assert.equal(old.review_reason, "OFFLINE_TOO_OLD");
  });

  test("S-AT-09: QR hợp lệ → accepted, gắn địa điểm; hết hạn 75 s → 422; sai chữ ký/khác công ty → 422", async () => {
    const good = await send(s, {
      kind: "out",
      device_time: iso(),
      source: "qr",
      qr: issueQr(companyId, worksiteId, 60),
    });
    assert.equal(good.status, 201);
    const g = await good.json();
    assert.equal(g.status, "accepted");
    const row = await db.admin.query("SELECT worksite_id, qr_nonce FROM attendance_event WHERE id = $1", [
      g.event_id,
    ]);
    assert.equal(row.rows[0].worksite_id, worksiteId);
    assert.match(String(row.rows[0].qr_nonce), /\S/);

    const expired = await send(s, {
      kind: "out",
      device_time: iso(),
      source: "qr",
      qr: issueQr(companyId, worksiteId, 60, new Date(Date.now() - 75_000)),
    });
    assert.equal(expired.status, 422);
    assert.equal((await expired.json()).error.code, "QR_EXPIRED");

    const token = issueQr(companyId, worksiteId, 60);
    const [body, sig] = token.split(".");
    const tampered = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body!, "base64url").toString()), ws: otherWorksite }),
    ).toString("base64url");
    const bad = await send(s, { kind: "out", device_time: iso(), source: "qr", qr: `${tampered}.${sig}` });
    assert.equal((await bad.json()).error.code, "QR_INVALID");
    assert.equal((await send(s, { kind: "out", device_time: iso(), source: "qr", qr: "abc" })).status, 422);
    const foreign = await send(s, {
      kind: "out",
      device_time: iso(),
      source: "qr",
      qr: issueQr(randomUUID(), worksiteId, 60),
    });
    assert.equal((await foreign.json()).error.code, "QR_INVALID");
    assert.equal((await send(s, { kind: "out", device_time: iso(), source: "qr" })).status, 422);
  });

  test("QR dùng chung không bị vô hiệu sau lần quét đầu; QR hết hạn trong hàng chờ → lưu needs_review", async () => {
    const shared = issueQr(companyId, worksiteId, 60);
    const other = await seedUser(companyId);
    const s2 = await login(other.email);
    assert.equal((await send(s, { kind: "out", device_time: iso(), source: "qr", qr: shared })).status, 201);
    assert.equal((await send(s2, { kind: "in", device_time: iso(), source: "qr", qr: shared })).status, 201);
    const queued = await send(s, {
      kind: "out",
      device_time: iso(-3600_000),
      source: "qr",
      queued: true,
      qr: issueQr(companyId, worksiteId, 60, new Date(Date.now() - 2 * 3600_000)),
    });
    assert.equal(queued.status, 201);
    assert.deepEqual((await queued.json()).review_reason.split(","), ["QR_EXPIRED", "QR_OFFLINE"]);
  });

  test("xoay khoá QR: token ký bằng kid cũ vẫn kiểm được; kid lạ bị từ chối", () => {
    const saved = process.env.QR_SIGNING_KEYS;
    process.env.QR_SIGNING_KEYS = "k1:old-key-0123456789abcdef0123456789abcdef";
    const oldToken = issueQr(companyId, worksiteId, 60);
    process.env.QR_SIGNING_KEYS = saved;
    assert.equal(verifyQrSignature(oldToken).kid, "k1");
    process.env.QR_SIGNING_KEYS = "k3:zzz-key-0123456789abcdef0123456789abcdef";
    try {
      assert.throws(() => verifyQrSignature(oldToken), isCode("QR_INVALID"));
    } finally {
      process.env.QR_SIGNING_KEYS = saved;
    }
  });

  test("I3 (D-011): vào từ thiết bị khác trong 2 phút → DUPLICATE_OPEN; cùng thiết bị hoặc ngoài cửa sổ → accepted", async () => {
    const u = await seedUser(companyId);
    const su = await login(u.email);
    const t0 = Date.now();
    const a = await (
      await send(su, {
        kind: "in",
        device_time: new Date(t0 - 4 * 60_000).toISOString(),
        source: "gps",
        device: "A",
      })
    ).json();
    assert.equal(a.status, "accepted");
    const b = await (
      await send(su, {
        kind: "in",
        device_time: new Date(t0 - 3 * 60_000).toISOString(),
        source: "kiosk",
        device: "B",
      })
    ).json();
    assert.equal(b.status, "needs_review");
    assert.equal(b.review_reason, "DUPLICATE_OPEN");
    const c = await (
      await send(su, { kind: "in", device_time: new Date(t0).toISOString(), source: "kiosk", device: "C" })
    ).json();
    assert.equal(c.status, "accepted", "ngoài cửa sổ 2 phút");
  });

  test("gắn ca được giao theo cửa sổ (ca qua đêm hôm trước); sai địa điểm của ca → needs_review", async () => {
    const u = await seedUser(companyId);
    const tpl = await db.admin.query(
      `INSERT INTO shift_template (company_id, code, name, start_time, end_time, break_minutes)
       VALUES ($1, 'DEM', 'Ca đêm', '22:00', '06:00', 30) RETURNING id`,
      [companyId],
    );
    const asg = await db.admin.query(
      `INSERT INTO shift_assignment (company_id, employee_id, business_date, shift_template_id, worksite_id)
       VALUES ($1, $2, '2026-10-18', $3, $4) RETURNING id`,
      [companyId, u.employeeId, tpl.rows[0].id, worksiteId],
    );
    const actor = { userId: u.userId, companyId, employeeId: u.employeeId! };
    const at = (iso: string) => new Date(iso);
    // 02:00 ngày 19 giờ VN thuộc ca đêm business_date 18; sai địa điểm → needs_review.
    const mid = at("2026-10-19T02:00:00+07:00");
    const r = await recordEvent(
      db.app,
      actor,
      {
        idempotencyKey: randomUUID(),
        kind: "break_start",
        deviceTime: mid,
        source: "gps",
        worksiteId: otherWorksite,
      },
      mid,
    );
    assert.equal(r.shiftAssignmentId, asg.rows[0].id);
    assert.equal(r.reviewReason, "WORKSITE_MISMATCH");
    // 09:59 ngày 19 còn trong cửa sổ (06:00 + 240'), 10:01 thì ngoài → không gắn ca.
    const inGrace = at("2026-10-19T09:59:00+07:00");
    const r2 = await recordEvent(
      db.app,
      actor,
      { idempotencyKey: randomUUID(), kind: "out", deviceTime: inGrace, source: "gps", worksiteId },
      inGrace,
    );
    assert.equal(r2.shiftAssignmentId, asg.rows[0].id);
    assert.equal(r2.status, "accepted");
    const outside = at("2026-10-19T10:01:00+07:00");
    const r3 = await recordEvent(
      db.app,
      actor,
      { idempotencyKey: randomUUID(), kind: "out", deviceTime: outside, source: "gps" },
      outside,
    );
    assert.equal(r3.shiftAssignmentId, null);
  });

  test("S-AT-06 (AT05): tài khoản bị vô hiệu → 401; nghỉ việc → 403; không gắn nhân viên → 403", async () => {
    const u = await seedUser(companyId);
    const su = await login(u.email);
    await db.admin.query("UPDATE employee SET terminated_on = current_date - 1 WHERE id = $1", [
      u.employeeId,
    ]);
    const ended = await send(su, { kind: "out", device_time: iso(-3600_000), source: "gps", queued: true });
    assert.equal(ended.status, 403);
    assert.equal((await ended.json()).error.code, "EMPLOYMENT_ENDED");
    await withTx((tx) => disableUser(tx, null, u.userId, "nghỉ việc"));
    assert.equal((await send(su, { kind: "out", device_time: iso(), source: "gps" })).status, 401);
    const noEmp = await seedUser(companyId, { withEmployee: false });
    const sn = await login(noEmp.email);
    assert.equal(
      (await (await send(sn, { kind: "in", device_time: iso(), source: "gps" })).json()).error.code,
      "NO_EMPLOYEE",
    );
  });

  test("S-AT-14 (T-051): client cũ gửi geo khi cờ GPS tắt → 201, không lỗi, geo_stored=false, không lưu toạ độ", async () => {
    const saved = process.env.GEO_CAPTURE_ENABLED;
    delete process.env.GEO_CAPTURE_ENABLED;
    try {
      const geo = { lat: 21.0285, lng: 105.8542, accuracy_m: 9, captured_at: iso() };
      const res = await send(s, { kind: "out", device_time: iso(), source: "gps", geo });
      assert.equal(res.status, 201);
      const body = await res.json();
      assert.equal(body.geo_stored, false);
      const row = await db.admin.query(
        "SELECT geo_lat, geo_lng, geo_enc FROM attendance_event WHERE id = $1",
        [body.event_id],
      );
      assert.deepEqual(row.rows[0], { geo_lat: null, geo_lng: null, geo_enc: null });
      const none = await (await send(s, { kind: "out", device_time: iso(), source: "gps" })).json();
      assert.equal(none.geo_stored, false);
    } finally {
      if (saved !== undefined) process.env.GEO_CAPTURE_ENABLED = saved;
    }
  });

  test("sự kiện gốc không sửa/xoá được; chỉ đổi trạng thái xác minh", async () => {
    const r = await (await send(s, { kind: "out", device_time: iso(), source: "gps" })).json();
    await assert.rejects(
      db.app.query("DELETE FROM attendance_event WHERE id = $1", [r.event_id]),
      /permission denied|không xoá/,
    );
    await assert.rejects(
      db.app.query("UPDATE attendance_event SET device_time = now() - interval '1 hour' WHERE id = $1", [
        r.event_id,
      ]),
      /bằng chứng gốc/,
    );
    await db.app.query(
      "UPDATE attendance_event SET status = 'needs_review', review_reason = 'HR_CHECK' WHERE id = $1",
      [r.event_id],
    );
  });

  test("hiển thị QR: cần quyền attendance.qr_display trong phạm vi chi nhánh; nhân viên thường → 403", async () => {
    const lead = await seedUser(companyId, {
      grants: [{ role: "team_lead", scopeType: "branch", scopeId: branchId }],
    });
    const sl = await login(lead.email);
    const ok = await getQr(req("GET", `/api/app/attendance/qr/${worksiteId}`, { cookie: sl.cookie }));
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(verifyQrSignature(body.token).ws, worksiteId);
    assert.equal(body.ttl_sec, 60);
    assert.equal(
      (await getQr(req("GET", `/api/app/attendance/qr/${worksiteId}`, { cookie: s.cookie }))).status,
      403,
    );
    assert.equal(
      (await getQr(req("GET", `/api/app/attendance/qr/khong-phai-uuid`, { cookie: sl.cookie }))).status,
      404,
    );
    assert.equal(
      (await getQr(req("GET", `/api/app/attendance/qr/${randomUUID()}`, { cookie: sl.cookie }))).status,
      404,
    );
  });
});
