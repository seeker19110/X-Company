// T-046: luật cảnh báo cục bộ, bộ đánh giá, kênh đích và bài thử kích hoạt (OPS-SLO-004/005/006). DB thật qua with-test-db.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { runDrill, formatRows } from "../../scripts/alerts-drill.ts";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import * as alertsMod from "../../scripts/check-alerts.mjs";
import { maskedEnv, loadEnv } from "../../lib/nen/env.ts";
import { createLogger } from "../../lib/nen/log.ts";
import { observeRequest, renderMetrics, resetMetrics } from "../../lib/http/metrics.ts";
import {
  AlertEngine,
  BACKUP_NEVER_AGE_SECONDS,
  FRESH_STATE,
  alertConfig,
  backupAgeSeconds,
  offsiteAgeSeconds,
  fileSink,
  githubSlug,
  httpTotals,
  loadRules,
  makeLogSink,
  markdownAnchors,
  parseMetrics,
  parseRules,
  runAlertLoop,
  stepRule,
  type AlertNotification,
  type AlertRule,
  type AlertSink,
} from "../../lib/ops/index.ts";
import { engineFromConfig, sinksFromConfig, webhookSink } from "../../scripts/alert-channels.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { setTestEnv } from "../helpers/fixtures.ts";

setTestEnv();
const checkLocalRules = (
  alertsMod as { checkLocalRules: (t: string, r: (p: string) => string | null) => string[] }
).checkLocalRules;
const ROOT = new URL("../..", import.meta.url).pathname;
const RULES_FILE = path.join(ROOT, "docs/ops/alerts.json");
let work: string;
before(() => {
  work = mkdtempSync(path.join(tmpdir(), "xc-alerts-test-"));
});
after(() => rmSync(work, { recursive: true, force: true }));

const rule = (over: Partial<AlertRule> = {}): AlertRule => ({
  id: "XCTestRule",
  summary: "Luật thử nghiệm cho kiểm thử",
  severity: "ticket",
  owner: "tester",
  runbook: "docs/ops/RUNBOOK.md#4-cảnh-báo--playbook",
  signal: "outbox_dead",
  op: "gt",
  threshold: 0,
  forSeconds: 0,
  ...over,
});
const note = (over: Partial<AlertNotification> = {}): AlertNotification => ({
  timestamp: "2026-10-19T00:00:00.000Z",
  status: "firing",
  repeat: false,
  rule: "XCTestRule",
  severity: "ticket",
  summary: "x",
  owner: "o",
  runbook: "r.md#a",
  value: 1,
  threshold: 0,
  since: null,
  ...over,
});
const memSink = (fail = false): AlertSink & { got: AlertNotification[] } => {
  const got: AlertNotification[] = [];
  return {
    name: "mem",
    got,
    send(n) {
      if (fail) return Promise.reject(new Error("hỏng"));
      got.push(n);
      return Promise.resolve();
    },
  };
};

