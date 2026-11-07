// Kho lỗi tự host (T-122, PRF-WEB-008): POST /api/public/errors (cùng nguồn, ≤ 16 KiB, giới hạn tần suất theo IP băm, schema chặt),
// che bí mật/PII, gom nhóm theo fingerprint (đếm, không thêm dòng), gắn release; lỗi 500 chưa bắt của server vào cùng kho; retention
// theo last_seen_at (biên: đúng hạn giữ, quá 1 ms xoá); GET /api/app/errors chỉ cho `errors.read` (sysadmin) — người khác 403 + audit.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import {
  ERROR_DAILY_NEW_GROUP_CAP,
  ERROR_RATE_LIMIT,
  flushServerErrors,
  prepareError,
  recordError,
  recordServerError,
} from "../../lib/errors/index.ts";
import { fingerprintInput, normalizeFrame, normalizeStack } from "../../lib/errors/normalize.pure.ts";
import { ERROR_BODY_MAX_BYTES, getErrorGroups, postClientError } from "../../lib/errors/routes.ts";
import { publicRoute } from "../../lib/http/index.ts";
import { AppError } from "../../lib/nen/app-error.ts";
import { REDACTED } from "../../lib/nen/log.ts";
import { runRetention, retentionConfig } from "../../lib/worker/retention.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { cookieFrom, loginThrough, req, seedCompany, seedUser, setTestEnv } from "../helpers/fixtures.ts";

setTestEnv();

const CHROME_STACK = [
  "TypeError: Cannot read properties of undefined (reading 'x')",
  "    at render (https://xc.example:3000/_next/static/chunks/0abc123.js?dpl=v9:1:2345)",
  "    at commit (https://xc.example:3000/_next/static/chunks/0def456.js:1:999)",
].join("\n");

// PII dạng thật ghép lúc chạy: check:docs chặn email/SĐT thật nằm nguyên văn trong fixture.
const EMAIL = ["x", "y.vn"].join("@");
const PHONE = ["0987", "654321"].join("");

let ipSeq = 0;
const report = (over: Record<string, unknown> = {}) => ({
  release: "v1.2.3",
  page: "/app/tasks/9f1c2a52-1111-4222-8333-444455556666",
  type: "TypeError",
  message: "Cannot read properties of undefined (reading 'x')",
  stack: CHROME_STACK,
  context: "lỗi hiển thị trang",
  ...over,
});
function post(body: unknown, opts: { ip?: string; origin?: string | null; raw?: string } = {}) {
  const r = req("POST", "/api/public/errors", {
    body: opts.raw === undefined ? body : undefined,
    origin: opts.origin,
    headers: {
      "x-forwarded-for": opts.ip ?? `10.2.0.${++ipSeq}`,
      ...(opts.raw === undefined ? {} : { "content-type": "application/json" }),
    },
  });
  if (opts.raw === undefined) return postClientError(r);
  return postClientError(new Request(r.url, { method: "POST", headers: r.headers, body: opts.raw }));
}
const problem = async (r: Response) => (await r.json()) as { code: string };

interface Row {
  source: string;
  release: string;
  group_key: string;
  error_type: string;
  message: string;
  stack: string | null;
  page: string | null;
  context: string | null;
  occurrence_count: number;
  first_seen_at: Date;
  last_seen_at: Date;
}

