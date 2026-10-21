import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { loginHandler, logoutHandler, meHandler } from "../../lib/identity/routes.ts";
import { disableUser, login, setPassword } from "../../lib/identity/auth.ts";
import { resolveSession, IDLE_MS } from "../../lib/identity/session.ts";
import { validateNewPassword, verifyPassword } from "../../lib/identity/password.ts";
import { grantRole, revokeGrant } from "../../lib/authz/grants.ts";
import { withTx } from "../../lib/db/index.ts";
import { AppError } from "../../lib/nen/app-error.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { cookieFrom, PASSWORD, req, seedCompany, seedUser, setTestEnv } from "../helpers/fixtures.ts";

setTestEnv();
const isCode = (code: string) => (e: unknown) => e instanceof AppError && e.code === code;

async function doLogin(email: string, password = PASSWORD) {
  const res = await loginHandler(req("POST", "/api/app/auth/login", { body: { email, password } }));
  const body = await res.json();
  return { res, body, cookie: cookieFrom(res) };
}

describe("xác thực (T-007)", () => {
  let db: TestDb;
  let org: Awaited<ReturnType<typeof seedCompany>>;

  before(async () => {
    db = await freshDb();
    org = await seedCompany();
  });
  after(async () => {
    await db.close();
  });

  test("mật khẩu lưu Argon2id với tham số OWASP (BE-AUTH-001)", async () => {
    const u = await seedUser(org.companyId);
    const { rows } = await db.admin.query("SELECT password_hash FROM app_user WHERE id = $1", [u.userId]);
    assert.match(rows[0].password_hash, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    assert.equal(await verifyPassword(rows[0].password_hash, PASSWORD), true);
    assert.equal(await verifyPassword(rows[0].password_hash, PASSWORD + "x"), false);
    assert.equal(await verifyPassword("rác", PASSWORD), false);
    assert.equal(await verifyPassword(rows[0].password_hash, "a".repeat(300)), false);
  });

  test("chính sách mật khẩu: ≥12 ký tự, không phổ biến, không chứa tên đăng nhập", () => {
    assert.throws(() => validateNewPassword("ngan"), isCode("WEAK_PASSWORD"));
    assert.throws(() => validateNewPassword("Q1W2E3R4T5Y6"), isCode("WEAK_PASSWORD"));
    assert.throws(() => validateNewPassword("x".repeat(300)), isCode("WEAK_PASSWORD"));
    assert.throws(
      () => validateNewPassword("nguyenvana-2026!", { email: "nguyenvana@example.test" }),
      isCode("WEAK_PASSWORD"),
    );
    validateNewPassword("Cau-mat-khau-rat-dai-2026", { email: "nguyenvana@example.test" });
  });

  test("đăng nhập đúng → cookie HttpOnly + CSRF; /me trả vai trò; email không phân biệt hoa thường", async () => {
    const u = await seedUser(org.companyId, { grants: [{ role: "hr", scopeType: "company" }] });
    const { res, body, cookie } = await doLogin(u.email.toUpperCase());
    assert.equal(res.status, 200);
    const sc = res.headers.get("set-cookie") ?? "";
    assert.match(sc, /^xc_session=[A-Za-z0-9_-]{43};/);
    assert.match(sc, /HttpOnly/);
    assert.match(sc, /SameSite=Lax/);
    assert.match(String(body.csrf_token), /\S/);
    const me = await meHandler(req("GET", "/api/app/me", { cookie }));
    assert.equal(me.status, 200);
    // PRF-WEB-001: route có xác thực không bao giờ vào cache dùng chung.
    assert.equal(me.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("cache-control"), "no-store");
    const meBody = await me.json();
    assert.equal(meBody.user_id, u.userId);
    assert.deepEqual(meBody.roles, [{ role: "hr", scope_type: "company", scope_id: null }]);
    assert.equal(meBody.csrf_token, body.csrf_token);
    // DB không lưu token thô.
    const token = cookie.split("=")[1]!;
    const s = await db.admin.query("SELECT count(*)::int AS n FROM session WHERE token_hash = $1", [token]);
    assert.equal(s.rows[0].n, 0);
  });

  test("sai mật khẩu / email không tồn tại → cùng 401 INVALID_CREDENTIALS, có audit denied", async () => {
    const u = await seedUser(org.companyId);
    const a = await doLogin(u.email, "sai-mat-khau-123");
    const b = await doLogin("khong-co@x.test", "sai-mat-khau-123");
    assert.equal(a.res.status, 401);
    assert.equal(b.res.status, 401);
    assert.equal(a.body.error.code, "INVALID_CREDENTIALS");
    assert.equal(a.body.error.message, b.body.error.message);
    assert.equal(a.res.headers.get("set-cookie"), null);
    const { rows } = await db.admin.query(
      "SELECT count(*)::int AS n FROM audit_event WHERE action = 'auth.login' AND result = 'denied' AND object_id = $1",
      [u.userId],
    );
    assert.equal(rows[0].n, 1);
  });

  test("S-ID-07: 5 lần sai trong 15 phút → lần 6 là 429 có Retry-After, kể cả đúng mật khẩu", async () => {
    const u = await seedUser(org.companyId);
    for (let i = 0; i < 5; i++) assert.equal((await doLogin(u.email, "sai-mat-khau-123")).res.status, 401);
    const sixth = await doLogin(u.email);
    assert.equal(sixth.res.status, 429);
    assert.equal(sixth.body.error.code, "RATE_LIMITED");
    const ra = Number(sixth.res.headers.get("retry-after"));
    assert.ok(ra > 0 && ra <= 900, String(ra));
    // Hết cửa sổ 15 phút → đăng nhập lại được.
    const later = new Date(Date.now() + 16 * 60_000);
    const r = await login(db.app, { email: u.email, password: PASSWORD, ip: "direct" }, later);
    assert.equal(r.userId, u.userId);
  });

  // AUD-SEC-004 (D-053): dò mật khẩu rải — một IP qua nhiều email, hoặc một email từ nhiều IP.
  const isRateLimited = (e: unknown) =>
    e instanceof AppError && e.code === "RATE_LIMITED" && e.status === 429;
  const tryLogin = (email: string, ip: string, now: Date, password = "sai-mat-khau-123") =>
    login(db.app, { email, password, ip }, now).then(
      () => "ok",
      (e: unknown) => (isRateLimited(e) ? "429" : e instanceof AppError ? e.code : "lỗi lạ"),
    );

  test("AUD-SEC-004: một IP sai 30 lần qua 30 email khác nhau → lượt kế (kể cả đúng mật khẩu) 429; IP khác không bị ảnh hưởng", async () => {
    const u = await seedUser(org.companyId);
    const now = new Date("2026-10-21T08:00:00Z");
    const ip = "203.0.113.7";
    for (let i = 0; i < 30; i++)
      assert.equal(await tryLogin(`spray-${i}@x.test`, ip, now), "INVALID_CREDENTIALS", `lượt ${i + 1}`);
    assert.equal(await tryLogin(u.email, ip, now, PASSWORD), "429");
    assert.equal(await tryLogin(u.email, "198.51.100.1", now, PASSWORD), "ok");
    assert.equal(await tryLogin(u.email, ip, new Date(now.getTime() + 16 * 60_000), PASSWORD), "ok");
  });

  test("AUD-SEC-004: một email sai 50 lần từ 50 IP → lượt kế từ IP mới 429; dưới ngưỡng thì vẫn đăng nhập được", async () => {
    const u = await seedUser(org.companyId);
    const now = new Date("2026-10-21T09:00:00Z");
    for (let i = 0; i < 49; i++)
      assert.equal(await tryLogin(u.email, `192.0.2.${i}`, now), "INVALID_CREDENTIALS", `lượt ${i + 1}`);
    assert.equal(await tryLogin(u.email, "192.0.2.200", now, PASSWORD), "ok", "49 lần sai: chưa khoá");
    assert.equal(await tryLogin(u.email, "192.0.2.201", now), "INVALID_CREDENTIALS");
    assert.equal(await tryLogin(u.email, "192.0.2.202", now, PASSWORD), "429");
    assert.equal(
      await tryLogin(u.email, "192.0.2.203", new Date(now.getTime() + 16 * 60_000), PASSWORD),
      "ok",
    );
  });

  test("S-ID-09: POST thiếu/sai CSRF hoặc khác Origin → 403; login từ origin lạ → 403", async () => {
    const u = await seedUser(org.companyId);
    const { cookie, body } = await doLogin(u.email);
    assert.equal((await logoutHandler(req("POST", "/api/app/auth/logout", { cookie }))).status, 403);
    assert.equal(
      (await logoutHandler(req("POST", "/api/app/auth/logout", { cookie, csrf: "sai" }))).status,
      403,
    );
    const foreign = await logoutHandler(
      req("POST", "/api/app/auth/logout", { cookie, csrf: body.csrf_token, origin: "https://evil.example" }),
    );
    assert.equal(foreign.status, 403);
    const noOrigin = await logoutHandler(
      req("POST", "/api/app/auth/logout", { cookie, csrf: body.csrf_token, origin: null }),
    );
    assert.equal(noOrigin.status, 403);
    const sameSite = await logoutHandler(
      req("POST", "/api/app/auth/logout", {
        cookie,
        csrf: body.csrf_token,
        origin: null,
        headers: { "sec-fetch-site": "same-origin" },
      }),
    );
    assert.equal(sameSite.status, 200);
    const evilLogin = await loginHandler(
      req("POST", "/api/app/auth/login", {
        body: { email: u.email, password: PASSWORD },
        origin: "https://evil.example",
      }),
    );
    assert.equal(evilLogin.status, 403);
  });

  test("đăng xuất xoá phiên, xoá cookie, gửi Clear-Site-Data; phiên cũ → 401", async () => {
    const u = await seedUser(org.companyId);
    const { cookie, body } = await doLogin(u.email);
    const out = await logoutHandler(req("POST", "/api/app/auth/logout", { cookie, csrf: body.csrf_token }));
    assert.equal(out.status, 200);
    assert.match(out.headers.get("set-cookie") ?? "", /Max-Age=0/);
    assert.equal(out.headers.get("clear-site-data"), '"cache", "storage"');
    assert.equal((await meHandler(req("GET", "/api/app/me", { cookie }))).status, 401);
  });

  test("S-ID-05 (R8): vô hiệu tài khoản → request kế tiếp 401; thu hồi grant → mất vai trò ngay", async () => {
    const u = await seedUser(org.companyId, { grants: [{ role: "hr", scopeType: "company" }] });
    const { cookie } = await doLogin(u.email);
    const gid = (await db.admin.query("SELECT id FROM role_grant WHERE user_id = $1", [u.userId])).rows[0].id;
    await withTx((tx) => revokeGrant(tx, { userId: null }, org.companyId, gid, "nghỉ việc"));
    // Đổi đặc quyền → phiên cũ bị huỷ (BE-AUTH-004); phiên mới không còn vai trò.
    assert.equal((await meHandler(req("GET", "/api/app/me", { cookie }))).status, 401);
    const fresh = await doLogin(u.email);
    const me = await (await meHandler(req("GET", "/api/app/me", { cookie: fresh.cookie }))).json();
    assert.deepEqual(me.roles, []);
    await withTx((tx) => disableUser(tx, null, u.userId, "nghỉ việc"));
    assert.equal((await meHandler(req("GET", "/api/app/me", { cookie: fresh.cookie }))).status, 401);
    assert.equal((await doLogin(u.email)).res.status, 401, "tài khoản vô hiệu không đăng nhập được");
    await assert.rejects(
      withTx((tx) => disableUser(tx, null, u.userId, "lần 2")),
      isCode("NOT_FOUND"),
    );
  });

  test("BE-AUTH-004: APP_ORIGIN https → cookie __Host- + Secure + HttpOnly + Path=/ + không Domain", async () => {
    const u = await seedUser(org.companyId);
    const prev = process.env.APP_ORIGIN;
    process.env.APP_ORIGIN = "https://xc.test";
    try {
      const res = await loginHandler(
        req("POST", "/api/app/auth/login", {
          body: { email: u.email, password: PASSWORD },
          origin: "https://xc.test",
        }),
      );
      assert.equal(res.status, 200);
      const sc = res.headers.get("set-cookie") ?? "";
      assert.match(sc, /^__Host-xc_session=[A-Za-z0-9_-]{43};/);
      assert.match(sc, /; Secure(;|$)/);
      assert.match(sc, /; HttpOnly(;|$)/);
      assert.match(sc, /; Path=\/(;|$)/);
      assert.match(sc, /SameSite=Lax/);
      assert.ok(!/domain=/i.test(sc), "cookie __Host- không được có Domain");
    } finally {
      process.env.APP_ORIGIN = prev;
    }
  });

  test("BE-AUTH-004: ID phiên đổi giữa các lần đăng nhập; cấp quyền mới huỷ phiên cũ, đăng nhập lại có phiên mới", async () => {
    const u = await seedUser(org.companyId);
    const a = await doLogin(u.email);
    const b = await doLogin(u.email);
    assert.notEqual(a.cookie, b.cookie);
    assert.equal((await meHandler(req("GET", "/api/app/me", { cookie: b.cookie }))).status, 200);
    await withTx((tx) =>
      grantRole(tx, { userId: null }, org.companyId, { userId: u.userId, role: "hr", scopeType: "company" }),
    );
    assert.equal((await meHandler(req("GET", "/api/app/me", { cookie: a.cookie }))).status, 401);
    assert.equal((await meHandler(req("GET", "/api/app/me", { cookie: b.cookie }))).status, 401);
    const c = await doLogin(u.email);
    assert.notEqual(c.cookie, a.cookie);
    assert.notEqual(c.cookie, b.cookie);
    const me = await (await meHandler(req("GET", "/api/app/me", { cookie: c.cookie }))).json();
    assert.deepEqual(me.roles, [{ role: "hr", scope_type: "company", scope_id: null }]);
    // Phiên của người khác không bị ảnh hưởng.
    const other = await seedUser(org.companyId);
    const o = await doLogin(other.email);
    await withTx((tx) =>
      grantRole(tx, { userId: null }, org.companyId, {
        userId: u.userId,
        role: "employee",
        scopeType: "self",
      }),
    );
    assert.equal((await meHandler(req("GET", "/api/app/me", { cookie: o.cookie }))).status, 200);
  });

  test("không cookie / cookie rác → 401; phiên quá hạn trượt → null", async () => {
    assert.equal((await meHandler(req("GET", "/api/app/me"))).status, 401);
    assert.equal((await meHandler(req("GET", "/api/app/me", { cookie: "xc_session=rac" }))).status, 401);
    const u = await seedUser(org.companyId);
    const { cookie } = await doLogin(u.email);
    const token = cookie.split("=")[1]!;
    assert.ok(await resolveSession(db.app, token));
    assert.equal(await resolveSession(db.app, token, new Date(Date.now() + IDLE_MS + 60_000)), null);
    assert.equal(await resolveSession(db.app, "x".repeat(200)), null);
  });

  test("đổi mật khẩu: kiểm độ mạnh, huỷ mọi phiên cũ", async () => {
    const u = await seedUser(org.companyId);
    const { cookie } = await doLogin(u.email);
    await assert.rejects(
      withTx((tx) => setPassword(tx, u.userId, "1qaz2wsx3edc")),
      isCode("WEAK_PASSWORD"),
    );
    await withTx((tx) => setPassword(tx, u.userId, "Mot-cau-moi-hoan-toan-2026"));
    assert.equal((await meHandler(req("GET", "/api/app/me", { cookie }))).status, 401);
    assert.equal((await doLogin(u.email, "Mot-cau-moi-hoan-toan-2026")).res.status, 200);
    await assert.rejects(
      withTx((tx) => setPassword(tx, "00000000-0000-4000-8000-000000000000", "x")),
      isCode("NOT_FOUND"),
    );
  });

  test("body sai định dạng → 400 VALIDATION / BAD_JSON", async () => {
    const bad = await loginHandler(req("POST", "/api/app/auth/login", { body: { email: 1 } }));
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.code, "VALIDATION");
    const raw = await loginHandler(
      new Request("http://xc.test/api/app/auth/login", {
        method: "POST",
        headers: { origin: "http://xc.test" },
        body: "{",
      }),
    );
    assert.equal((await raw.json()).error.code, "BAD_JSON");
  });
});