describe("luật cảnh báo (docs/ops/alerts.json)", () => {
  const rules = loadRules(RULES_FILE);
  test("hợp lệ; page chỉ cho burn-rate/readyz/audit; runbook trỏ mục có thật; mỗi luật có dòng thử kích hoạt", () => {
    assert.ok(rules.length >= 12);
    for (const r of rules) {
      const [file, anchor] = r.runbook.split("#");
      assert.ok(
        markdownAnchors(readFileSync(path.join(ROOT, file!), "utf8")).has(anchor!),
        `${r.id} → ${r.runbook}`,
      );
      if (r.severity === "page")
        assert.ok(["http_5xx_ratio", "readyz_down", "audit_chain_broken"].includes(r.signal), r.id);
    }
    assert.ok(
      rules.some((r) => (r.windows?.length ?? 0) >= 2 && r.severity === "page"),
      "burn rate đa cửa sổ",
    );
    const errs = checkLocalRules(readFileSync(RULES_FILE, "utf8"), (p) => {
      try {
        return readFileSync(path.join(ROOT, p), "utf8");
      } catch {
        return null;
      }
    });
    assert.deepEqual(errs, []);
  });
  test("check:alerts bắt luật hỏng", () => {
    const bad = JSON.stringify({
      version: 1,
      rules: [
        { id: "A", severity: "sms", signal: "x", threshold: "1", forSeconds: -1, runbook: "docs/none.md#a" },
        {
          id: "A",
          severity: "page",
          owner: "o",
          summary: "s",
          signal: "outbox_dead",
          threshold: 0,
          forSeconds: 0,
          runbook: "docs/ops/RUNBOOK.md#khong-co",
        },
        {
          id: "B",
          severity: "page",
          owner: "o",
          summary: "s",
          signal: "outbox_dead",
          threshold: 0,
          forSeconds: 0,
          runbook: "sai",
        },
      ],
    });
    const e = checkLocalRules(bad, () => null).join("|");
    for (const m of [
      "trùng id",
      "severity",
      "thiếu owner",
      "signal lạ",
      "threshold",
      "forSeconds",
      "không tồn tại",
      "dạng tệp.md#neo",
      "alert-drills",
    ])
      assert.match(e, new RegExp(m));
    assert.match(checkLocalRules("{", () => null)[0]!, /JSON/);
    assert.match(checkLocalRules("{}", () => null).join(), /version 1/);
    assert.match(
      checkLocalRules(bad, (p) => (p.endsWith("RUNBOOK.md") ? "# Khác" : null)).join(),
      /không có mục/,
    );
  });
  test("parseRules từ chối: JSON hỏng, trường lạ, trùng id, tỷ lệ thiếu windows, windows cho tín hiệu không phải tỷ lệ", () => {
    const wrap = (...r: object[]) => JSON.stringify({ version: 1, rules: r });
    assert.throws(() => parseRules("{"), /JSON/);
    assert.throws(() => parseRules(wrap()), /không hợp lệ/);
    assert.throws(() => parseRules(wrap({ ...rule(), lạ: 1 })), /không hợp lệ/);
    assert.throws(() => parseRules(wrap(rule(), rule())), /trùng id/);
    assert.throws(() => parseRules(wrap(rule({ signal: "http_5xx_ratio" }))), /cần windows/);
    assert.throws(() => parseRules(wrap(rule({ windows: [300] }))), /chỉ dùng cho tín hiệu tỷ lệ/);
    assert.throws(() => parseRules(wrap(rule({ runbook: "không-phải-md" }))), /runbook/);
    assert.equal(parseRules(wrap(rule())).length, 1);
  });
  test("githubSlug / markdownAnchors: Unicode, dấu câu, khối mã bị bỏ qua", () => {
    assert.equal(githubSlug("4. Cảnh báo → playbook"), "4-cảnh-báo--playbook");
    assert.equal(githubSlug("DLQ / redrive"), "dlq--redrive");
    const a = markdownAnchors("# Một\n```\n# Trong mã\n```\n## Hai ##\n");
    assert.deepEqual([...a], ["một", "hai"]);
  });
});

describe("metric Prometheus", () => {
  test("parseMetrics: nhãn thoát ký tự, +Inf, NaN, dấu thời gian, dòng rác", () => {
    const s = parseMetrics(
      [
        "# HELP x y",
        'm{a="1",b="q\\"u\\\\o\\nte"} 3',
        'h_bucket{le="+Inf"} +Inf 1700000000',
        "bad line here",
        "n NaN",
        "",
        "plain 7",
      ].join("\n"),
    );
    assert.equal(s.length, 3);
    assert.equal(s[0]!.labels.b, 'q"u\\o\nte');
    assert.equal(s[1]!.value, Infinity);
    assert.deepEqual(s[2], { name: "plain", labels: {}, value: 7 });
  });
  test("httpTotals đọc đúng đầu ra thật của renderMetrics", () => {
    resetMetrics();
    observeRequest("GET", "/api/app/tasks", 200, 0.01);
    observeRequest("GET", "/api/app/tasks", 503, 0.01);
    observeRequest("POST", "/api/app/attendance/events", 201, 0.2);
    observeRequest("POST", "/api/app/attendance/events", 201, 3);
    const t = httpTotals(parseMetrics(renderMetrics(0)));
    assert.deepEqual(t, { total: 4, errors: 1, attTotal: 2, attGood: 1 });
    resetMetrics();
    assert.deepEqual(httpTotals(parseMetrics(renderMetrics(null))), {
      total: 0,
      errors: 0,
      attTotal: 0,
      attGood: 0,
    });
  });
});

