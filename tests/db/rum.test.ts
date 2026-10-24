// RUM web-vitals tự làm (T-056, D-042; PRF-WEB-005/008, FE-PERF-001): POST /api/public/rum (cờ, cùng nguồn, ≤ 2 KiB, giới hạn
// tần suất), chuẩn hoá nhãn trang (số giá trị bị chặn), p75 theo (trang, chỉ số), metric Prometheus, constraint DB, không PII.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { metricsHandler } from "../../lib/http/metrics-route.ts";
import { renderMetrics } from "../../lib/http/metrics.ts";
import {
  insertRumSamples,
  KNOWN_APP_SECTIONS,
  pageLabel,
  readRumP75,
  RUM_DAILY_SAMPLE_CAP,
  RUM_OUTLIER_MAX_TIME_MS,
  RUM_RATE_LIMIT,
  RumInput,
} from "../../lib/rum/index.ts";
import { postRum } from "../../lib/rum/routes.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { req, setTestEnv, TEST_ORIGIN } from "../helpers/fixtures.ts";

setTestEnv();

let ipSeq = 0;
const beacon = (over: Record<string, unknown> = {}) => ({
  page: "/app/tasks/9f1c2a52-1111-4222-8333-444455556666",
  nav: "navigate",
  metrics: [
    { name: "LCP", value: 1850.4 },
    { name: "CLS", value: 0.0432 },
    { name: "TTFB", value: 120 },
  ],
  ...over,
});
/** Mỗi test một IP riêng (sau proxy tin cậy) để giới hạn tần suất không lẫn giữa các test. */
function post(
  body: unknown,
  opts: { ip?: string; origin?: string | null; headers?: Record<string, string> } = {},
) {
  return postRum(
    req("POST", "/api/public/rum", {
      body,
      origin: opts.origin,
      headers: { "x-forwarded-for": opts.ip ?? `10.1.0.${++ipSeq}`, ...opts.headers },
    }),
  );
}
const problem = async (r: Response) => (await r.json()) as { code: string };

describe("pageLabel — nhãn trang có số giá trị bị chặn", () => {
  test("trang đã biết giữ nguyên, id/slug/query bị loại", () => {
    assert.equal(pageLabel("/"), "/");
    assert.equal(pageLabel("/app/login"), "/app/login");
    assert.equal(pageLabel("/app/login/"), "/app/login", "dấu / cuối bỏ");
    for (const s of KNOWN_APP_SECTIONS) assert.equal(pageLabel(`/app/${s}`), `/app/${s}`);
    assert.equal(pageLabel("/app/tasks/9f1c2a52-1111-4222-8333-444455556666"), "/app/tasks", "id con bị bỏ");
  });
  test("phân hệ lạ → /app/*, trang công khai bất kỳ → /[...slug]", () => {
    assert.equal(pageLabel("/app/khong-co"), "/app/*");
    assert.equal(pageLabel("/app"), "/app/*");
    assert.equal(pageLabel("/app/"), "/app/*");
    assert.equal(pageLabel("/app/Tasks"), "/app/*", "phân biệt hoa/thường như Next");
    assert.equal(pageLabel("/gioi-thieu"), "/[...slug]");
    assert.equal(pageLabel("/tuyen-dung/ky-su-dien"), "/[...slug]");
    assert.equal(pageLabel("/api/app/me"), "/[...slug]");
    assert.equal(pageLabel("/Giới-thiệu/ấ"), "/[...slug]", "Unicode không làm phình tập nhãn");
    assert.equal(pageLabel("/application"), "/[...slug]", "chỉ đoạn đầu đúng 'app' mới là khu nội bộ");
  });
  test("không hợp lệ / quá cỡ → null (từ chối)", () => {
    for (const bad of [
      "",
      "app/tasks",
      "/app/../x",
      "/a/./b",
      "//x",
      "/a//b",
      "/a?x=1",
      "/a#f",
      "/a b",
      "/a\\b",
      "/a\u0000b",
      "/a\nb",
      "/" + "a".repeat(200),
    ])
      assert.equal(pageLabel(bad), null, JSON.stringify(bad));
    for (const bad of [null, undefined, 1, {}, ["/"]]) assert.equal(pageLabel(bad), null);
    assert.equal(pageLabel("/" + "a".repeat(199)), "/[...slug]", "đúng 200 ký tự vẫn nhận");
  });
  test("10 000 đường dẫn ngẫu nhiên chỉ sinh ≤ 4 + |phân hệ| nhãn", () => {
    const labels = new Set<string | null>();
    for (let i = 0; i < 10_000; i++) {
      labels.add(pageLabel(`/p${i}/${i * 7}`));
      labels.add(pageLabel(`/app/s${i}/${i}`));
      labels.add(pageLabel(`/app/${KNOWN_APP_SECTIONS[i % KNOWN_APP_SECTIONS.length]}/${i}`));
    }
    assert.ok(
      labels.size <= 4 + KNOWN_APP_SECTIONS.length,
      `có ${labels.size} nhãn: ${[...labels].join(" ")}`,
    );
  });
});