describe("chuẩn hoá stack / fingerprint (thuần)", () => {
  test("V8 + Gecko: bỏ origin, query/hash, đường dẫn tuyệt đối máy chủ; giữ dòng:cột", () => {
    assert.equal(
      normalizeFrame("    at render (https://xc.example:3000/_next/static/chunks/0abc.js?dpl=v9:1:2345)"),
      "render (/_next/static/chunks/0abc.js:1:2345)",
    );
    assert.equal(
      normalizeFrame("render@https://xc.example/_next/static/chunks/0abc.js#x:1:20"),
      "render@/_next/static/chunks/0abc.js:1:20",
    );
    assert.equal(
      normalizeFrame("    at h (file:///srv/app/.next/server/chunks/ssr/a._.js:3:14)"),
      "h (/.next/server/chunks/ssr/a._.js:3:14)",
    );
    assert.equal(
      normalizeFrame("    at f (/home/u/proj/lib/x.ts:10:5)", "/home/u/proj"),
      "f (/lib/x.ts:10:5)",
    );
    assert.equal(normalizeFrame("    at new Promise (<anonymous>)"), "new Promise (<anonymous>)");
  });
  test("chỉ giữ dòng khung (bỏ dòng thông điệp), tối đa 30 khung; rỗng/null → []", () => {
    assert.deepEqual(normalizeStack(CHROME_STACK), [
      "render (/_next/static/chunks/0abc123.js:1:2345)",
      "commit (/_next/static/chunks/0def456.js:1:999)",
    ]);
    const many = Array.from({ length: 50 }, (_, i) => `    at f${i} (/a.js:1:${i})`).join("\n");
    assert.equal(normalizeStack(many).length, 30);
    assert.deepEqual(normalizeStack(""), []);
    assert.deepEqual(normalizeStack(null), []);
    assert.deepEqual(normalizeStack("Error: chỉ có thông điệp\nkhông phải khung"), []);
  });
  test("fingerprint: cùng loại + khung đầu → trùng dù thông điệp khác; không khung → theo dạng thông điệp (số/hex bị san)", () => {
    const a = fingerprintInput({ source: "client", type: "E", frames: ["f (/a.js:1:2)"], message: "id 1" });
    const b = fingerprintInput({ source: "client", type: "E", frames: ["f (/a.js:1:2)"], message: "id 2" });
    assert.equal(a, b);
    const c = fingerprintInput({ source: "server", type: "E", frames: ["f (/a.js:1:2)"], message: "id 1" });
    assert.notEqual(a, c, "nguồn khác → nhóm khác");
    const n1 = fingerprintInput({
      source: "client",
      type: "E",
      frames: [],
      message: "hết hạn sau 1234 ms (deadbeefcafe)",
    });
    const n2 = fingerprintInput({
      source: "client",
      type: "E",
      frames: [],
      message: "hết hạn sau 99 ms (0123456789ab)",
    });
    assert.equal(n1, n2);
  });
});