describe("máy trạng thái stepRule", () => {
  const r = { op: "gt", threshold: 0, forSeconds: 60 } as const;
  test("pending → firing sau for; resolved; null giữ nguyên; ranh giới gt/gte", () => {
    assert.equal(stepRule(r, null, 0, FRESH_STATE, 1000).transition, null);
    const p = stepRule(r, 1, 0, FRESH_STATE, 1000);
    assert.equal(p.state.phase, "pending");
    assert.equal(stepRule(r, 1, 59_000, p.state, 1000).transition, null);
    const f = stepRule(r, 1, 60_000, p.state, 1000);
    assert.equal(f.transition, "firing");
    assert.equal(stepRule(r, null, 70_000, f.state, 1000).state, f.state, "thiếu dữ liệu không resolve");
    assert.equal(stepRule(r, 0, 70_000, f.state, 1000).transition, "resolved");
    assert.equal(
      stepRule(r, 0, 70_000, p.state, 1000).state.phase,
      "ok",
      "pending hết điều kiện → ok, không báo",
    );
    assert.equal(stepRule({ op: "gt", threshold: 5, forSeconds: 0 }, 5, 0, FRESH_STATE, 1).transition, null);
    assert.equal(
      stepRule({ op: "gte", threshold: 5, forSeconds: 0 }, 5, 0, FRESH_STATE, 1).transition,
      "firing",
    );
  });
  test("chống lặp: nhắc lại chỉ sau cửa sổ; repeatMs=0 không bao giờ nhắc", () => {
    const f = stepRule({ ...r, forSeconds: 0 }, 1, 0, FRESH_STATE, 1000);
    assert.equal(stepRule(r, 1, 999, f.state, 1000).transition, null);
    const rep = stepRule(r, 1, 1000, f.state, 1000);
    assert.equal(rep.transition, "repeat");
    assert.equal(stepRule(r, 1, 1500, rep.state, 1000).transition, null);
    assert.equal(stepRule(r, 1, 9e9, f.state, 0).transition, null);
  });
});

describe("kênh đích", () => {
  test("fileSink: tạo thư mục, JSON-lines, quyền 0600, nối thêm", async () => {
    const f = path.join(work, "sub", "a.jsonl");
    const s = fileSink(f);
    await s.send(note());
    await s.send(note({ status: "resolved" }));
    const lines = readFileSync(f, "utf8").trim().split("\n");
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[1]!).status, "resolved");
    assert.equal(statSync(f).mode & 0o777, 0o600);
  });
  test("logSink: firing = error, resolved = info, không lộ gì ngoài mã luật/số đo", async () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (l) => lines.push(l), level: () => "debug", service: "t" });
    const s = makeLogSink(logger);
    await s.send(note());
    await s.send(note({ status: "resolved" }));
    const [a, b] = lines.map(
      (l) => JSON.parse(l) as { event: string; level: string; target: { id: string } },
    );
    assert.equal(a!.event, "ops.alert");
    assert.equal(a!.level, "error");
    assert.equal(b!.level, "info");
    assert.equal(a!.target.id, "XCTestRule");
  });
  test("webhookSink: 200 ok; 500/timeout/từ chối kết nối/redirect → lỗi không chứa URL (bí mật)", async () => {
    let mode = "ok";
    const bodies: string[] = [];
    const sockets = new Set<import("node:net").Socket>();
    const srv = http.createServer((req, res) => {
      const c: Buffer[] = [];
      req.on("data", (d: Buffer) => c.push(d));
      req.on("end", () => {
        bodies.push(Buffer.concat(c).toString());
        if (mode === "ok") res.writeHead(200).end("ok");
        else if (mode === "500") res.writeHead(500).end("no");
        else if (mode === "redirect") res.writeHead(302, { location: "http://127.0.0.1:9/" }).end();
        // mode "hang": không trả lời
      });
    });
    srv.on("connection", (s) => sockets.add(s));
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const port = (srv.address() as AddressInfo).port;
    const url = `http://127.0.0.1:${port}/token-bi-mat-123`;
    try {
      await webhookSink(url, 1000).send(note());
      assert.equal(JSON.parse(bodies[0]!).rule, "XCTestRule");
      mode = "500";
      await assert.rejects(
        webhookSink(url, 1000).send(note()),
        (e: Error) => /HTTP 500/.test(e.message) && !e.message.includes("token-bi-mat"),
      );
      mode = "redirect";
      await assert.rejects(webhookSink(url, 1000).send(note()), /lỗi kết nối/);
      mode = "hang";
      const t0 = Date.now();
      await assert.rejects(
        webhookSink(url, 300).send(note()),
        (e: Error) => e.message === "webhook hết thời gian chờ",
      );
      assert.ok(Date.now() - t0 < 3000, "timeout được tôn trọng");
    } finally {
      for (const s of sockets) s.destroy();
      await new Promise((r) => srv.close(r));
    }
    await assert.rejects(
      webhookSink(url, 500).send(note()),
      (e: Error) => e.message === "webhook lỗi kết nối" || /kết nối/.test(e.message),
    );
  });
});