describe("RumInput", () => {
  test("hợp lệ / biên", () => {
    assert.ok(RumInput.safeParse(beacon()).success);
    assert.ok(
      RumInput.safeParse({ page: "/", metrics: [{ name: "INP", value: 0 }] }).success,
      "0 hợp lệ, nav tuỳ chọn",
    );
    assert.ok(RumInput.safeParse({ page: "/", metrics: [{ name: "LCP", value: 120_000 }] }).success);
    assert.ok(RumInput.safeParse({ page: "/", metrics: [{ name: "CLS", value: 10 }] }).success);
    const all = ["LCP", "INP", "CLS", "FCP", "TTFB"].map((name) => ({ name, value: 1 }));
    assert.ok(RumInput.safeParse({ page: "/", metrics: all }).success, "đủ 5 chỉ số");
  });
  test("không hợp lệ", () => {
    const bad = (v: unknown) => assert.equal(RumInput.safeParse(v).success, false, JSON.stringify(v));
    bad({});
    bad({ page: "", metrics: [{ name: "LCP", value: 1 }] });
    bad({ page: "x", metrics: [{ name: "LCP", value: 1 }] });
    bad({ page: "/" + "a".repeat(200), metrics: [{ name: "LCP", value: 1 }] });
    bad({ page: "/", metrics: [] });
    bad({ page: "/", nav: "teleport", metrics: [{ name: "LCP", value: 1 }] });
    bad({ page: "/", metrics: [{ name: "FID", value: 1 }] });
    bad({ page: "/", metrics: [{ name: "LCP", value: -1 }] });
    bad({ page: "/", metrics: [{ name: "LCP", value: null }] });
    bad({ page: "/", metrics: [{ name: "LCP", value: "5" }] });
    bad({ page: "/", metrics: [{ name: "LCP", value: 120_001 }] });
    bad({ page: "/", metrics: [{ name: "CLS", value: 10.01 }] });
    bad({
      page: "/",
      metrics: [
        { name: "LCP", value: 1 },
        { name: "LCP", value: 2 },
      ],
    });
    bad({
      page: "/",
      metrics: Array.from({ length: 6 }, (_, i) => ({ name: i % 2 === 1 ? "LCP" : "INP", value: 1 })),
    });
  });
});

