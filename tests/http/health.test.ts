// OPS-OBS-006 (healthz/readyz) + ARC-RES-009/BE-REL-004 (tắt êm SIGTERM).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { after, before, describe, test } from "node:test";
import { NextRequest } from "next/server";
import pg from "pg";
import { GET as getHealthz } from "../../app/api/healthz/route.ts";
import { GET as getReadyz } from "../../app/api/readyz/route.ts";
import { POOL_TIMEOUTS, setPool } from "../../lib/db/index.ts";
import { dbReachable, readiness } from "../../lib/nen/health.ts";
import { setShutdownControllerForTest, ShutdownController } from "../../lib/nen/shutdown.ts";
import { config as proxyConfig, proxy } from "../../proxy.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { setTestEnv } from "../helpers/fixtures.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cổng TCP nhận kết nối nhưng không bao giờ trả lời (phụ thuộc "treo"). */
async function hangingServer() {
  const sockets = new Set<net.Socket>();
  const srv = net.createServer((s) => {
    sockets.add(s);
    s.on("error", () => {});
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  return {
    port: (srv.address() as net.AddressInfo).port,
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise((r) => srv.close(r));
    },
  };
}

async function closedPort(): Promise<number> {
  const srv = net.createServer();
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as net.AddressInfo).port;
  await new Promise((r) => srv.close(r));
  return port;
}

const poolTo = (port: number) =>
  new pg.Pool({ connectionString: `postgres://u:p@127.0.0.1:${port}/d`, max: 1, ...POOL_TIMEOUTS });
const endQuietly = (p: pg.Pool) => Promise.race([p.end().catch(() => {}), sleep(1500)]);

describe("health endpoint (OPS-OBS-006)", () => {
  let db: TestDb;
  before(async () => {
    db = await freshDb();
  });
  after(async () => {
    setShutdownControllerForTest(undefined);
    await db.close();
  });

  test("/api/healthz: 200, no-store, không chạm DB (chạy được khi chưa cấu hình DATABASE_URL)", async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    setPool(undefined);
    try {
      const res = getHealthz();
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.deepEqual(await res.json(), { status: "ok" });
    } finally {
      process.env.DATABASE_URL = saved;
      setPool(db.app);
    }
  });

  test("/api/readyz: DB sống → 200 no-store", async () => {
    const res = await getReadyz();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(await res.json(), { status: "ok" });
  });

  test("/api/readyz: DB không nghe (ECONNREFUSED) → 503, không lộ host/lỗi nội bộ", async () => {
    const pool = poolTo(await closedPort());
    try {
      const res = await readiness(() => pool, 1000);
      assert.equal(res.status, 503);
      assert.equal(res.headers.get("cache-control"), "no-store");
      const text = await res.text();
      assert.deepEqual(JSON.parse(text), { status: "db_unavailable" });
      assert.ok(!/127\.0\.0\.1|ECONNREFUSED|postgres:/.test(text));
    } finally {
      await endQuietly(pool);
    }
  });

  test("/api/readyz: DB treo (nhận kết nối, không trả lời) → 503 trong hạn timeout, không treo request", async () => {
    const hang = await hangingServer();
    const pool = poolTo(hang.port);
    try {
      const t0 = Date.now();
      const res = await readiness(() => pool, 300);
      assert.equal(res.status, 503);
      assert.ok(Date.now() - t0 < 1500, `mất ${Date.now() - t0} ms`);
      assert.equal(await dbReachable(pool, 100), false);
    } finally {
      await endQuietly(pool);
      await hang.close();
    }
  });

  test("/api/readyz: thiếu cấu hình DB (getPool ném) → 503 chứ không 500", async () => {
    const res = await readiness(() => {
      throw new Error("Thiếu DATABASE_URL");
    });
    assert.equal(res.status, 503);
  });

  test("/api/readyz: đang tắt → 503 shutting_down dù DB sống; healthz vẫn 200 (liveness)", async () => {
    const ctl = new ShutdownController({
      graceMs: 1000,
      readyDelayMs: 0,
      closePool: async () => {},
      exit: () => {},
      log: () => {},
    });
    setShutdownControllerForTest(ctl);
    try {
      await ctl.begin();
      const res = await getReadyz();
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), { status: "shutting_down" });
      assert.equal(getHealthz().status, 200);
    } finally {
      setShutdownControllerForTest(undefined);
    }
  });

  test("proxy/CSP không chặn: matcher loại /api; gọi proxy cho /api/* không chuyển hướng", () => {
    setTestEnv(); // proxy đọc APP_ORIGIN qua module env (thiếu = lỗi cấu hình, không im lặng)
    assert.match(proxyConfig.matcher[0]!.source, /\(\?!api\|/);
    for (const p of ["/api/healthz", "/api/readyz"]) {
      const r = proxy(new NextRequest(`http://xc.test${p}`));
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("location"), null);
    }
  });
});