describe("tuổi bản sao lưu", () => {
  test("thiếu thư mục / rỗng / manifest hỏng / thiếu tệp dữ liệu → NEVER; bản hoàn chỉnh mới nhất thắng", () => {
    const now = Date.parse("2026-10-19T12:00:00Z");
    assert.equal(backupAgeSeconds(path.join(work, "khong-co"), now), BACKUP_NEVER_AGE_SECONDS);
    const d = path.join(work, "bk");
    mkdirSync(d);
    assert.equal(backupAgeSeconds(d, now), BACKUP_NEVER_AGE_SECONDS);
    writeFileSync(path.join(d, "xc-1.manifest.json"), "{hỏng");
    writeFileSync(
      path.join(d, "xc-2.manifest.json"),
      JSON.stringify({ file: "xc-2.dump", created_at_utc: "2026-10-19T11:00:00Z" }),
    );
    assert.equal(backupAgeSeconds(d, now), BACKUP_NEVER_AGE_SECONDS, "thiếu tệp dữ liệu");
    writeFileSync(path.join(d, "xc-2.dump"), "x");
    assert.equal(backupAgeSeconds(d, now), 3600);
    writeFileSync(
      path.join(d, "xc-3.manifest.json"),
      JSON.stringify({ file: "xc-3.dump", created_at_utc: "không-phải-ngày" }),
    );
    assert.equal(backupAgeSeconds(d, now), 3600, "manifest mới nhất hỏng → dùng bản trước");
    writeFileSync(
      path.join(d, "xc-2.manifest.json"),
      JSON.stringify({ file: "xc-2.dump", created_at_utc: "2026-10-19T13:00:00Z" }),
    );
    assert.equal(backupAgeSeconds(d, now), 0, "đồng hồ lệch tương lai → 0, không âm");
  });
});

