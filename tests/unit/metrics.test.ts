// OPS-OBS-003 (metric RED + kiểm cardinality) và BE-JOB-004 (gauge DLQ). DB thật cho outbox_dead_total.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { listRouteFiles, urlOf } from "../../scripts/check-routes.ts";
import { withTx } from "../../lib/db/index.ts";
import { publicRoute } from "../../lib/http/index.ts";
import {
  DURATION_BUCKETS,
  MAX_SERIES,
  ROUTE_PATTERNS,
  UNMATCHED_ROUTE,
  bearerMatches,
  observeRequest,
  readOutboxDead,
  renderMetrics,
  resetMetrics,
  routeLabel,
  seriesCount,
} from "../../lib/http/metrics.ts";
import { metricsHandler } from "../../lib/http/metrics-route.ts";
import { enqueue } from "../../lib/outbox/index.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { setTestEnv } from "../helpers/fixtures.ts";

setTestEnv();
const TOKEN = "metrics-token-0123456789abcdef";
const ROOT = new URL("../..", import.meta.url).pathname;

beforeEach(() => resetMetrics());

describe("nhãn http_route là MẪU route (cardinality)", () => {
  test("id/segment động → mẫu như Next, không lộ path đầy đủ", () => {
    assert.equal(routeLabel(`/api/app/tasks/${randomUUID()}/approve`), "/api/app/tasks/[id]/[action]");
    assert.equal(routeLabel("/api/app/tasks"), "/api/app/tasks");
    assert.equal(routeLabel("/api/app/tasks/"), "/api/app/tasks", "dấu / cuối vẫn khớp");
    assert.equal(routeLabel("/api/app/files/abc"), "/api/app/files/[id]");
    assert.equal(
      routeLabel("/api/app/approvals/leave/42/approve"),
      "/api/app/approvals/[type]/[id]/[decision]",
    );
  });

  test("đường dẫn lạ/quá sâu/Unicode/rỗng → unmatched (chuỗi cố định)", () => {
    for (const p of [
      "",
      "/",
      "/api/app/tasks/a/b/c",
      "/api/app/tasks/%E2%9C%93/é/extra",
      "/api/unknown/ß",
      "/api/app/me/extra",
    ])
      assert.equal(routeLabel(p), UNMATCHED_ROUTE, p);
    assert.equal(
      routeLabel("/api/app/tasks/é/ß"),
      "/api/app/tasks/[id]/[action]",
      "Unicode ở segment động hợp lệ",
    );
  });

  test("ROUTE_PATTERNS khớp đúng cây app/api (thêm route mà quên mẫu = đỏ)", () => {
    const real = listRouteFiles(ROOT)
      .filter((f) => f.startsWith("app/api/") && f.endsWith("route.ts"))
      .map(urlOf)
      .sort();
    assert.deepEqual([...ROUTE_PATTERNS].sort(), real);
  });

  test("hàng nghìn path ngẫu nhiên chỉ sinh ≤ #route + 1 giá trị http_route", () => {
    for (let i = 0; i < 5000; i++) {
      observeRequest("GET", `/api/app/tasks/${randomUUID()}/${i}`, 200, 0.01);
      observeRequest("GET", `/api/random/${randomUUID()}`, 404, 0.01);
      observeRequest("POST", `/${randomUUID()}/x`, 404, 0.01);
    }
    const routes = new Set([...renderMetrics(null).matchAll(/http_route="([^"]*)"/g)].map((m) => m[1]));
    assert.ok(routes.size <= ROUTE_PATTERNS.length + 1, `có ${routes.size} giá trị route`);
    assert.deepEqual([...routes].sort(), [UNMATCHED_ROUTE, "/api/app/tasks/[id]/[action]"].sort());
    assert.ok(seriesCount() <= 4, `số chuỗi ${seriesCount()}`);
    assert.doesNotMatch(renderMetrics(null), /[0-9a-f]{8}-[0-9a-f]{4}-/, "không có UUID trong nhãn");
  });

  test("trần MAX_SERIES: chuỗi mới bị bỏ và đếm, chuỗi cũ vẫn ghi được", () => {
    let n = 0;
    outer: for (const route of ROUTE_PATTERNS)
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"])
        for (let status = 100; status < 600; status++) {
          observeRequest(method, route.replace(/\[[^\]]+\]/g, "x"), status, 0.001);
          if (++n > MAX_SERIES + 500) break outer;
        }
    assert.equal(seriesCount(), MAX_SERIES);
    const out = renderMetrics(null);
    const droppedLine = /^http_server_series_dropped_total (\d+)$/m.exec(out);
    assert.ok(droppedLine && Number(droppedLine[1]) > 0);
    const before = renderMetrics(null);
    observeRequest("GET", ROUTE_PATTERNS[0]!, 100, 0.001); // chuỗi cũ (đầu vòng lặp)
    assert.notEqual(renderMetrics(null), before);
    assert.equal(seriesCount(), MAX_SERIES);
  });

  test("method lạ → _OTHER; status ngoài 100–599/NaN → 0", () => {
    observeRequest("BREW", "/api/app/me", 200, 0.1);
    observeRequest("get", "/api/app/me", 99, 0.1);
    observeRequest("GET", "/api/app/me", Number.NaN, 0.1);
    observeRequest("GET", "/api/app/me", 600, 0.1);
    const out = renderMetrics(null);
    assert.match(out, /http_request_method="_OTHER"/);
    assert.match(out, /http_request_method="GET",http_route="\/api\/app\/me",http_response_status_code="0"/);
    assert.doesNotMatch(out, /status_code="(99|600|NaN)"/);
  });
});

