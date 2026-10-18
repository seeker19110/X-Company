// XC-PERF-003 (cổng đỏ khi vượt: thêm 200 KB), FE-PERF-004, XC-GREEN-001/002, OPS-SLO-001 (rule cảnh báo mẫu).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import * as alertsMod from "../../scripts/check-alerts.mjs";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import * as perfMod from "../../scripts/check-perf-budget.mjs";

interface Page {
  js_gzip_kb: number;
  css_gzip_kb: number;
  requests: number;
}
interface Measured {
  routes: Record<string, Page>;
  static_js_gzip_kb_total: number;
  static_js_files: number;
}
interface Budget {
  max_static_js_gzip_kb_total: number;
  routes: Record<string, { max_js_gzip_kb: number; max_requests: number }>;
}
type Assertion = [string, { maxNumericValue?: number; minScore?: number }];
interface Lhci {
  collect: { numberOfRuns: number; url: string[] };
  assert: { aggregationMethod: string; assertions: Record<string, Assertion> };
}
interface Rule {
  alert: string;
  expr: string;
  for?: string;
}
const checkAlerts = (alertsMod as { check: (t: string) => string[] }).check;
const parseRules = (alertsMod as { parseRules: (t: string) => Rule[] }).parseRules;
const perf = perfMod as {
  driftWarnings: (m: Measured, b: unknown, tol: number) => string[];
  evaluate: (m: Measured, b: Budget) => string[];
  latestBaseline: (dir: string) => string | null;
  measureBuild: (root: string) => Measured;
  routeOfManifest: (rel: string) => string;
};
const { driftWarnings, evaluate, latestBaseline, measureBuild, routeOfManifest } = perf;