describe("AlertEngine (không DB)", () => {
  const metricsOf = (ok: number, err: number) => () => {
    resetMetrics();
    for (let i = 0; i < ok; i++) observeRequest("GET", "/api/app/tasks", 200, 0.01);
    for (let i = 0; i < err; i++) observeRequest("GET", "/api/app/tasks", 500, 0.01);
    return Promise.resolve(renderMetrics(0));
  };
  const ratioRule = rule({
    id: "XCRatio",
    signal: "http_5xx_ratio",
    threshold: 0.1,
    windows: [600, 300],
    minEvents: 10,
  });

  test("tỷ lệ 5xx: lượt đầu không có dữ liệu; minEvents; reset bộ đếm; cửa sổ ngắn hết thì resolved", async () => {
    let t = Date.parse("2026-10-19T00:00:00Z");
    let ok = 100;
    let err = 0;
    const sink = memSink();
    const e = new AlertEngine([ratioRule], {
      sinks: [sink],
      now: () => new Date(t),
      metricsText: () => metricsOf(ok, err)(),
    });
    assert.equal((await e.evaluate())[0]!.value, null, "chưa có mốc so sánh");
    t += 300_000;
    ok += 5;
    assert.equal((await e.evaluate())[0]!.value, 0, "dưới minEvents coi như 0");
    t += 300_000;
    err += 50;
    const r = (await e.evaluate())[0]!;
    assert.ok(r.value! > 0.1 && r.notified === "firing");
    t += 300_000;
    ok = 3;
    err = 0; // tiến trình khởi động lại → bộ đếm về nhỏ hơn
    assert.equal((await e.evaluate())[0]!.value, 0);
    assert.equal(sink.got.map((n) => n.status).join(), "firing,resolved");
  });

  test("scrape lỗi → scrape_failed=1, luật tỷ lệ không có dữ liệu; thiếu collector → không có tín hiệu", async () => {
    const sink = memSink();
    const e = new AlertEngine(
      [
        rule({ id: "XCScrape", signal: "scrape_failed", op: "gte", threshold: 1 }),
        ratioRule,
        rule({ id: "XCReady", signal: "readyz_down", op: "gte", threshold: 1 }),
      ],
      {
        sinks: [sink],
        metricsText: () => Promise.reject(new Error("x")),
        readyz: () => Promise.reject(new Error("down")),
      },
    );
    const out = await e.evaluate();
    assert.deepEqual(
      out.map((o) => o.value),
      [1, null, 1],
    );
    const bare = new AlertEngine(
      [
        rule({ id: "XCScrape", signal: "scrape_failed", op: "gte", threshold: 1 }),
        ratioRule,
        rule({ id: "XCReady", signal: "readyz_down" }),
        rule({ id: "XCDead" }),
        rule({ id: "XCBk", signal: "backup_age_seconds" }),
        rule({ id: "XCAud", signal: "audit_chain_broken" }),
      ],
      { sinks: [sink] },
    );
    assert.ok((await bare.evaluate()).every((o) => o.value === null && o.notified === null));
  });

  test("kênh hỏng: không nuốt cảnh báo (thử lại lượt sau); hỏng một phần vẫn tính đã gửi; repeat sau cửa sổ", async () => {
    let t = 0;
    const bad = memSink(true);
    const good = memSink();
    const flaky: AlertSink = {
      name: "flaky",
      send: (n) => (t < 2 ? Promise.reject(new Error("lỗi")) : good.send(n)),
    };
    const e = new AlertEngine([rule({ signal: "readyz_down", op: "gte", threshold: 1 })], {
      sinks: [flaky],
      now: () => new Date(t * 1000),
      repeatMs: 5000,
      readyz: () => Promise.resolve(false),
    });
    assert.equal((await e.evaluate())[0]!.phase, "ok", "gửi hỏng → chưa coi là đã bắn");
    t = 1;
    assert.equal((await e.evaluate())[0]!.notified, null);
    t = 2;
    assert.equal((await e.evaluate())[0]!.notified, "firing");
    t = 3;
    assert.equal((await e.evaluate())[0]!.notified, null, "trong cửa sổ không lặp");
    t = 8;
    assert.equal((await e.evaluate())[0]!.notified, "repeat");
    assert.equal(good.got.at(-1)!.repeat, true);
    const mixed = new AlertEngine([rule({ signal: "readyz_down", op: "gte", threshold: 1 })], {
      sinks: [bad, good],
      readyz: () => Promise.resolve(false),
    });
    assert.equal((await mixed.evaluate())[0]!.delivered, 1);
  });

  test("runAlertLoop: lặp theo chu kỳ, một lượt lỗi không dừng, dừng khi abort", async () => {
    let n = 0;
    const fake = {
      evaluate: () => {
        n++;
        return n === 1 ? Promise.reject(new Error("lỗi")) : Promise.resolve([]);
      },
    } as unknown as AlertEngine;
    const ctl = new AbortController();
    const p = runAlertLoop(ctl.signal, fake, 10);
    await new Promise((r) => setTimeout(r, 120));
    ctl.abort();
    await p;
    assert.ok(n >= 3);
    const pre = new AbortController();
    pre.abort();
    await runAlertLoop(pre.signal, fake, 10);
  });
});