describe("tắt êm (ShutdownController)", () => {
  function deps(over: Partial<ConstructorParameters<typeof ShutdownController>[0]> = {}) {
    const events: string[] = [];
    return {
      events,
      d: {
        graceMs: 5000,
        readyDelayMs: 0,
        closePool: async () => void events.push("pool.end"),
        exit: (c: number) => void events.push(`exit:${c}`),
        log: (m: string) => void events.push(`log:${m}`),
        ...over,
      },
    };
  }
  async function serverWith(ctl: ShutdownController, handler: http.RequestListener) {
    const server = http.createServer(handler);
    ctl.attach(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    return { server, port: (server.address() as net.AddressInfo).port };
  }

  test("SIGTERM khi có request chậm: request hoàn tất 200, kết nối mới bị từ chối, pool đóng SAU request, thoát 0", async () => {
    const { events, d } = deps();
    const ctl = new ShutdownController(d);
    const { server, port } = await serverWith(ctl, (_req, res) => {
      setTimeout(() => {
        events.push("response");
        res.writeHead(200).end("chậm-xong");
      }, 400);
    });
    const slow = get(port);
    await sleep(100);
    assert.equal(ctl.inflightCount(), 1);
    const done = ctl.shutdownAndExit("SIGTERM");
    assert.equal(ctl.isShuttingDown(), true);
    await sleep(100);
    await assert.rejects(get(port), /ECONNREFUSED/); // ngừng nhận
    const r = await slow;
    assert.deepEqual([r.status, r.body], [200, "chậm-xong"]);
    await done;
    assert.equal(ctl.inflightCount(), 0);
    assert.deepEqual(
      events.filter((e) => !e.startsWith("log:")),
      ["response", "pool.end", "exit:0"],
    );
    server.closeAllConnections();
  });

  test("không có request đang chạy → thoát ngay; gọi lần hai (SIGTERM lặp) không đóng pool hai lần", async () => {
    const { events, d } = deps();
    const ctl = new ShutdownController(d);
    await serverWith(ctl, (_q, res) => res.end("ok"));
    const t0 = Date.now();
    await Promise.all([ctl.shutdownAndExit("SIGTERM"), ctl.shutdownAndExit("SIGTERM")]);
    assert.ok(Date.now() - t0 < 500);
    assert.equal(events.filter((e) => e === "pool.end").length, 1);
    assert.ok(events.every((e) => !e.startsWith("exit:") || e === "exit:0"));
  });

  test("quá grace: cắt request treo, vẫn đóng pool và thoát 0 (không treo vô hạn); có log", async () => {
    const { events, d } = deps({ graceMs: 200 });
    const ctl = new ShutdownController(d);
    const { server, port } = await serverWith(ctl, () => {
      /* không bao giờ trả lời */
    });
    const hung = get(port).catch(() => "bị cắt");
    await sleep(50);
    const t0 = Date.now();
    await ctl.shutdownAndExit("SIGTERM");
    assert.ok(Date.now() - t0 >= 190 && Date.now() - t0 < 2000);
    assert.deepEqual(
      events.filter((e) => !e.startsWith("log:")),
      ["pool.end", "exit:0"],
    );
    assert.ok(events.some((e) => e.includes("còn 1 request")));
    server.closeAllConnections();
    assert.equal(await hung, "bị cắt");
  });

  test("closePool ném lỗi → vẫn thoát 0 và ghi log", async () => {
    const a = deps({
      closePool: async () => {
        throw new Error("end lỗi");
      },
    });
    await new ShutdownController(a.d).shutdownAndExit("SIGTERM");
    assert.ok(a.events.some((e) => e.includes("end lỗi")));
    assert.ok(a.events.includes("exit:0"));
  });

  test("readiness delay: vẫn nhận request trong lúc readiness đã 503, rồi mới đóng listener", async () => {
    const { d } = deps({ readyDelayMs: 300 });
    const ctl = new ShutdownController(d);
    const { server, port } = await serverWith(ctl, (_q, res) =>
      res.end(ctl.isShuttingDown() ? "đang-tắt" : "bình-thường"),
    );
    const done = ctl.shutdownAndExit("SIGTERM");
    await sleep(50);
    assert.equal((await get(port)).body, "đang-tắt"); // chưa đóng listener
    await done;
    await assert.rejects(get(port), /ECONNREFUSED/);
    server.closeAllConnections();
  });
});

describe("tắt êm — tiến trình thật nhận SIGTERM (BE-REL-004)", () => {
  test("request chậm hoàn tất 200, /readyz 503 trong lúc tắt, pool DB đóng, thoát mã 0 trong grace", async () => {
    const appName = `xc-shutdown-${process.pid}`;
    const child = spawn(process.execPath, ["--import", "tsx", "tests/helpers/shutdown-child.ts"], {
      env: {
        ...process.env,
        SHUTDOWN_GRACE_MS: "5000",
        SHUTDOWN_READY_DELAY_MS: "600",
        SLOW_MS: "1200",
        PGAPPNAME: appName,
      },
      stdio: ["ignore", "pipe", "inherit"],
    });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
      child.on("exit", (code, signal) => resolve({ code, signal })),
    );
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("tiến trình con không sẵn sàng")), 30_000);
      let buf = "";
      child.stdout.on("data", (c: Buffer) => {
        buf += c.toString();
        const m = /READY (\d+)/.exec(buf);
        if (m) {
          clearTimeout(timer);
          resolve(Number(m[1]));
        }
      });
      child.on("exit", () => reject(new Error("tiến trình con thoát sớm")));
    });
    const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();
    const conns = async () =>
      Number(
        (
          await admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = $1", [
            appName,
          ])
        ).rows[0].n,
      );
    try {
      assert.equal((await get(port, "/readyz")).status, 200);
      assert.ok((await conns()) >= 1, "pool của tiến trình con phải có kết nối trước khi tắt");
      const t0 = Date.now();
      const slow = get(port, "/slow");
      await sleep(200);
      child.kill("SIGTERM");
      await sleep(150);
      const ready = await get(port, "/readyz");
      assert.deepEqual([ready.status, JSON.parse(ready.body)], [503, { status: "shutting_down" }]);
      const r = await slow;
      assert.deepEqual([r.status, r.body], [200, "xong"]);
      const end = await exited;
      assert.deepEqual(end, { code: 0, signal: null });
      assert.ok(Date.now() - t0 < 5000 + 600, `thoát sau ${Date.now() - t0} ms`);
      for (let i = 0; i < 20 && (await conns()) > 0; i++) await sleep(100);
      assert.equal(await conns(), 0, "pool.end() phải đóng mọi kết nối");
    } finally {
      child.kill("SIGKILL");
      await admin.end();
    }
  });
});

function get(port: number, path = "/") {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path, agent: false }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      })
      .on("error", reject);
  });
}