describe("histogram http_server_request_duration_seconds (exposition Prometheus)", () => {
  const line = (out: string, re: RegExp) => {
    const m = re.exec(out);
    assert.ok(m, `không thấy ${re}`);
    return Number(m[1]);
  };

  test("bucket tích luỹ, +Inf = count, le=1 gồm biên, sum đúng", () => {
    const r = "/api/app/attendance/events";
    observeRequest("POST", r, 201, 0.004); // ≤ mọi bucket
    observeRequest("POST", r, 201, 1); // đúng biên le=1
    observeRequest("POST", r, 201, 1.0001); // lọt khỏi le=1
    observeRequest("POST", r, 201, 99); // chỉ +Inf
    const out = renderMetrics(null);
    const sel = `http_request_method="POST",http_route="${r}",http_response_status_code="201"`;
    const b = (le: string) =>
      line(
        out,
        new RegExp(`_bucket\\{${sel.replace(/[/]/g, "\\/")},le="${le.replace("+", "\\+")}"\\} (\\d+)`),
      );
    assert.equal(b("0.005"), 1);
    assert.equal(b("1"), 2);
    assert.equal(b("2.5"), 3);
    assert.equal(b("10"), 3);
    assert.equal(b("+Inf"), 4);
    assert.equal(line(out, new RegExp(`_count\\{${sel.replace(/[/]/g, "\\/")}\\} (\\d+)`)), 4);
    assert.ok(
      Math.abs(line(out, new RegExp(`_sum\\{${sel.replace(/[/]/g, "\\/")}\\} ([\\d.]+)`)) - 101.0041) < 1e-9,
    );
    let prev = -1;
    for (const le of DURATION_BUCKETS) {
      const v = b(String(le));
      assert.ok(v >= prev, "bucket không giảm");
      prev = v;
    }
    assert.match(out, /^# TYPE http_server_request_duration_seconds histogram$/m);
  });

  test("thời gian âm/NaN/Infinity được xem là 0 (không làm hỏng sum)", () => {
    observeRequest("GET", "/api/app/me", 200, -5);
    observeRequest("GET", "/api/app/me", 200, Number.NaN);
    observeRequest("GET", "/api/app/me", 200, Number.POSITIVE_INFINITY);
    const out = renderMetrics(null);
    assert.match(out, /_sum\{[^}]*\} 0$/m);
    assert.match(out, /_count\{[^}]*\} 3$/m);
  });

  test("chưa có quan sát → vẫn là exposition hợp lệ, kết thúc bằng xuống dòng", () => {
    const out = renderMetrics(null);
    assert.ok(out.endsWith("\n"));
    assert.doesNotMatch(out, /http_server_request_duration_seconds_(bucket|sum|count)\{/);
    assert.match(out, /^http_server_series_dropped_total 0$/m);
  });
});

describe("đo trong publicRoute (withActor bọc publicRoute)", () => {
  test("ghi method/mẫu route/status cho cả 2xx lẫn lỗi ném ra (500) và AppError", async () => {
    const ok = publicRoute(() => Promise.resolve(new Response("ok", { status: 200 })));
    const boom = publicRoute(() => Promise.reject(new Error("hỏng")));
    await ok(new Request(`http://x.test/api/app/tasks/${randomUUID()}/approve?x=1`, { method: "POST" }));
    await boom(new Request("http://x.test/api/public/inquiries", { method: "POST" }));
    const out = renderMetrics(null);
    assert.match(
      out,
      /_count\{http_request_method="POST",http_route="\/api\/app\/tasks\/\[id\]\/\[action\]",http_response_status_code="200"\} 1$/m,
    );
    assert.match(
      out,
      /_count\{http_request_method="POST",http_route="\/api\/public\/inquiries",http_response_status_code="500"\} 1$/m,
    );
    assert.doesNotMatch(out, /x=1/, "query string không vào nhãn");
  });
});