describe("cấu hình (env)", () => {
  const base = {
    APP_ORIGIN: "http://x.test",
    DATABASE_URL: "postgres://u:p@localhost/db",
    SESSION_SECRET: "x".repeat(40),
    QR_SIGNING_KEYS: `k1:${"y".repeat(40)}`,
  };
  test("mặc định tắt; ghi đè; sai bị từ chối; URL webhook bị che", () => {
    const c = alertConfig(base);
    assert.equal(c.enabled, false);
    assert.equal(c.intervalMs, 60_000);
    assert.equal(c.sinkFile, ".data/alerts/alerts.jsonl");
    assert.equal(c.rulesFile, "docs/ops/alerts.json");
    assert.equal(c.backupDir, ".data/backups");
    assert.equal(c.webhookUrl, undefined);
    assert.equal(
      sinksFromConfig(c)
        .map((s) => s.name)
        .join(),
      "file,log",
    );
    const o = alertConfig({
      ...base,
      ALERTS_ENABLED: "true",
      ALERT_WEBHOOK_URL: "https://hooks.test/abc-secret",
      ALERT_INTERVAL_MS: "5000",
    });
    assert.equal(o.enabled, true);
    assert.equal(
      sinksFromConfig(o)
        .map((s) => s.name)
        .join(),
      "file,log,webhook",
    );
    assert.throws(() => alertConfig({ ...base, ALERT_INTERVAL_MS: "5" }), /ALERT_INTERVAL_MS/);
    assert.throws(() => alertConfig({ ...base, ALERT_WEBHOOK_URL: "ftp://x" }), /ALERT_WEBHOOK_URL/);
    assert.throws(() => alertConfig({ ...base, ALERTS_ENABLED: "yes" }), /ALERTS_ENABLED/);
    const dump = JSON.stringify(
      maskedEnv(loadEnv({ ...base, ALERT_WEBHOOK_URL: "https://hooks.test/abc-secret" })),
    );
    assert.equal(dump.includes("abc-secret"), false);
  });
});

