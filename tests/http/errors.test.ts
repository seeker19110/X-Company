import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type pg from "pg";
import { api } from "../../app/components/api.ts";
import { appendAudit, verifyAuditChain } from "../../lib/audit/index.ts";
import { setPool, withTx } from "../../lib/db/index.ts";
import { authorize, publicRoute, withActor } from "../../lib/http/index.ts";
import { loginHandler, meHandler } from "../../lib/identity/routes.ts";
import { AppError } from "../../lib/nen/app-error.ts";
import { securityEventSchema } from "../../lib/nen/security-event.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { cookieFrom, PASSWORD, req, seedCompany, seedUser, setTestEnv } from "../helpers/fixtures.ts";

setTestEnv();
const LEAK = /(Traceback|at .*\.(js|ts|py|java)|SELECT |INSERT |\/home\/|\/var\/|node_modules|postgres:\/\/)/;

/** Bắt các dòng log JSON ghi ra stdout trong lúc chạy `fn`. */
async function captureLogs<T>(fn: () => Promise<T>): Promise<{ result: T; logs: Record<string, unknown>[] }> {
  const saved = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = "debug";
  const lines: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    const s = String(chunk);
    if (s.startsWith("{")) lines.push(...s.trim().split("\n"));
    else return orig(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    return { result: await fn(), logs: lines.map((l) => JSON.parse(l) as Record<string, unknown>) };
  } finally {
    process.stdout.write = orig;
    if (saved === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = saved;
  }
}

describe("lỗi HTTP theo RFC 9457 (D-017)", () => {
  let db: TestDb;
  let org: Awaited<ReturnType<typeof seedCompany>>;
  before(async () => {
    db = await freshDb();
    org = await seedCompany();
  });
  after(async () => {
    await db.close();
  });
  beforeEach(() => setPool(db.app));

  const boom = publicRoute(async () => {
    throw new Error(
      'relation "app_user" does not exist: SELECT * FROM app_user at /home/user/x/lib/db.ts:12',
      {
        cause: new Error("connect ECONNREFUSED postgres://u:pw-leak@10.0.0.5/db"),
      },
    );
  });

  test("500: problem+json đủ trường, KHÔNG lộ stack/SQL/đường dẫn; log ERROR có stack và cause", async () => {
    const { result: res, logs } = await captureLogs(() => boom(req("GET", "/api/x")));
    assert.equal(res.status, 500);
    assert.match(res.headers.get("content-type")!, /^application\/problem\+json/);
    const raw = await res.text();
    assert.equal(LEAK.test(raw), false, raw);
    const b = JSON.parse(raw);
    assert.equal(b.status, 500);
    assert.equal(b.title, "Lỗi hệ thống");
    assert.equal(b.detail, "Lỗi hệ thống, vui lòng thử lại");
    assert.equal(b.type, "/problems/internal");
    assert.equal(b.instance, `urn:uuid:${b.request_id}`);
    assert.match(b.trace_id, /^[0-9a-f]{32}$/);
    assert.equal(res.headers.get("x-request-id"), b.request_id);
    // trường mở rộng cũ vẫn còn
    assert.equal(b.code, "INTERNAL");
    assert.equal(b.message, b.detail);
    assert.deepEqual(b.error, { code: "INTERNAL", message: b.detail });

    const err = logs.find((l) => l.level === "error");
    assert.ok(err, "phải có log ERROR");
    assert.equal(err!.request_id, b.request_id);
    assert.equal(err!.trace_id, b.trace_id);
    assert.match(String(err!["exception.stacktrace"]), /at /);
    assert.equal(JSON.stringify(err).includes("pw-leak"), false); // bí mật trong cause bị che
    assert.equal((err!["exception.cause"] as unknown[]).length, 1);
  });

  test("trace_id lấy từ header traceparent hợp lệ; handler tiếp tục phục vụ sau lỗi", async () => {
    const tid = "ab".repeat(16);
    const r = await boom(
      req("GET", "/api/x", { headers: { traceparent: `00-${tid}-${"cd".repeat(8)}-01` } }),
    );
    assert.equal((await r.json()).trace_id, tid);
    const ok = publicRoute(async () => new Response("ok"));
    assert.equal((await ok(req("GET", "/api/y"))).status, 200);
  });

  test("lỗi nghiệp vụ AppError: giữ error.code/message/details và retry-after", async () => {
    const route = publicRoute(async () => {
      throw new AppError("RATE_LIMITED", 429, "Thử lại sau", { retryAfter: 42 });
    });
    const res = await route(req("GET", "/api/x"));
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("retry-after"), "42");
    const b = await res.json();
    assert.equal(b.title, "Quá nhiều yêu cầu");
    assert.equal(b.type, "/problems/rate-limited");
    assert.equal(b.error.code, "RATE_LIMITED");
    assert.equal(b.error.details.retryAfter, 42);
  });

  test("400 validation: fields + error.details.issues cũ; sinh sự kiện input.validation_failed hợp lệ", async () => {
    const { result: res, logs } = await captureLogs(() =>
      loginHandler(
        req("POST", "/api/app/auth/login", { body: { email: 5 }, headers: { "user-agent": "UA-test/1" } }),
      ),
    );
    assert.equal(res.status, 400);
    const b = await res.json();
    assert.equal(b.code, "VALIDATION");
    assert.ok(Array.isArray(b.fields) && b.fields.length >= 1);
    assert.deepEqual(b.error.details.issues, b.fields);
    assert.equal(b.type, "/problems/validation");
    const ev = logs.find((l) => l.event === "input.validation_failed");
    assert.ok(ev);
    const parsed = securityEventSchema.parse(ev);
    assert.equal(parsed.user_agent, "UA-test/1");
    assert.equal(parsed.request_id, b.request_id);
  });

  test("client cũ app/components/api.ts vẫn đọc được thông điệp lỗi (401/400/500)", async () => {
    const realFetch = globalThis.fetch;
    const route = (h: (r: Request) => Promise<Response>) =>
      (async (path: string, init: RequestInit) =>
        h(
          req((init.method ?? "GET").toString(), path, {
            body: init.body != null ? JSON.parse(String(init.body)) : undefined,
          }),
        )) as unknown as typeof fetch;
    try {
      globalThis.fetch = route(loginHandler);
      const bad = await api("POST", "/api/app/auth/login", {
        body: { email: "khong@example.test", password: "x" },
      });
      assert.deepEqual([bad.ok, bad.status, bad.error], [false, 401, "Email hoặc mật khẩu không đúng"]);
      const inv = await api("POST", "/api/app/auth/login", { body: { email: 1 } });
      assert.deepEqual([inv.ok, inv.status, inv.error], [false, 400, "Dữ liệu gửi lên không hợp lệ"]);
      globalThis.fetch = route(boom);
      const e500 = await api("GET", "/api/x");
      assert.deepEqual([e500.ok, e500.status, e500.error], [false, 500, "Lỗi hệ thống, vui lòng thử lại"]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("403: authorize ghi sự kiện authz.denied + audit denied kèm IP/UA, rồi trả problem+json 403", async () => {
    const u = await seedUser(org.companyId);
    const route = withActor(async (ctx) => {
      await authorize(ctx, "org.manage", { companyId: org.companyId });
      return new Response("không bao giờ tới đây");
    });
    const login = await loginHandler(
      req("POST", "/api/app/auth/login", { body: { email: u.email, password: PASSWORD } }),
    );
    const cookie = cookieFrom(login);
    const csrf = (await login.json()).csrf_token;
    const { result: res, logs } = await captureLogs(() =>
      route(req("POST", "/api/x", { cookie, csrf, body: {}, headers: { "user-agent": "UA-denied/2" } })),
    );
    assert.equal(res.status, 403);
    assert.equal((await res.json()).title, "Không có quyền");
    const ev = securityEventSchema.parse(logs.find((l) => l.event === "authz.denied"));
    assert.equal(ev.actor.id, u.userId);
    assert.equal(ev.outcome, "denied");
    const row = (
      await db.admin.query(
        "SELECT user_agent, result FROM audit_event WHERE actor_user_id = $1 AND result = 'denied' ORDER BY seq DESC LIMIT 1",
        [u.userId],
      )
    ).rows[0];
    assert.deepEqual(row, { user_agent: "UA-denied/2", result: "denied" });
  });
});

describe("thất bại đóng khi backend xác thực lỗi (BASE-ERR-010)", () => {
  let db: TestDb;
  let cookie: string;
  before(async () => {
    db = await freshDb();
    const org = await seedCompany();
    const u = await seedUser(org.companyId);
    setPool(db.app);
    const login = await loginHandler(
      req("POST", "/api/app/auth/login", { body: { email: u.email, password: PASSWORD } }),
    );
    cookie = cookieFrom(login);
  });
  after(async () => {
    await db.close();
  });

  /** Pool bọc: query chứa `needle` thì ném lỗi như CSDL sập. */
  const failingPool = (needle: string): pg.Pool =>
    new Proxy(db.app, {
      get(target, prop, recv) {
        if (prop === "query")
          return (sql: unknown, ...rest: unknown[]) =>
            String(typeof sql === "string" ? sql : (sql as { text?: string })?.text).includes(needle)
              ? Promise.reject(new Error(`db down: ${needle} postgres://u:pw-leak@h/d`))
              : (target.query as (...a: unknown[]) => unknown)(sql, ...rest);
        const v = Reflect.get(target, prop, recv);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });

  test("đối chứng: phiên hợp lệ → 200", async () => {
    setPool(db.app);
    assert.equal((await meHandler(req("GET", "/api/app/me", { cookie }))).status, 200);
  });

  for (const [what, needle] of [
    ["resolveSession (bảng session)", "FROM app_user u"],
    ["loadActor (grant)", "FROM role_grant"],
  ] as const) {
    test(`${what} ném lỗi → 503, không 200, handler không chạy, không lộ chi tiết`, async () => {
      setPool(failingPool(needle));
      let ran = 0;
      const route = withActor(async () => {
        ran++;
        return new Response("secret data");
      });
      try {
        const { result: res, logs } = await captureLogs(() => route(req("GET", "/api/app/x", { cookie })));
        assert.notEqual(res.status, 200);
        assert.equal(res.status, 503);
        const raw = await res.text();
        assert.equal(raw.includes("secret data"), false);
        assert.equal(LEAK.test(raw) || raw.includes("pw-leak"), false);
        assert.equal(JSON.parse(raw).code, "AUTH_UNAVAILABLE");
        assert.equal(ran, 0);
        const err = logs.find((l) => l.level === "error");
        assert.ok(err);
        assert.equal(JSON.stringify(err).includes("pw-leak"), false);
      } finally {
        setPool(db.app);
      }
    });
  }

  test("không có cookie → 401 (không gọi handler); pool hỏng hoàn toàn → vẫn không 200", async () => {
    setPool(db.app);
    const route = withActor(async () => new Response("x"));
    assert.equal((await route(req("GET", "/api/app/x"))).status, 401);
    setPool(failingPool("SELECT"));
    try {
      assert.notEqual((await route(req("GET", "/api/app/x", { cookie }))).status, 200);
    } finally {
      setPool(db.app);
    }
  });
});

describe("audit kèm IP/UA, chuỗi băm vẫn hợp lệ (CMP-AUDIT-002)", () => {
  let db: TestDb;
  before(async () => {
    db = await freshDb();
    setPool(db.app);
  });
  after(async () => {
    await db.close();
  });

  const lastRow = async () =>
    (
      await db.admin.query(
        "SELECT host(source_ip) AS ip, user_agent FROM audit_event ORDER BY seq DESC LIMIT 1",
      )
    ).rows[0];

  test("đăng nhập thành công/sai và đăng xuất ghi IP + UA từ request (qua proxy tin cậy)", async () => {
    process.env.TRUST_PROXY_HOPS = "1";
    try {
      const org = await seedCompany();
      const u = await seedUser(org.companyId);
      const h = { "x-forwarded-for": "198.51.100.7", "user-agent": "Mozilla/5.0 Test" };
      const bad = await loginHandler(
        req("POST", "/api/app/auth/login", {
          body: { email: u.email, password: ["sai", "mat", "khau", "12345"].join("-") },
          headers: h,
        }),
      );
      assert.equal(bad.status, 401);
      assert.deepEqual(await lastRow(), { ip: "198.51.100.7", user_agent: "Mozilla/5.0 Test" });
      const ok = await loginHandler(
        req("POST", "/api/app/auth/login", { body: { email: u.email, password: PASSWORD }, headers: h }),
      );
      assert.equal(ok.status, 200);
      assert.deepEqual(await lastRow(), { ip: "198.51.100.7", user_agent: "Mozilla/5.0 Test" });
      assert.equal((await verifyAuditChain(db.admin)).ok, true);
    } finally {
      delete process.env.TRUST_PROXY_HOPS;
    }
  });

  test("không có proxy tin cậy → 'direct' không phải IP → NULL; UA được làm sạch và cắt 300", async () => {
    const org = await seedCompany("Công ty IP");
    const base = { actorUserId: null, companyId: org.companyId, action: "t.x", objectType: "o" };
    await withTx((tx) =>
      appendAudit(tx, { ...base, sourceIp: "direct", userAgent: "ua\r\n[ERROR] x" + "a".repeat(400) }),
    );
    const r = await lastRow();
    assert.equal(r.ip, null);
    assert.equal(r.user_agent.length, 300);
    assert.equal(/[\r\n]/.test(r.user_agent), false);
    assert.equal((await verifyAuditChain(db.admin)).ok, true);
  });

  test("IPv6 được chuẩn hoá bởi Postgres nên băm khớp khi kiểm lại; bản ghi cũ (không IP/UA) vẫn hợp lệ", async () => {
    const org = await seedCompany("Công ty IPv6");
    const base = { actorUserId: null, companyId: org.companyId, objectType: "o" };
    await withTx((tx) => appendAudit(tx, { ...base, action: "cu", sourceIp: null, userAgent: null }));
    await withTx((tx) =>
      appendAudit(tx, { ...base, action: "v6", sourceIp: "2001:DB8:0:0:0:0:0:1", userAgent: "ua" }),
    );
    await withTx((tx) => appendAudit(tx, { ...base, action: "mapped", sourceIp: "::ffff:10.0.0.1%eth0" }));
    assert.equal((await lastRow()).ip, "::ffff:10.0.0.1");
    const v6 = (await db.admin.query("SELECT host(source_ip) AS ip FROM audit_event WHERE action = 'v6'"))
      .rows[0];
    assert.equal(v6.ip, "2001:db8::1");
    const v = await verifyAuditChain(db.admin);
    assert.equal(v.ok, true, v.problem ?? "");
  });

  test("sửa IP của bản ghi (qua tắt trigger) bị phát hiện bằng chuỗi băm", async () => {
    const org = await seedCompany("Công ty sửa IP");
    await withTx((tx) =>
      appendAudit(tx, {
        actorUserId: null,
        companyId: org.companyId,
        action: "a",
        objectType: "o",
        sourceIp: "192.0.2.1",
      }),
    );
    await db.admin.query("ALTER TABLE audit_event DISABLE TRIGGER audit_event_no_update");
    await db.admin.query("UPDATE audit_event SET source_ip = '192.0.2.99' WHERE action = 'a'");
    await db.admin.query("ALTER TABLE audit_event ENABLE TRIGGER audit_event_no_update");
    const v = await verifyAuditChain(db.admin, org.companyId);
    assert.equal(v.ok, false);
  });
});