describe("kho lỗi (DB thật)", () => {
  let db: TestDb;
  const rows = async (where = "TRUE", params: unknown[] = []) =>
    (await db.admin.query<Row>(`SELECT * FROM error_group WHERE ${where} ORDER BY id`, params)).rows;

  before(async () => {
    db = await freshDb();
  });
  beforeEach(async () => {
    process.env.TRUST_PROXY = "1";
    await db.admin.query("TRUNCATE error_group");
  });
  after(async () => {
    delete process.env.TRUST_PROXY;
    delete process.env.APP_VERSION;
    await flushServerErrors();
    await db.close();
  });

  test("báo cáo hợp lệ → 204 không thân; lưu nhãn trang chuẩn hoá, release của trang, khung đã chuẩn hoá; không IP/UA/id", async () => {
    const r = await post(report());
    assert.equal(r.status, 204);
    assert.equal(await r.text(), "");
    assert.equal(r.headers.get("cache-control"), "no-store");
    const [g, ...rest] = await rows();
    assert.equal(rest.length, 0);
    assert.equal(g!.source, "client");
    assert.equal(g!.release, "v1.2.3");
    assert.equal(g!.page, "/app/tasks", "id trong đường dẫn bị bỏ");
    assert.equal(g!.error_type, "TypeError");
    assert.equal(g!.context, "lỗi hiển thị trang");
    assert.equal(g!.occurrence_count, 1);
    assert.match(g!.group_key, /^[0-9a-f]{64}$/);
    assert.equal(
      g!.stack,
      "render (/_next/static/chunks/0abc123.js:1:2345)\ncommit (/_next/static/chunks/0def456.js:1:999)",
    );
    const all = JSON.stringify(g);
    for (const leak of ["xc.example", "dpl=", "9f1c2a52", "10.2.0."]) assert.ok(!all.includes(leak), leak);
  });

  test("release được gắn: hai release cùng lỗi = hai nhóm; release sai định dạng → 400", async () => {
    assert.equal((await post(report({ release: "v1.2.3" }))).status, 204);
    assert.equal((await post(report({ release: "2026.11.06+abc1234" }))).status, 204);
    const g = await rows();
    assert.deepEqual(g.map((x) => x.release).sort(), ["2026.11.06+abc1234", "v1.2.3"]);
    assert.equal(g[0]!.group_key, g[1]!.group_key, "fingerprint không phụ thuộc release");
    for (const bad of ["", "v 1", "a/b", "x".repeat(65), "v1;DROP"])
      assert.equal((await post(report({ release: bad }))).status, 400, bad);
  });

  test("cùng fingerprint → tăng đếm + last_seen_at, KHÔNG thêm dòng (kể cả 10 lần ghi song song)", async () => {
    assert.equal((await post(report({ message: "lần 1 id=1" }))).status, 204);
    assert.equal((await post(report({ message: "lần 2 id=2" }))).status, 204);
    let g = await rows();
    assert.equal(g.length, 1);
    assert.equal(g[0]!.occurrence_count, 2);
    assert.ok(g[0]!.last_seen_at >= g[0]!.first_seen_at);
    const t0 = new Date("2026-11-06T01:00:00Z");
    const entry = { source: "client" as const, release: "v9", type: "E", message: "m", stack: CHROME_STACK };
    const out = await Promise.all(
      Array.from({ length: 10 }, (_, i) => recordError(db.app, entry, new Date(t0.getTime() + i))),
    );
    assert.equal(out.filter((o) => o === "inserted").length, 1);
    assert.equal(out.filter((o) => o === "counted").length, 9);
    g = await rows("release = 'v9'");
    assert.equal(g.length, 1);
    assert.equal(g[0]!.occurrence_count, 10);
    assert.equal(g[0]!.first_seen_at.getTime() <= g[0]!.last_seen_at.getTime(), true);
    assert.equal(g[0]!.last_seen_at.getTime(), t0.getTime() + 9, "last_seen_at = lần gặp mới nhất");
  });

  test("đếm kẹp ở trần int4 (không tràn)", async () => {
    const entry = { source: "client" as const, release: "v9", type: "E", message: "m", stack: CHROME_STACK };
    await recordError(db.app, entry);
    await db.admin.query("UPDATE error_group SET occurrence_count = 2147483647");
    assert.equal(await recordError(db.app, entry), "counted");
    assert.equal((await rows())[0]!.occurrence_count, 2147483647);
  });

  test("bí mật/PII trong thông điệp, ngữ cảnh và stack bị che trước khi lưu", async () => {
    // JWT/khoá AWS giả ghép lúc chạy: gitleaks (jwt, aws-access-token) chặn chuỗi nguyên văn dù là fixture.
    const JWT = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "c2lnbmF0dXJl"].join(".");
    const AWS_KEY = ["AKIA", "ABCDEFGHIJKLMNOP"].join("");
    const secrets = [
      "nguyen.van.a@example.com",
      JWT,
      "s3cr3t-pass",
      AWS_KEY,
      "0912 345 678",
      "001099012345",
      "tok_live_value_xyz",
    ];
    const r = await post(
      report({
        message:
          `Lỗi khi gửi cho nguyen.van.a@example.com: Bearer ${JWT} ` +
          `password=s3cr3t-pass key ${AWS_KEY} SĐT 0912 345 678 CCCD 001099012345`,
        context: "gửi token=tok_live_value_xyz",
        stack:
          "Error: x\n    at f (https://u:pw@xc.example/_next/static/chunks/a.js?token=tok_live_value_xyz:1:2)",
      }),
    );
    assert.equal(r.status, 204);
    const g = (await rows())[0]!;
    const all = JSON.stringify(g);
    for (const s of [...secrets, "u:pw"]) assert.ok(!all.includes(s), `lộ ${s}`);
    assert.ok(g.message.includes(REDACTED));
    assert.ok(g.context!.includes(REDACTED));
    assert.equal(g.stack, "f (/_next/static/chunks/a.js:1:2)");
    // Hàm che dùng chung cho cả lỗi server.
    const p = prepareError({
      source: "server",
      release: "v",
      type: "Error",
      message: `pg: password=abc123 ${EMAIL}`,
    });
    assert.ok(!p.message.includes("abc123") && !p.message.includes(EMAIL));
  });

  test("schema sai / JSON hỏng / trang không chuẩn hoá được → 400, không ghi", async () => {
    const bad: unknown[] = [
      {},
      report({ type: "" }),
      report({ type: "x".repeat(101) }),
      report({ page: "app/x" }),
      report({ page: "/" + "a".repeat(200) }),
      report({ message: 1 }),
      report({ message: "x".repeat(2001) }),
      report({ stack: "x".repeat(12_001) }),
      report({ context: "" }),
      report({ extra: "không khai" }),
      report({ release: undefined }),
      [report()],
    ];
    for (const b of bad) {
      const r = await post(b);
      assert.equal(r.status, 400, JSON.stringify(b).slice(0, 80));
      assert.equal((await problem(r)).code, "VALIDATION");
    }
    const broken = await post(null, { raw: "{khong-phai-json" });
    assert.equal(broken.status, 400);
    assert.equal((await problem(broken)).code, "BAD_JSON");
    const page = await post(report({ page: "/a/../b" }));
    assert.equal(page.status, 400);
    assert.equal((await rows()).length, 0);
  });

  test("thân > 16 KiB → 413 (khai Content-Length hoặc luồng thật), không ghi; vừa trần vẫn qua bước đọc", async () => {
    const big = JSON.stringify(report({ stack: "x".repeat(ERROR_BODY_MAX_BYTES) }));
    const r = await post(null, { raw: big });
    assert.equal(r.status, 413);
    assert.equal((await problem(r)).code, "PAYLOAD_TOO_LARGE");
    const base = JSON.stringify(report({ stack: "" }));
    const pad = ERROR_BODY_MAX_BYTES - Buffer.byteLength(base);
    const exact = JSON.stringify(report({ stack: "y".repeat(pad) }));
    assert.equal(Buffer.byteLength(exact), ERROR_BODY_MAX_BYTES);
    const atCap = await post(null, { raw: exact });
    // Đúng trần: đọc được (không 413); stack > 12 000 ký tự nên schema từ chối (400) — hai lớp trần độc lập.
    assert.equal(atCap.status, 400);
    assert.equal((await rows()).length, 0);
  });

  test("vượt giới hạn tần suất nhóm 'errors' theo IP → 429 + Retry-After; IP khác không bị ảnh hưởng", async () => {
    const ip = "10.9.9.9";
    for (let i = 0; i < ERROR_RATE_LIMIT.max; i++) assert.equal((await post(report(), { ip })).status, 204);
    const r = await post(report(), { ip });
    assert.equal(r.status, 429);
    assert.equal((await problem(r)).code, "RATE_LIMITED");
    assert.ok(Number(r.headers.get("retry-after")) >= 1);
    assert.equal((await post(report(), { ip: "10.9.9.10" })).status, 204);
    const g = await rows();
    assert.equal(g.length, 1);
    assert.equal(g[0]!.occurrence_count, ERROR_RATE_LIMIT.max + 1, "lần bị chặn không được đếm");
    const { rows: rate } = await db.admin.query<{ key_hash: string }>(
      "SELECT DISTINCT key_hash FROM public_rate_event WHERE bucket = 'errors'",
    );
    assert.ok(
      rate.every((x) => !x.key_hash.includes("10.9.9")),
      "IP chỉ lưu dạng băm",
    );
  });

  test("Origin khác nguồn → 403, không ghi", async () => {
    const r = await post(report(), { origin: "https://evil.test" });
    assert.equal(r.status, 403);
    assert.equal((await rows()).length, 0);
  });

  test("trần nhóm MỚI mỗi ngày: quá trần thì bỏ nhóm mới (vẫn 204), nhóm đã có vẫn được đếm; hôm trước không tính", async () => {
    const now = new Date();
    const entry = {
      source: "client" as const,
      release: "v1.2.3",
      type: "E",
      message: "cũ",
      stack: CHROME_STACK,
    };
    assert.equal(await recordError(db.app, entry, now), "inserted");
    await db.admin.query(
      `INSERT INTO error_group (source, release, group_key, error_type, message, first_seen_at, last_seen_at)
       SELECT 'client', 'fill', lpad(to_hex(g), 64, '0'), 'E', '', $2, $2 FROM generate_series(1, $1) g`,
      [ERROR_DAILY_NEW_GROUP_CAP, now],
    );
    const fresh = await post(report({ type: "RangeError" }));
    assert.equal(fresh.status, 204);
    assert.equal((await rows("error_type = 'RangeError'")).length, 0, "nhóm mới bị bỏ");
    assert.equal(await recordError(db.app, entry, now), "counted");
    // review #100: trần đếm theo nguồn — client lấp đầy trần không chặn nhóm lỗi SERVER mới.
    assert.equal(
      await recordError(
        db.app,
        { source: "server", type: "ServerOnly", message: "x", stack: null, release: "fill" },
        now,
      ),
      "inserted",
    );
    await db.admin.query(
      "UPDATE error_group SET first_seen_at = first_seen_at - interval '2 days', last_seen_at = last_seen_at - interval '1 day' WHERE release = 'fill'",
    );
    assert.equal((await post(report({ type: "RangeError" }))).status, 204);
    assert.equal((await rows("error_type = 'RangeError'")).length, 1, "ngày mới → nhận lại");
  });

  test("lỗi 500 chưa bắt ở publicRoute → cùng kho, source=server, gắn release APP_VERSION, nhãn trang; AppError/400 không ghi", async () => {
    process.env.APP_VERSION = "2026.11.06-abc1234";
    const boom = publicRoute(async () => {
      throw new Error(`truy vấn hỏng: password=hunter2 user ${PHONE}`);
    });
    const r = await boom(
      new Request("http://xc.test/api/app/tasks/123e4567-e89b-12d3-a456-426614174000?token=x"),
    );
    assert.equal(r.status, 500);
    const body = await r.text();
    assert.ok(!body.includes("hunter2"), "phản hồi không lộ chi tiết");
    await flushServerErrors();
    const handled = publicRoute(async () => {
      throw new AppError("NOT_FOUND", 404, "không thấy");
    });
    assert.equal((await handled(new Request("http://xc.test/x"))).status, 404);
    await flushServerErrors();
    const g = await rows();
    assert.equal(g.length, 1);
    assert.equal(g[0]!.source, "server");
    assert.equal(g[0]!.release, "2026.11.06-abc1234");
    assert.equal(g[0]!.page, "/[...slug]", "đường dẫn API → nhãn chuẩn hoá, không id/query");
    assert.equal(g[0]!.error_type, "Error");
    assert.ok(!g[0]!.message.includes("hunter2") && !g[0]!.message.includes(PHONE));
    assert.ok(g[0]!.stack !== null && g[0]!.stack.length > 0);
    assert.ok(!g[0]!.stack.includes(process.cwd()), "không lộ thư mục cài đặt");
    // Lặp lại cùng chỗ → cùng nhóm, đếm 2. APP_VERSION không đặt → release "dev".
    await boom(new Request("http://xc.test/api/app/tasks/1"));
    await flushServerErrors();
    assert.equal((await rows())[0]!.occurrence_count, 2);
    delete process.env.APP_VERSION;
    recordServerError(new TypeError("x"), {});
    await flushServerErrors();
    assert.equal((await rows("release = 'dev'")).length, 1);
  });

  test("ghi lỗi server không bao giờ ném: DB lỗi → chỉ log, phản hồi 500 vẫn trả", async () => {
    await db.admin.query("ALTER TABLE error_group RENAME TO error_group_tmp");
    try {
      const boom = publicRoute(async () => {
        throw new Error("x");
      });
      assert.equal((await boom(new Request("http://xc.test/a"))).status, 500);
      await flushServerErrors();
    } finally {
      await db.admin.query("ALTER TABLE error_group_tmp RENAME TO error_group");
    }
    assert.equal((await rows()).length, 0);
  });

  test("retention: nhóm có last_seen_at ĐÚNG mốc hạn còn giữ, cũ hơn mốc 1 ms bị xoá; audit chỉ đếm", async () => {
    const now = new Date("2026-11-06T10:00:00.000Z");
    const cfg = { ...retentionConfig(), errorDays: 30 };
    const cutoff = new Date(now.getTime() - 30 * 86_400_000);
    const mk = (type: string) => ({ source: "client" as const, release: "v", type, message: "m" });
    await recordError(db.app, mk("Dung"), cutoff);
    await recordError(db.app, mk("Qua"), new Date(cutoff.getTime() - 1));
    await recordError(db.app, mk("Moi"), now);
    const rep = await runRetention({ config: cfg, now, pool: db.app });
    assert.equal(rep.errorGroupDeleted, 1);
    assert.deepEqual(
      (await rows()).map((x) => x.error_type),
      ["Dung", "Moi"],
    );
    const { rows: audit } = await db.admin.query<{ after: unknown }>(
      "SELECT after FROM audit_event WHERE action = 'retention.purge' AND object_type = 'error_group'",
    );
    assert.ok(audit.length >= 1);
    assert.ok(!JSON.stringify(audit).includes("Qua"), "audit không chép nội dung lỗi");
    const again = await runRetention({ config: cfg, now, pool: db.app });
    assert.equal(again.errorGroupDeleted, 0, "chạy lại = 0");
  });

  describe("GET /api/app/errors — quyền errors.read", () => {
    let companyId: string;
    let admin: { cookie: string };
    let staff: { cookie: string };
    let staffUserId: string;
    before(async () => {
      companyId = (await seedCompany("Công ty lỗi")).companyId;
      const a = await seedUser(companyId, { grants: [{ role: "sysadmin", scopeType: "company" }] });
      const e = await seedUser(companyId, {
        grants: [
          { role: "employee", scopeType: "self" },
          { role: "hr", scopeType: "company" },
        ],
      });
      staffUserId = e.userId;
      const la = await loginThrough(a.email);
      assert.equal(la.status, 200);
      admin = { cookie: cookieFrom(la) };
      const le = await loginThrough(e.email);
      assert.equal(le.status, 200);
      staff = { cookie: cookieFrom(le) };
    });

    test("api5-bfla GET /api/app/errors — người không có errors.read (nhân viên/HR) → 403 + audit denied, không lộ dữ liệu", async () => {
      await post(report());
      const r = await getErrorGroups(req("GET", "/api/app/errors", { cookie: staff.cookie }));
      assert.equal(r.status, 403);
      const text = await r.text();
      assert.ok(!text.includes("TypeError"));
      const { rows: denied } = await db.admin.query(
        "SELECT 1 FROM audit_event WHERE actor_user_id = $1 AND action = 'errors.read' AND result = 'denied'",
        [staffUserId],
      );
      assert.equal(denied.length, 1);
      const anon = await getErrorGroups(req("GET", "/api/app/errors"));
      assert.equal(anon.status, 401);
    });

    test("sysadmin xem được: mới gặp nhất trước, lọc source/release, phân trang; tham số sai → 400", async () => {
      await post(report());
      await recordError(db.app, { source: "server", release: "v2", type: "Error", message: "s" });
      const r = await getErrorGroups(req("GET", "/api/app/errors?limit=1", { cookie: admin.cookie }));
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("cache-control"), "no-store");
      const page = (await r.json()) as { items: Row[]; next_offset: number | null };
      assert.equal(page.items.length, 1);
      assert.equal(page.items[0]!.source, "server", "mới gặp nhất trước");
      assert.equal(page.next_offset, 1);
      const only = (await (
        await getErrorGroups(
          req("GET", "/api/app/errors?source=client&release=v1.2.3", { cookie: admin.cookie }),
        )
      ).json()) as { items: Row[] };
      assert.deepEqual(
        only.items.map((x) => [x.source, x.release]),
        [["client", "v1.2.3"]],
      );
      for (const q of ["source=web", "release=a%2Fb", "limit=0"]) {
        const bad = await getErrorGroups(req("GET", `/api/app/errors?${q}`, { cookie: admin.cookie }));
        assert.equal(bad.status, 400, q);
      }
    });
  });
});