describe("với DB thật", () => {
  let db: TestDb;
  before(async () => {
    db = await freshDb();
  });
  after(async () => {
    await db.close();
  });

  test("tín hiệu DB: lỗi truy vấn → không có dữ liệu (không báo 0 giả); audit cache + verify lỗi", async () => {
    const broken = { query: () => Promise.reject(new Error("DB chết")) } as unknown as import("pg").Pool;
    const sink = memSink();
    const e = new AlertEngine(
      [
        rule({ id: "XCD1" }),
        rule({ id: "XCD2", signal: "outbox_stale" }),
        rule({ id: "XCAud", signal: "audit_chain_broken", op: "gte", threshold: 1 }),
      ],
      { sinks: [sink], pool: broken, verifyChain: () => Promise.reject(new Error("x")) },
    );
    assert.ok((await e.evaluate()).every((o) => o.value === null));
    let calls = 0;
    const e2 = new AlertEngine(
      [rule({ id: "XCAud", signal: "audit_chain_broken", op: "gte", threshold: 1 })],
      {
        sinks: [sink],
        pool: db.admin,
        verifyChain: () => {
          calls++;
          return Promise.resolve(true);
        },
      },
    );
    await e2.evaluate();
    await e2.evaluate();
    assert.equal(calls, 1, "kiểm chuỗi audit tối đa mỗi min_interval_seconds");
    const e3 = new AlertEngine(
      [rule({ id: "XCAud", signal: "audit_chain_broken", op: "gte", threshold: 1 })],
      { sinks: [sink], pool: db.admin },
    );
    assert.equal((await e3.evaluate())[0]!.value, 0, "mặc định dùng verifyAuditChain thật");
  });

  test("engineFromConfig: scrape /api/metrics + readyz qua HTTP, bearer; 401 → scrape_failed", async () => {
    let status = 200;
    let auth = "";
    const srv = http.createServer((req, res) => {
      if (req.url === "/metrics") auth = req.headers.authorization ?? "";
      if (req.url === "/readyz") return void res.writeHead(status === 200 ? 200 : 503).end("{}");
      if (status !== 200) return void res.writeHead(status).end("no");
      resetMetrics();
      observeRequest("GET", "/api/app/tasks", 200, 0.01);
      res.writeHead(200).end(renderMetrics(0));
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const sinkFile = path.join(work, "eng.jsonl");
    const env = {
      APP_ORIGIN: "http://x.test",
      DATABASE_URL: "postgres://u:p@localhost/db",
      SESSION_SECRET: "x".repeat(40),
      QR_SIGNING_KEYS: `k1:${"y".repeat(40)}`,
      ALERT_RULES_FILE: RULES_FILE,
      ALERT_SINK_FILE: sinkFile,
      ALERT_METRICS_URL: `${base}/metrics`,
      ALERT_READYZ_URL: `${base}/readyz`,
      METRICS_TOKEN: "token-metrics-0123456789",
      BACKUP_DIR: path.join(work, "khong-co-backup"),
    };
    try {
      const e = engineFromConfig(alertConfig(env), db.admin);
      const ok = await e.evaluate();
      assert.equal(auth, "Bearer token-metrics-0123456789");
      const by = (id: string) => ok.find((o) => o.rule === id)!;
      assert.equal(by("XCLocalReadyzDown").value, 0);
      assert.equal(by("XCLocalMetricsScrapeFailed").value, 0);
      assert.equal(by("XCLocalBackupStale").notified, "firing", "chưa từng sao lưu → bắn");
      assert.match(readFileSync(sinkFile, "utf8"), /XCLocalBackupStale/);
      status = 401;
      const bad = await e.evaluate();
      assert.equal(bad.find((o) => o.rule === "XCLocalMetricsScrapeFailed")!.value, 1);
      assert.equal(bad.find((o) => o.rule === "XCLocalReadyzDown")!.value, 1);
    } finally {
      srv.closeAllConnections();
      await new Promise((r) => srv.close(r));
    }
    // không đặt URL: readyz dùng probe nội tiến trình (DB thật) → sẵn sàng
    const local = engineFromConfig(
      alertConfig({ ...env, ALERT_READYZ_URL: "", ALERT_METRICS_URL: "" }),
      db.admin,
    );
    assert.equal((await local.evaluate()).find((o) => o.rule === "XCLocalReadyzDown")!.value, 0);
  });

  test("bài thử kích hoạt (alerts:drill): mọi luật bắn đúng 3 kênh, không lặp, resolved", async () => {
    const rows = await runDrill(process.env.DATABASE_URL!);
    assert.equal(rows.length, loadRules(RULES_FILE).length);
    for (const r of rows) assert.ok(r.ok, `${r.rule}: ${JSON.stringify(r)}`);
    assert.match(formatRows(rows), /ĐẠT/);
    assert.equal(formatRows(rows).includes("ĐỎ"), false);
  });
});

describe("tuổi bản off-site restic (T-053)", () => {
  const now = Date.parse("2026-10-19T12:00:00Z");
  test("đọc last_success_utc của offsite-status.json / offsite-drill.json; thiếu, hỏng, tương lai → an toàn", () => {
    const d = mkdtempSync(path.join(tmpdir(), "xc-offsite-age-"));
    try {
      assert.equal(offsiteAgeSeconds(path.join(d, "khong-co"), now), BACKUP_NEVER_AGE_SECONDS);
      assert.equal(offsiteAgeSeconds(d, now), BACKUP_NEVER_AGE_SECONDS, "chưa từng đẩy");
      writeFileSync(path.join(d, "offsite-status.json"), "{hỏng");
      assert.equal(offsiteAgeSeconds(d, now), BACKUP_NEVER_AGE_SECONDS, "JSON hỏng");
      writeFileSync(
        path.join(d, "offsite-status.json"),
        JSON.stringify({ last_success_utc: "2026-10-19T11:00:00Z" }),
      );
      assert.equal(offsiteAgeSeconds(d, now), 3600);
      writeFileSync(
        path.join(d, "offsite-status.json"),
        JSON.stringify({ last_success_utc: "không phải ngày" }),
      );
      assert.equal(offsiteAgeSeconds(d, now), BACKUP_NEVER_AGE_SECONDS);
      writeFileSync(
        path.join(d, "offsite-drill.json"),
        JSON.stringify({ last_success_utc: "2026-10-20T00:00:00Z" }),
      );
      assert.equal(
        offsiteAgeSeconds(d, now, "offsite-drill.json"),
        0,
        "đồng hồ lệch tương lai → 0, không âm",
      );
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