const ROOT = new URL("../..", import.meta.url).pathname;
const tmp: string[] = [];
after(() => tmp.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Build giả cấu trúc Turbopack: một trang `/` dùng chunk chung + chunk riêng. */
function fakeBuild(pageChunkBytes: number): string {
  const root = mkdtempSync(path.join(tmpdir(), "perf-"));
  tmp.push(root);
  const next = path.join(root, ".next");
  mkdirSync(path.join(next, "static", "chunks"), { recursive: true });
  mkdirSync(path.join(next, "server", "app", "(public)"), { recursive: true });
  writeFileSync(path.join(next, "BUILD_ID"), "x");
  writeFileSync(path.join(next, "static", "chunks", "main.js"), randomBytes(10 * 1024));
  writeFileSync(path.join(next, "static", "chunks", "page.js"), randomBytes(pageChunkBytes)); // ngẫu nhiên → gzip không nén được
  writeFileSync(
    path.join(next, "build-manifest.json"),
    JSON.stringify({ polyfillFiles: [], rootMainFiles: ["static/chunks/main.js"] }),
  );
  const manifest = {
    entryJSFiles: { "[project]/app/(public)/page": ["static/chunks/page.js"] },
    entryCSSFiles: {},
  };
  writeFileSync(
    path.join(next, "server", "app", "(public)", "page_client-reference-manifest.js"),
    `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\nglobalThis.__RSC_MANIFEST["/(public)/page"] = ${JSON.stringify(manifest)};\n`,
  );
  return root;
}

const BUDGET = {
  max_static_js_gzip_kb_total: 100,
  routes: { "/": { max_js_gzip_kb: 60, max_requests: 5 } },
};

describe("ngân sách bundle (FE-PERF-004, XC-PERF-003)", () => {
  test("đo build giả: route, KB gzip, số request; trong ngân sách → đạt", () => {
    const m = measureBuild(fakeBuild(20 * 1024));
    assert.deepEqual(Object.keys(m.routes), ["/"]);
    const home = m.routes["/"];
    assert.ok(home !== undefined && home.js_gzip_kb >= 29 && home.js_gzip_kb <= 31.5, JSON.stringify(home));
    assert.equal(home.requests, 3); // tài liệu + 2 JS
    assert.deepEqual(evaluate(m, BUDGET), []);
  });

  test("cố ý thêm 200 KB JS → cổng đỏ (cả trang lẫn tổng)", () => {
    const errs = evaluate(measureBuild(fakeBuild(220 * 1024)), BUDGET);
    assert.ok(
      errs.some((e: string) => /^\/: JS gzip .* > ngân sách 60 KB/.test(e)),
      errs.join("|"),
    );
    assert.ok(
      errs.some((e: string) => /tổng JS .* > ngân sách 100 KB/.test(e)),
      errs.join("|"),
    );
  });

  test("vượt số request, trang chưa có ngân sách, ngân sách mồ côi → đỏ", () => {
    const m = measureBuild(fakeBuild(1024));
    assert.ok(
      evaluate(m, { ...BUDGET, routes: { "/": { max_js_gzip_kb: 60, max_requests: 2 } } })[0]?.includes(
        "request",
      ),
    );
    assert.ok(evaluate(m, { ...BUDGET, routes: {} }).some((e: string) => e.includes("chưa có ngân sách")));
    assert.ok(
      evaluate(m, {
        ...BUDGET,
        routes: { ...BUDGET.routes, "/cu": { max_js_gzip_kb: 1, max_requests: 1 } },
      }).some((e: string) => e.includes("không có trong build")),
    );
  });

  test("chưa build → ném lỗi rõ; routeOfManifest bỏ nhóm (x), giữ [slug]", () => {
    const empty = mkdtempSync(path.join(tmpdir(), "perf-"));
    tmp.push(empty);
    assert.throws(() => measureBuild(empty), /chưa build/);
    assert.equal(routeOfManifest("(public)/[...slug]/page_client-reference-manifest.js"), "/[...slug]");
    assert.equal(routeOfManifest("app/(secure)/today/page_client-reference-manifest.js"), "/app/today");
    assert.equal(routeOfManifest("(public)/page_client-reference-manifest.js"), "/");
  });

  test("lệch baseline > tolerance → cảnh báo; ngày mới nhất được chọn", () => {
    const m = {
      routes: { "/": { js_gzip_kb: 120, css_gzip_kb: 0, requests: 3 } },
      static_js_gzip_kb_total: 1,
      static_js_files: 1,
    };
    assert.equal(driftWarnings(m, { pages: { "/": { js_gzip_kb: 100 } } }, 10).length, 1);
    assert.equal(driftWarnings(m, { pages: { "/": { js_gzip_kb: 110 } } }, 10).length, 0);
    assert.equal(latestBaseline(path.join(tmpdir(), "khong-ton-tai-xyz")), null);
  });

  test("tệp ngân sách + baseline trong repo đúng cấu trúc, có ngày/commit", () => {
    const budget = JSON.parse(readFileSync(path.join(ROOT, "perf-budget.json"), "utf8"));
    assert.ok(budget.max_static_js_gzip_kb_total > 0);
    for (const b of Object.values<{ max_js_gzip_kb: number; max_requests: number }>(budget.routes))
      assert.ok(b.max_js_gzip_kb > 0 && b.max_requests > 0);
    const bl = latestBaseline(path.join(ROOT, "docs/perf"));
    assert.ok(bl, "thiếu docs/perf/baseline-*.json");
    const base = JSON.parse(readFileSync(bl, "utf8"));
    assert.match(base.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(base.commit, /^[0-9a-f]{40}$/);
    assert.ok(Object.keys(base.pages).length >= 3);
    for (const p of Object.values<{ js_gzip_kb: number; requests: number }>(base.pages))
      assert.ok(p.js_gzip_kb > 0 && p.requests > 0);
  });

  test("lighthouserc.json: 3 lần, median, assert error, ≥ 3 URL công khai, ngưỡng CWV", () => {
    const lh = (JSON.parse(readFileSync(path.join(ROOT, "lighthouserc.json"), "utf8")) as { ci: Lhci }).ci;
    assert.equal(lh.collect.numberOfRuns, 3);
    assert.equal(lh.assert.aggregationMethod, "median");
    for (const u of ["/", "/dich-vu", "/lien-he"])
      assert.ok((lh.collect.url as string[]).includes(`http://localhost:3100${u}`), u);
    const a = lh.assert.assertions;
    const opt = (k: string) => a[k]?.[1];
    assert.equal(opt("largest-contentful-paint")?.maxNumericValue, 2500);
    assert.equal(opt("cumulative-layout-shift")?.maxNumericValue, 0.1);
    assert.ok((opt("total-blocking-time")?.maxNumericValue ?? 0) > 0);
    assert.equal(opt("categories:performance")?.minScore, 0.9);
    for (const v of Object.values(a)) assert.equal(v[0], "error");
  });
});

describe("rule cảnh báo Prometheus mẫu (OPS-SLO-001, BE-JOB-004)", () => {
  const text = readFileSync(path.join(ROOT, "ops/prometheus/alerts.yml"), "utf8");

  test("tệp trong repo đạt kiểm cấu trúc; có burn-rate đa cửa sổ và DLQ>0", () => {
    assert.deepEqual(checkAlerts(text), []);
    const rules = parseRules(text);
    assert.ok(rules.length >= 4);
    const dlq = rules.find((r: { expr: string }) => /outbox_dead_total\s*>\s*0/.test(r.expr));
    assert.equal(dlq?.for, "15m");
  });

  test("thiếu severity/runbook_url/owner, metric lạ, thiếu DLQ → đỏ", () => {
    const bad = text.replace(/severity: page/, "severity: sev9").replace(/owner: seeker19110/, "owner:");
    assert.ok(checkAlerts(bad).some((e: string) => e.includes("severity")));
    assert.ok(checkAlerts(bad).some((e: string) => e.includes("owner")));
    assert.ok(
      checkAlerts(text.replace(/runbook_url: "https:\/\/[^"]*dlq--redrive"/, 'runbook_url: ""')).some(
        (e: string) => e.includes("runbook_url"),
      ),
    );
    assert.ok(
      checkAlerts(
        text.replace(
          "http_server_request_duration_seconds_count{http_response",
          "http_dur_count{http_response",
        ),
      ).some((e: string) => e.includes("metric lạ") || e.includes("nhãn")),
    );
    assert.ok(
      checkAlerts(text.replace("outbox_dead_total > 0", "outbox_dead_total > 5")).some((e: string) =>
        e.includes("DLQ"),
      ),
    );
    assert.ok(checkAlerts("").length > 0);
  });

  test("docs/ops/SLO.md dùng đúng tên metric và nhãn mà lib/http/metrics.ts xuất", () => {
    const slo = readFileSync(path.join(ROOT, "docs/ops/SLO.md"), "utf8");
    assert.match(slo, /http_server_request_duration_seconds_count\{http_response_status_code!~"5\.\."\}/);
    assert.match(slo, /http_route="\/api\/app\/attendance\/events"/);
    assert.doesNotMatch(slo, /\{status!~|\{route=/, "nhãn cũ (status/route) không còn");
  });
});