describe("POST /api/public/rum", () => {
  let db: TestDb;
  const rows = async () =>
    (
      await db.admin.query(
        "SELECT page, metric, value_ms, cls_milli_n, nav_type FROM rum_sample ORDER BY metric",
      )
    ).rows;

  before(async () => {
    db = await freshDb();
    process.env.TRUST_PROXY = "1";
  });
  beforeEach(async () => {
    process.env.TRUST_PROXY = "1";
    process.env.RUM_ENABLED = "true";
    await db.admin.query("DELETE FROM rum_sample");
    await db.admin.query("DELETE FROM public_rate_event");
  });
  after(async () => {
    delete process.env.TRUST_PROXY;
    delete process.env.RUM_ENABLED;
    await db.close();
  });

  test("cờ tắt (mặc định) → 404, không ghi, không tính tần suất", async () => {
    delete process.env.RUM_ENABLED;
    const r = await post(beacon());
    assert.equal(r.status, 404);
    process.env.RUM_ENABLED = "false";
    assert.equal((await post(beacon())).status, 404);
    assert.equal((await rows()).length, 0);
    assert.equal((await db.admin.query("SELECT 1 FROM public_rate_event")).rowCount, 0);
  });

  test("beacon hợp lệ → 204 không thân, lưu dòng theo nhãn trang chuẩn hoá (CLS ×1000, ms làm tròn)", async () => {
    const r = await post(beacon());
    assert.equal(r.status, 204);
    assert.equal(await r.text(), "");
    assert.deepEqual(await rows(), [
      { page: "/app/tasks", metric: "CLS", value_ms: null, cls_milli_n: 43, nav_type: "navigate" },
      { page: "/app/tasks", metric: "LCP", value_ms: 1850, cls_milli_n: null, nav_type: "navigate" },
      { page: "/app/tasks", metric: "TTFB", value_ms: 120, cls_milli_n: null, nav_type: "navigate" },
    ]);
  });

  test("không lưu id, IP, user agent hay URL gốc ở bất kỳ cột nào", async () => {
    const id = "9f1c2a52-1111-4222-8333-444455556666";
    const r = await post(beacon(), {
      ip: "203.0.113.77",
      headers: { "user-agent": "Mozilla/5.0 (X11; Linux) SecretBrowser/9" },
    });
    assert.equal(r.status, 204);
    const cols = (
      await db.admin.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'rum_sample' ORDER BY ordinal_position",
      )
    ).rows.map((c) => c.column_name);
    assert.deepEqual(cols, ["id", "received_at", "page", "metric", "value_ms", "cls_milli_n", "nav_type"]);
    const dump = JSON.stringify((await db.admin.query("SELECT * FROM rum_sample")).rows);
    for (const secret of [id, "203.0.113.77", "SecretBrowser", "10.1.0."])
      assert.ok(!dump.includes(secret), secret);
    // Bảng đếm tần suất chỉ giữ băm IP, không giữ IP.
    const rate = JSON.stringify((await db.admin.query("SELECT * FROM public_rate_event")).rows);
    assert.ok(!rate.includes("203.0.113.77"));
  });

  test("received_at được làm thô theo phút khi lưu (không lưu giây/mili giây)", async () => {
    assert.equal((await post(beacon())).status, 204);
    const { rows } = await db.admin.query(
      "SELECT count(*)::int AS n FROM rum_sample WHERE received_at <> date_trunc('minute', received_at)",
    );
    assert.equal(rows[0].n, 0);
  });

  test("nav vắng → NULL; trang công khai → /[...slug]; một câu lệnh ghi cả năm chỉ số", async () => {
    const all = ["LCP", "INP", "CLS", "FCP", "TTFB"].map((name) => ({ name, value: 1 }));
    assert.equal((await post({ page: "/gioi-thieu", metrics: all })).status, 204);
    const rs = await rows();
    assert.equal(rs.length, 5);
    assert.ok(rs.every((x) => x.page === "/[...slug]" && x.nav_type === null));
  });

  test("giá trị ngoại lai (> RUM_OUTLIER_MAX_TIME_MS) bị bỏ, vẫn 204; không vào p75 (AUD-SEC-008)", async () => {
    // 60 000 ms (đúng ngưỡng) được giữ; 60 001 ms và 120 000 ms (hợp lệ theo CHECK DB) bị bỏ.
    assert.equal(RUM_OUTLIER_MAX_TIME_MS, 60_000);
    const mk = (name: string, value: number) => beacon({ page: "/", metrics: [{ name, value }] });
    assert.equal((await post(mk("LCP", 60_000))).status, 204);
    assert.equal((await post(mk("LCP", 60_001))).status, 204);
    assert.equal((await post(mk("INP", 120_000))).status, 204);
    assert.deepEqual(
      (await rows()).map((x) => [x.metric, x.value_ms]),
      [["LCP", 60_000]],
    );
    // p75 không bị đầu độc: 5 mẫu 1000 ms + nhiều mẫu 120 000 ms bị bỏ → p75 vẫn 1000.
    await db.admin.query("DELETE FROM rum_sample");
    for (let i = 0; i < 5; i++) assert.equal((await post(mk("LCP", 1000))).status, 204);
    for (let i = 0; i < 10; i++) assert.equal((await post(mk("LCP", 120_000))).status, 204);
    const p75 = (await readRumP75(db.app))!.find((x) => x.page === "/" && x.metric === "LCP")!;
    assert.equal(p75.n, 5);
    assert.equal(p75.p75, 1000);
    // Beacon chỉ gồm giá trị ngoại lai: không còn gì để ghi, không lỗi.
    assert.equal(await insertRumSamples(db.app, "/", null, [{ name: "TTFB", value: 90_000 }]), 0);
  });

  test("trần mẫu mỗi ngày: quá trần → vẫn 204 nhưng không ghi thêm; ngày hôm trước không tính (AUD-SEC-008)", async () => {
    // received_at = now() + 1 phút: vẫn thuộc "hôm nay" của lần POST kể cả khi test chạy vắt qua 00:00 UTC (review PR #75).
    await db.admin.query(
      `INSERT INTO rum_sample (page, metric, value_ms, received_at)
       SELECT '/', 'LCP', 1000, now() + interval '1 minute' FROM generate_series(1, $1::int)`,
      [RUM_DAILY_SAMPLE_CAP],
    );
    const count = async () =>
      Number((await db.admin.query("SELECT count(*) AS n FROM rum_sample")).rows[0].n);
    assert.equal(await count(), RUM_DAILY_SAMPLE_CAP);
    const r = await post(beacon());
    assert.equal(r.status, 204, "không lộ việc bị bỏ");
    assert.equal(await r.text(), "");
    assert.equal(await count(), RUM_DAILY_SAMPLE_CAP, "không ghi thêm");
    // Sang ngày mới (UTC) lại ghi được: chuyển toàn bộ mẫu về trước hôm nay (lùi 2 ngày: chắc chắn trước mốc đầu ngày).
    await db.admin.query("UPDATE rum_sample SET received_at = received_at - interval '2 days'");
    assert.equal((await post(beacon())).status, 204);
    assert.equal(await count(), RUM_DAILY_SAMPLE_CAP + 3);
  });

  test("Origin khác nguồn → 403 (CSRF), không ghi", async () => {
    const r = await post(beacon(), { origin: "https://evil.example" });
    assert.equal(r.status, 403);
    assert.equal((await problem(r)).code, "CSRF");
    assert.equal((await rows()).length, 0);
  });

  test("thiếu Origin: chỉ nhận khi Sec-Fetch-Site = same-origin (như assertSameOrigin), còn lại 403", async () => {
    assert.equal((await post(beacon(), { origin: null })).status, 403);
    assert.equal(
      (await post(beacon(), { origin: null, headers: { "sec-fetch-site": "cross-site" } })).status,
      403,
    );
    assert.equal(
      (await post(beacon(), { origin: null, headers: { "sec-fetch-site": "same-origin" } })).status,
      204,
    );
  });

  test("JSON hỏng / sai chỉ số / trùng tên / ngoài khoảng / trang không hợp lệ → 400, không ghi", async () => {
    const badJson = await postRum(
      new Request(`${TEST_ORIGIN}/api/public/rum`, {
        method: "POST",
        headers: { origin: TEST_ORIGIN, "x-forwarded-for": `10.1.0.${++ipSeq}` },
        body: "{khong-phai-json",
      }),
    );
    assert.equal(badJson.status, 400);
    assert.equal((await problem(badJson)).code, "BAD_JSON");
    for (const body of [
      {},
      beacon({ metrics: [] }),
      beacon({ metrics: [{ name: "FID", value: 1 }] }),
      beacon({
        metrics: [
          { name: "LCP", value: 1 },
          { name: "LCP", value: 2 },
        ],
      }),
      beacon({ metrics: [{ name: "LCP", value: 120_001 }] }),
      beacon({ metrics: [{ name: "CLS", value: 11 }] }),
      beacon({ metrics: [{ name: "LCP", value: -5 }] }),
      beacon({ page: "/a/../b" }), // qua schema nhưng nhãn trang không chuẩn hoá được
      beacon({ page: "/a?x=1" }),
    ]) {
      const r = await post(body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal((await problem(r)).code, "VALIDATION", JSON.stringify(body));
    }
    assert.equal((await rows()).length, 0);
  });

  test("> 2 KiB → 413, đúng 2 KiB còn nhận được", async () => {
    const big = await post(beacon({ pad: "x".repeat(2100) }));
    assert.equal(big.status, 413);
    assert.equal((await rows()).length, 0);
    const base = JSON.stringify(beacon({ pad: "" })).length;
    const fit = await post(beacon({ pad: "x".repeat(2048 - base) }));
    assert.equal(fit.status, 204, "đúng 2048 byte còn nhận");
    const over = await post(beacon({ pad: "x".repeat(2048 - base + 1) }));
    assert.equal(over.status, 413, "2049 byte bị từ chối");
  });

  test("vượt giới hạn tần suất của nhóm 'rum' → 429 + Retry-After; IP khác không bị ảnh hưởng; nhóm khác không bị tính", async () => {
    const ip = "198.51.100.9";
    for (let i = 0; i < RUM_RATE_LIMIT.max; i++) assert.equal((await post(beacon(), { ip })).status, 204);
    const r = await post(beacon(), { ip });
    assert.equal(r.status, 429);
    const body = (await r.json()) as { code: string; message: string };
    assert.equal(body.code, "RATE_LIMITED");
    assert.equal(body.message, "Gửi quá nhiều lần, vui lòng thử lại sau", "thông điệp riêng của RUM");
    const retry = Number(r.headers.get("retry-after"));
    assert.ok(
      Number.isInteger(retry) && retry >= 1 && retry <= RUM_RATE_LIMIT.windowMs / 1000,
      `retry-after ${retry}`,
    );
    assert.equal((await rows()).length, RUM_RATE_LIMIT.max * 3, "lần bị chặn không ghi mẫu");
    assert.equal((await post(beacon())).status, 204, "IP khác vẫn nhận");
    // Bucket 'rum' riêng: ngưỡng biểu mẫu (5) không áp cho RUM — đã gửi 60 lần ở trên mới chặn.
    assert.ok(RUM_RATE_LIMIT.max > 5);
  });

  test("DB chặn dòng sai: một cột giá trị đúng loại, khoảng, độ dài trang, loại chỉ số, loại điều hướng", async () => {
    const bad = (sql: string, p: unknown[] = []) =>
      assert.rejects(() => db.admin.query(sql, p), /rum_sample|violates check/, sql);
    await bad("INSERT INTO rum_sample (page, metric) VALUES ('/', 'LCP')"); // thiếu giá trị
    await bad("INSERT INTO rum_sample (page, metric, value_ms, cls_milli_n) VALUES ('/', 'LCP', 1, 1)"); // cả hai
    await bad("INSERT INTO rum_sample (page, metric, cls_milli_n) VALUES ('/', 'LCP', 1)"); // sai cột
    await bad("INSERT INTO rum_sample (page, metric, value_ms) VALUES ('/', 'CLS', 1)"); // sai cột
    await bad("INSERT INTO rum_sample (page, metric, value_ms) VALUES ('/', 'LCP', -1)");
    await bad("INSERT INTO rum_sample (page, metric, value_ms) VALUES ('/', 'LCP', 120001)");
    await bad("INSERT INTO rum_sample (page, metric, cls_milli_n) VALUES ('/', 'CLS', 10001)");
    await bad("INSERT INTO rum_sample (page, metric, value_ms) VALUES ('/', 'FID', 1)");
    await bad("INSERT INTO rum_sample (page, metric, value_ms) VALUES ('x', 'LCP', 1)");
    await bad("INSERT INTO rum_sample (page, metric, value_ms) VALUES ($1, 'LCP', 1)", [
      "/" + "a".repeat(64),
    ]);
    await bad("INSERT INTO rum_sample (page, metric, value_ms, nav_type) VALUES ('/', 'LCP', 1, 'x')");
    await db.admin.query("INSERT INTO rum_sample (page, metric, value_ms) VALUES ($1, 'LCP', 0)", [
      "/" + "a".repeat(63),
    ]);
  });

  describe("readRumP75 + metric", () => {
    const NOW = new Date("2026-10-19T12:00:00Z");
    const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000);
    const put = async (page: string, metric: string, value: number, received: Date) =>
      db.admin.query(
        `INSERT INTO rum_sample (received_at, page, metric, ${metric === "CLS" ? "cls_milli_n" : "value_ms"})
         VALUES ($1, $2, $3, $4)`,
        [received, page, metric, value],
      );

    test("p75 khớp percentile_cont tính tay; n < 5 và > 24 giờ bị loại; CLS về điểm", async () => {
      // LCP trang '/': 1000..6000 → vị trí 0,75 × 5 = 3,75 → 4000 + 0,75 × 1000 = 4750.
      for (const v of [1000, 2000, 3000, 4000, 5000, 6000]) await put("/", "LCP", v, at(1));
      // Mẫu cũ hơn 24 giờ (và ngay sát biên) KHÔNG được tính: nếu tính, p75 sẽ lệch.
      await put("/", "LCP", 100_000, at(24.01));
      await put("/", "LCP", 100_000, at(48));
      // Mẫu ở tương lai (đồng hồ lệch) cũng không tính.
      await put("/", "LCP", 100_000, at(-2));
      // INP chỉ 4 mẫu → loại; đủ 5 mẫu → giữ (biên n = 5).
      for (const v of [100, 200, 300, 400]) await put("/", "INP", v, at(2));
      for (const v of [10, 20, 30, 40, 50]) await put("/app/me", "INP", v, at(2)); // p75 = 40
      // CLS ×1000: 50..250 → p75 = 200 → 0,2.
      for (const v of [50, 100, 150, 200, 250]) await put("/app/me", "CLS", v, at(3));
      // Nhóm n = 5 chỉ nhờ mẫu cũ → sau khi loại còn 4 → bị loại.
      for (const v of [1, 2, 3, 4]) await put("/app/today", "FCP", v, at(5));
      await put("/app/today", "FCP", 9, at(30));

      const exp = (
        await db.admin.query(
          `SELECT page, metric, percentile_cont(0.75) WITHIN GROUP (ORDER BY COALESCE(value_ms, cls_milli_n)) AS p75, count(*)::int AS n
             FROM rum_sample WHERE received_at > $1 AND received_at <= $2 GROUP BY 1, 2 HAVING count(*) >= 5 ORDER BY 1, 2`,
          [at(24), NOW],
        )
      ).rows;
      assert.equal(exp.length, 3);
      const got = await readRumP75(db.app, 2000, NOW);
      assert.deepEqual(got, [
        { page: "/", metric: "LCP", p75: 4750, n: 6 },
        { page: "/app/me", metric: "CLS", p75: 0.2, n: 5 },
        { page: "/app/me", metric: "INP", p75: 40, n: 5 },
      ]);
      assert.equal(exp[0].p75, 4750, "đối chiếu với SQL gốc");
    });

    test("bảng rỗng → mảng rỗng; không kết nối được/lỗi truy vấn → null", async () => {
      assert.deepEqual(await readRumP75(db.app, 2000, NOW), []);
      const noConn = { connect: () => Promise.reject(new Error("boom")) };
      assert.equal(await readRumP75(noConn as never, 2000), null);
      const failing = {
        connect: () =>
          Promise.resolve({
            query: (sql: string) =>
              /^SELECT\s+page/.test(sql) ? Promise.reject(new Error("x")) : Promise.resolve({}),
            release: () => undefined,
          }),
      };
      assert.equal(await readRumP75(failing as never, 2000), null);
    });

    test("quá hạn: máy chủ CSDL HUỶ truy vấn (statement_timeout cục bộ), trả null, kết nối trở lại pool", async () => {
      // Giữ khoá độc quyền trên bảng ở kết nối khác → SELECT của readRumP75 bị chặn chờ khoá.
      const blocker = await db.admin.connect();
      try {
        await blocker.query("BEGIN");
        await blocker.query("LOCK TABLE rum_sample IN ACCESS EXCLUSIVE MODE");
        const t0 = Date.now();
        assert.equal(await readRumP75(db.app, 300, NOW), null);
        assert.ok(Date.now() - t0 < 3000, "không treo chờ khoá");
        // Khoá vẫn còn giữ: nếu truy vấn chỉ bị bỏ chờ (không huỷ) thì nó còn "active/chờ khoá" trong pg_stat_activity.
        const { rows } = await db.admin.query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND state = 'active' AND query LIKE '%FROM rum_sample%' AND pid <> pg_backend_pid()",
        );
        assert.equal(rows[0].n, 0, "truy vấn đã bị huỷ ở máy chủ");
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
      }
      // statement_timeout là SET LOCAL: không rò sang kết nối dùng lại.
      const c = await db.app.connect();
      try {
        const r = await c.query("SHOW statement_timeout");
        assert.notEqual(r.rows[0].statement_timeout, "300ms");
      } finally {
        c.release();
      }
      assert.deepEqual(await readRumP75(db.app, 2000, NOW), [], "đọc lại bình thường sau khi hết khoá");
    });

    test("renderMetrics: giây cho chỉ số thời gian, điểm cho CLS, HELP/TYPE, thoát nhãn; vắng khi RUM tắt", () => {
      const rows = [
        { page: "/", metric: "LCP", p75: 2500, n: 7 },
        { page: "/app/me", metric: "CLS", p75: 0.1, n: 5 },
        { page: 'a"b\\c\nd', metric: "INP", p75: 200, n: 9 },
      ];
      const out = renderMetrics(null, { rum: rows });
      assert.match(out, /^# HELP rum_web_vitals_p75 /m);
      assert.match(out, /^# TYPE rum_web_vitals_p75 gauge$/m);
      assert.match(out, /^# HELP rum_web_vitals_samples /m);
      assert.match(out, /^# TYPE rum_web_vitals_samples gauge$/m);
      assert.match(out, /^rum_web_vitals_p75\{page="\/",metric="LCP"\} 2\.5$/m);
      assert.match(out, /^rum_web_vitals_p75\{page="\/app\/me",metric="CLS"\} 0\.1$/m);
      assert.match(out, /^rum_web_vitals_p75\{page="a\\"b\\\\c\\nd",metric="INP"\} 0\.2$/m);
      assert.match(out, /^rum_web_vitals_samples\{page="\/",metric="LCP"\} 7$/m);
      // RUM tắt (không truyền options) hoặc đọc lỗi (null): không có mẫu; tắt hẳn thì không có cả HELP.
      assert.doesNotMatch(renderMetrics(null), /rum_web_vitals/);
      assert.doesNotMatch(renderMetrics(3, {}), /rum_web_vitals/);
      const errored = renderMetrics(null, { rum: null });
      assert.match(errored, /# TYPE rum_web_vitals_p75 gauge/);
      assert.doesNotMatch(errored, /^rum_web_vitals_p75\{/m);
      assert.match(renderMetrics(5, { rum: [] }), /^outbox_dead_total 5$/m, "gauge cũ giữ nguyên");
    });

    test("/api/metrics chỉ đọc RUM khi RUM_ENABLED", async () => {
      process.env.METRICS_TOKEN = "metrics-token-0123456789";
      try {
        for (const v of [1000, 2000, 3000, 4000, 5000]) await put("/", "LCP", v, new Date());
        const call = () =>
          metricsHandler(
            new Request(`${TEST_ORIGIN}/api/metrics`, {
              headers: { authorization: "Bearer metrics-token-0123456789" },
            }),
          );
        process.env.RUM_ENABLED = "false";
        assert.doesNotMatch(await (await call()).text(), /rum_web_vitals/);
        process.env.RUM_ENABLED = "true";
        const body = await (await call()).text();
        assert.match(body, /^rum_web_vitals_p75\{page="\/",metric="LCP"\} 4$/m);
        assert.match(body, /^rum_web_vitals_samples\{page="\/",metric="LCP"\} 5$/m);
      } finally {
        delete process.env.METRICS_TOKEN;
      }
    });

    test("insertRumSamples: một câu lệnh, trả số dòng; làm tròn ms và CLS", async () => {
      const n = await insertRumSamples(db.app, "/", null, [
        { name: "LCP", value: 1234.5 },
        { name: "CLS", value: 0.12345 },
      ]);
      assert.equal(n, 2);
      const rs = await rows();
      assert.deepEqual(
        rs.map((x) => [x.metric, x.value_ms, x.cls_milli_n]),
        [
          ["CLS", null, 123],
          ["LCP", 1235, null],
        ],
      );
    });
  });
});