describe("bearer METRICS_TOKEN và /api/metrics", () => {
  afterEach(() => {
    delete process.env.METRICS_TOKEN;
  });
  const req = (auth?: string) =>
    new Request("http://x.test/api/metrics", auth ? { headers: { authorization: auth } } : {});

  test("bearerMatches: đúng/sai/thiếu/token rỗng/khác độ dài/sai kiểu", () => {
    assert.equal(bearerMatches(`Bearer ${TOKEN}`, TOKEN), true);
    assert.equal(bearerMatches(`Bearer ${TOKEN}x`, TOKEN), false);
    assert.equal(bearerMatches(`Bearer ${TOKEN.slice(1)}`, TOKEN), false);
    assert.equal(bearerMatches(TOKEN, TOKEN), false);
    assert.equal(bearerMatches(`bearer ${TOKEN}`, TOKEN), false);
    assert.equal(bearerMatches(null, TOKEN), false);
    assert.equal(bearerMatches("Bearer ", ""), false);
    assert.equal(bearerMatches("Bearer x", ""), false);
  });

  test("không đặt METRICS_TOKEN → 404 kể cả khi gửi bearer; token quá ngắn → 404 (fail-closed)", async () => {
    assert.equal((await metricsHandler(req(`Bearer ${TOKEN}`))).status, 404);
    process.env.METRICS_TOKEN = "ngan";
    assert.equal((await metricsHandler(req("Bearer ngan"))).status, 404);
    process.env.METRICS_TOKEN = "   ";
    assert.equal((await metricsHandler(req("Bearer    "))).status, 404);
  });

  test("có token: thiếu/sai → 401; đúng → 200 text exposition, no-store", async () => {
    process.env.METRICS_TOKEN = TOKEN;
    const noAuth = await metricsHandler(req());
    assert.equal(noAuth.status, 401);
    assert.equal(noAuth.headers.get("www-authenticate"), "Bearer");
    assert.equal((await metricsHandler(req("Bearer sai-sai-sai-sai-sai-sai"))).status, 401);
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL; // thiếu cấu hình DB: vẫn trả metric HTTP, gauge vắng mặt
    try {
      const ok = await metricsHandler(req(`Bearer ${TOKEN}`));
      assert.equal(ok.status, 200);
      assert.match(ok.headers.get("content-type") ?? "", /^text\/plain; version=0\.0\.4/);
      assert.equal(ok.headers.get("cache-control"), "no-store");
      const body = await ok.text();
      assert.match(body, /# TYPE outbox_dead_total gauge/);
      assert.doesNotMatch(body, /^outbox_dead_total \d/m);
      assert.doesNotMatch(body, new RegExp(TOKEN));
    } finally {
      if (prev !== undefined) process.env.DATABASE_URL = prev;
    }
  });
});

describe("gauge outbox_dead_total (BE-JOB-004)", () => {
  test("renderMetrics: có số → một dòng mẫu; null → không có dòng mẫu (không báo 0 giả)", () => {
    assert.match(renderMetrics(3), /^outbox_dead_total 3$/m);
    assert.match(renderMetrics(0), /^outbox_dead_total 0$/m);
    assert.doesNotMatch(renderMetrics(null), /^outbox_dead_total /m);
  });

  test("readOutboxDead: lỗi truy vấn → null; truy vấn treo quá hạn → null", async () => {
    const failing = { query: () => Promise.reject(new Error("db chết")) };
    assert.equal(await readOutboxDead(failing as never), null);
    const hanging = { query: () => new Promise(() => {}) };
    const t0 = Date.now();
    assert.equal(await readOutboxDead(hanging as never, 30), null);
    assert.ok(Date.now() - t0 < 1000);
    const empty = { query: () => Promise.resolve({ rows: [] }) };
    assert.equal(await readOutboxDead(empty as never), 0);
  });

  describe("trên Postgres thật", () => {
    let db: TestDb;
    before(async () => {
      db = await freshDb();
    });
    after(async () => {
      await db.close();
    });

    test("đếm đúng số hàng status='dead', bỏ qua pending/done; qua /api/metrics", async () => {
      assert.equal(await readOutboxDead(db.app), 0);
      await withTx(async (tx) => {
        for (let i = 0; i < 3; i++) await enqueue(tx, null, "t.metrics", { i }, `metrics-${i}`);
      });
      assert.equal(await readOutboxDead(db.app), 0, "pending không tính");
      await db.admin.query(
        "UPDATE outbox_event SET status = 'dead', dead_at = now() WHERE job_key IN ('metrics-0', 'metrics-1')",
      );
      await db.admin.query("UPDATE outbox_event SET status = 'done' WHERE job_key = 'metrics-2'");
      assert.equal(await readOutboxDead(db.app), 2);
      process.env.METRICS_TOKEN = TOKEN;
      try {
        const res = await metricsHandler(
          new Request("http://x.test/api/metrics", { headers: { authorization: `Bearer ${TOKEN}` } }),
        );
        assert.match(await res.text(), /^outbox_dead_total 2$/m);
      } finally {
        delete process.env.METRICS_TOKEN;
      }
    });
  });
});
