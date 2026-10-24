// perf-load.mjs — đo hiệu năng dưới tải CỤC BỘ (T-049, QA-PERF-002/006/010, XC-PERF-004, PRF-WEB-005): bộ tải tự viết trên
// node:http keep-alive đánh vào bản build production (`next start`, cổng riêng) + Postgres tạm + dữ liệu seed.
// Gọi qua `npm run -s perf:load` (bọc bởi scripts/with-test-db.sh). Báo cáo docs/perf/load-report-<ngày>.md + .json ghi ra thư mục tạm (vào repo khi XC_REPORT_DIR=. / npm run -s reports:refresh);
// exit 1 khi một kịch bản vượt ngân sách. Nhãn bằng chứng: faithful-fixture — máy dev, KHÔNG phải production/thực địa.
// Chỉ nhắm loopback (QA-PERF-007): `PERF_BASE_URL` (tuỳ chọn) qua resolvePerfTarget — host ngoài máy này bị từ chối;
// `npm run -s check:perf-target` chặn CI/script đặt đích khác.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { login, makeAgent, request, writeHeaders } from "./lib/http-client.mjs";
import { resolvePerfTarget } from "./lib/perf-target.mjs";
import {
  environmentInfo,
  err,
  formatFiles,
  gitCommit,
  out,
  prepare,
  reportFile,
  repoReportRefusal,
} from "./lib/prod-harness.mjs";
import {
  childFailure,
  evaluateBudget,
  evaluateLockBudget,
  maxOf,
  renderLoadReport,
  summarize,
} from "./lib/perf-stats.mjs";
import {
  PERF_ATTENDANCE_USERS,
  PERIOD_EMPLOYEES,
  PERIOD_MONTHS,
  perfAttendanceEmail,
} from "./lib/perf-users.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = Number(process.env.PERF_PORT ?? 3300);
const DURATION_S = Number(process.env.PERF_DURATION_S ?? 12);
const WARMUP_S = Number(process.env.PERF_WARMUP_S ?? 3);
const CONNS = Number(process.env.PERF_CONNECTIONS ?? 16);
const INQUIRY_SEED = Number(process.env.PERF_SEED_INQUIRIES ?? 1500);

const NOT_PROVEN = [
  "Core Web Vitals p75 và INP thực địa (RUM/CrUX) — cần người dùng thật trên production (FE-PERF-001, PRF-WEB-005).",
  "Mạng thật: đo qua loopback cùng máy, không có độ trễ/mất gói/TLS/CDN; số p95 trên mạng di động sẽ cao hơn.",
  "Tải đa máy/đa instance, autoscale, và hành vi khi Postgres ở máy khác (độ trễ mạng DB).",
  "Độ bền dài (soak ≥ 30 phút), spike đột ngột, rò bộ nhớ/kết nối theo thời gian (QA-PERF-011/012).",
  "Bộ phát tải và máy chủ chia sẻ CPU của một máy 4 nhân: RPS là cận dưới, p99 chịu ảnh hưởng của bộ phát tải.",
  "Chốt kỳ đồng thời với ghi chấm công/duyệt đơn của cùng công ty (tranh khoá kỳ) — kịch bản chốt kỳ chạy một mình sau các kịch bản HTTP.",
  "Dữ liệu ở quy mô production (chỉ ~1 500 liên hệ + seed e2e); kế hoạch truy vấn trên dữ liệu lớn xem docs/db/explain/.",
];

/** Ngân sách theo kịch bản. Đặt TRƯỚC khi chạy, theo SLO và mục tiêu UX; lý do ở `why`. Không nới sau khi thấy đỏ nếu không ghi ở đây. */
// Trần thời gian cho tiến trình chốt kỳ (seed 200×31 + 3 lần lockPeriod ~ 1 phút trên máy dev): quá thì dừng, không treo.
const PERIOD_TIMEOUT_MS = 10 * 60_000;

const BUDGETS = {
  public: {
    p95Ms: 400,
    maxErrorRate: 0.01,
    why: "trang SSR công khai: p95 ≤ 400 ms ở 16 kết nối trên 4 nhân dùng chung với bộ phát tải (mục tiêu LCP ≤ 2,5 s cần TTFB ≪ 1 s).",
  },
  readyz: {
    p95Ms: 150,
    maxErrorRate: 0.01,
    why: "readyz chỉ `SELECT 1`: p95 ≤ 150 ms; sai lệch lớn nghĩa là hàng đợi pool/CPU quá tải.",
  },
  staffRead: {
    p95Ms: 500,
    maxErrorRate: 0.01,
    why: "đọc khu nội bộ (SSR hôm nay + API việc/duyệt): p95 ≤ 500 ms ở 16 kết nối.",
  },
  attendance: {
    p95Ms: 1000,
    maxErrorRate: 0.01,
    why: "SLO-2 (docs/ops/SLO.md): ghi chấm công p95 < 1 s — dùng NGUYÊN ngưỡng SLO, không nới cho máy dev.",
  },
  otCreate: {
    p95Ms: 1000,
    maxErrorRate: 0.01,
    why: "ghi nghiệp vụ có Idempotency-Key + kiểm hạn mức OT: dùng cùng ngưỡng p95 < 1 s của SLO ghi chấm công.",
  },
  otReplay: {
    p95Ms: 500,
    maxErrorRate: 0.01,
    why: "phát lại Idempotency-Key (đọc bản ghi đã lưu): p95 ≤ 500 ms.",
  },
  paging: {
    p95Ms: 500,
    maxErrorRate: 0.01,
    why: "danh sách phân trang (limit 50–200, offset lệch) trên ≥ 1 500 hàng: p95 ≤ 500 ms.",
  },
  periodLock: {
    p95Ms: 10_000,
    maxErrorRate: 0,
    maxQueries: 50,
    why: "chốt kỳ 200 nhân viên × 31 ngày trong MỘT giao dịch giữ khoá kỳ: mỗi lần ≤ 10 s (một phần ba statement_timeout 30 s của role ứng dụng, migration 0018 — còn dư khi dữ liệu lớn gấp ba) và ≤ 50 câu SQL (gom lô, không một INSERT mỗi dòng — AUD-PERF-001); không lần nào lỗi, đủ dòng.",
  },
};
const DB_CONN_BUDGET = 12; // DB_POOL_MAX mặc định = 10 (+ kết nối quản trị/đếm); vượt = rò kết nối hoặc cấu hình pool sai.

/** Vòng bắn tải: `conns` worker bắn liên tiếp tới khi hết thời gian; trả mẫu sau khởi động. */
async function drive({ base, agent, conns, durationMs, warmupMs, next, expected }) {
  const latencies = [];
  const statuses = [];
  let networkErrors = 0;
  const t0 = performance.now();
  const warmEnd = t0 + warmupMs;
  const end = warmEnd + durationMs;
  let measureStart = warmEnd;
  const worker = async (id) => {
    for (let i = 0; performance.now() < end; i++) {
      const o = next(id, i);
      const started = performance.now();
      let r = null;
      try {
        r = await request(base, { ...o, agent, timeoutMs: 20_000 });
      } catch {
        r = null;
      }
      if (started < warmEnd) continue;
      if (r === null) networkErrors += 1;
      else {
        statuses.push(r.status);
        latencies.push(r.ms);
      }
    }
  };
  await Promise.all(Array.from({ length: conns }, (_, i) => worker(i)));
  return { latencies, statuses, networkErrors, durationMs: performance.now() - measureStart, expected };
}

/** Bắn đúng `count` request (kịch bản ghi có trần nghiệp vụ). */
async function driveCount({ base, agent, conns, count, next, expected }) {
  const latencies = [];
  const statuses = [];
  let networkErrors = 0;
  let issued = 0;
  const t0 = performance.now();
  const worker = async () => {
    while (issued < count) {
      const i = issued++;
      let r = null;
      try {
        r = await request(base, { ...next(i), agent, timeoutMs: 20_000 });
      } catch {
        r = null;
      }
      if (r === null) networkErrors += 1;
      else {
        statuses.push(r.status);
        latencies.push(r.ms);
      }
    }
  };
  await Promise.all(Array.from({ length: conns }, worker));
  return { latencies, statuses, networkErrors, durationMs: performance.now() - t0, expected };
}

async function sampleDb(adminUrl, appRole) {
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  const samples = [];
  let stop = false;
  const loop = (async () => {
    while (!stop) {
      try {
        const r = await c.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename = $1", [
          appRole,
        ]);
        samples.push(r.rows[0].n);
      } catch (e) {
        err(`lấy mẫu kết nối DB: ${e.message}`);
      }
      await sleep(250);
    }
  })();
  return {
    samples,
    async stop() {
      stop = true;
      await loop;
      await c.end();
    },
  };
}

const otDate = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

function lighthouseSection() {
  const dir = path.join(ROOT, ".lighthouseci");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => /^lhr-.*\.json$/.test(f));
  if (files.length === 0) return null;
  const byUrl = new Map();
  for (const f of files) {
    const j = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
    const a = j.audits ?? {};
    const row = {
      score: Math.round((j.categories?.performance?.score ?? 0) * 100),
      lcp: Math.round(a["largest-contentful-paint"]?.numericValue ?? NaN),
      cls: Math.round((a["cumulative-layout-shift"]?.numericValue ?? NaN) * 1000) / 1000,
      tbt: Math.round(a["total-blocking-time"]?.numericValue ?? NaN),
      version: j.lighthouseVersion,
      form: j.configSettings?.formFactor,
      time: j.fetchTime,
    };
    const k = new URL(j.finalUrl ?? j.requestedUrl).pathname;
    byUrl.set(k, [...(byUrl.get(k) ?? []), row]);
  }
  const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const L = [
    `Nguồn: \`npm run -s lighthouse\` (lhci 0.15.1, ${[...byUrl.values()][0][0].form}, median ${[...byUrl.values()][0].length} lần, throttling mô phỏng mặc định của Lighthouse), lần chạy ${[...byUrl.values()][0][0].time}. Lighthouse ${[...byUrl.values()][0][0].version}; INP không đo được ở lab — TBT là proxy.`,
    "",
    "| URL | Điểm Performance | LCP ms | CLS | TBT ms (proxy INP) |",
    "|---|---|---|---|---|",
  ];
  for (const [k, rows] of byUrl)
    L.push(
      `| ${k} | ${med(rows.map((r) => r.score))} | ${med(rows.map((r) => r.lcp))} | ${med(rows.map((r) => r.cls))} | ${med(rows.map((r) => r.tbt))} |`,
    );
  L.push("");
  L.push(
    "Ngưỡng cổng (lighthouserc.json): Performance ≥ 0,9 · LCP ≤ 2 500 · CLS ≤ 0,1 · TBT ≤ 300. Đây là số lab trên máy dev, không phải CWV p75 thực địa.",
  );
  return L.join("\n");
}

async function main() {
  const refusal = repoReportRefusal(gitCommit(), process.env.XC_REPORT_DIR);
  if (refusal !== null) {
    err(`perf:load từ chối: ${refusal}`);
    return 2;
  }
  const h = prepare({ prefix: "PERF", extraSeeds: ["scripts/seed-perf.ts"] });
  const server = await h.start(PORT, { TRUST_PROXY_HOPS: "1" });
  try {
    const base = resolvePerfTarget(process.env.PERF_BASE_URL, server.baseUrl);
    const origin = server.origin;
    const agent = makeAgent(CONNS * 2);
    const U = (k) => h.seed.users[k];
    const pw = h.seed.password;
    const ip = (() => {
      let n = 0;
      return () => `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${(n += 1) & 255}`;
    })();
    // Phiên: nhiều lần đăng nhập mỗi người dùng (mỗi VU một phiên) — Argon2 nằm ngoài vùng đo.
    const sess = async (k, n) =>
      Promise.all(
        Array.from({ length: n }, () => login(base, origin, U(k).email, pw, { "x-forwarded-for": ip() })),
      );
    const nvS = await sess("nv", 4);
    const nv2S = await sess("nv2", 2);
    const tlS = await sess("tl", 2);
    const salesS = await sess("sales", 2);
    const pick = (arr, id) => arr[id % arr.length];
    // Ghi chấm công: mỗi request một nhân viên kế tiếp (vòng tròn) để không chạm trần 60 lượt/phút/người (AUD-XFEAT-004).
    const attS = [];
    for (let i = 0; i < PERF_ATTENDANCE_USERS; i += 16) {
      const batch = Array.from({ length: Math.min(16, PERF_ATTENDANCE_USERS - i) }, (_, j) =>
        login(base, origin, perfAttendanceEmail(i + j), pw, { "x-forwarded-for": ip() }),
      );
      attS.push(...(await Promise.all(batch)));
    }
    let attN = 0;

    // Dữ liệu đại diện: nhiều liên hệ cho kịch bản phân trang (QA-PERF-010) — qua API công khai, mỗi request một IP giả.
    for (let i = 0; i < INQUIRY_SEED; i += 25) {
      await Promise.all(
        Array.from({ length: Math.min(25, INQUIRY_SEED - i) }, (_, j) =>
          request(base, {
            method: "POST",
            path: "/api/public/inquiries",
            headers: { "content-type": "application/json", "x-forwarded-for": ip() },
            body: JSON.stringify({
              submission_id: randomUUID(),
              name: `Khách tải ${i + j}`,
              email: `k${i + j}@perf.test`,
              message: `Nhu cầu số ${i + j} `.repeat(4),
              consent: true,
              elapsed_ms: 6000,
            }),
            agent,
          }),
        ),
      );
    }

    const db = await sampleDb(h.adminUrl, new URL(h.appDbUrl).username);
    const rows = [];
    const dur = DURATION_S * 1000;
    const warm = WARMUP_S * 1000;
    const run = async (name, description, connections, budgetKey, expected, fn, note) => {
      const before = db.samples.length;
      const raw = await fn();
      const sum = summarize(raw);
      const conn = maxOf(db.samples.slice(before));
      const budget = BUDGETS[budgetKey];
      const violations = evaluateBudget(sum, budget);
      rows.push({
        name,
        description,
        connections,
        durationLabel: raw.fixedCount ? `${sum.samples} request` : `${DURATION_S}s`,
        warmupLabel: `${WARMUP_S}s`,
        summary: sum,
        dbConnMax: conn,
        budget,
        budgetWhy: budget.why,
        violations,
        expected,
        note,
      });
      out(
        `${violations.length === 0 ? "ĐẠT " : "VƯỢT "} ${name}: p50 ${sum.p50} p95 ${sum.p95} p99 ${sum.p99} ms · ${sum.rps} rps · lỗi ${sum.errors}/${sum.samples} · DB≤${conn}${violations.length > 0 ? ` · ${violations.join("; ")}` : ""}`,
      );
    };
    const drv = (o) => drive({ base, agent, durationMs: dur, warmupMs: warm, ...o });

    const pubPaths = ["/", "/dich-vu", "/lien-he", "/dich-vu/tu-van-thiet-ke"];
    await run(
      "Trang công khai (/, /dich-vu, /lien-he, /dich-vu/tu-van-thiet-ke)",
      "GET xoay vòng 4 trang SSR công khai, không cookie.",
      CONNS,
      "public",
      [200],
      () => drv({ conns: CONNS, expected: [200], next: (_, i) => ({ path: pubPaths[i % pubPaths.length] }) }),
    );
    await run("GET /api/readyz", "Probe sẵn sàng (SELECT 1 trong hạn 2 s).", CONNS, "readyz", [200], () =>
      drv({ conns: CONNS, expected: [200], next: () => ({ path: "/api/readyz" }) }),
    );
    const readPaths = (id) => [
      { path: "/app/today", headers: { cookie: pick(nvS, id).cookie } },
      { path: "/api/app/tasks", headers: { cookie: pick(nvS, id).cookie } },
      { path: "/api/app/approvals", headers: { cookie: pick(tlS, id).cookie } },
      { path: "/app/tasks", headers: { cookie: pick(nvS, id).cookie } },
    ];
    await run(
      "Nhân viên đọc (today, tasks, approvals)",
      "Đăng nhập sẵn; GET /app/today, /api/app/tasks, /app/tasks (nv) và /api/app/approvals (tl) xoay vòng.",
      CONNS,
      "staffRead",
      [200],
      () => drv({ conns: CONNS, expected: [200], next: (id, i) => readPaths(id)[i % 4] }),
    );
    // Chấm công: mỗi VU một nhân viên-phiên; vào/ra ca xen kẽ, khoá Idempotency riêng mỗi lần.
    const kinds = ["in", "break_start", "break_end", "out"];
    await run(
      "Ghi chấm công (POST /api/app/attendance/events)",
      `Vào ca/nghỉ/hết nghỉ/ra ca xen kẽ, request chia vòng tròn cho ${PERF_ATTENDANCE_USERS} nhân viên (trần 60 lượt/phút/người — 429 tính là lỗi), mỗi request khoá Idempotency riêng; chấp nhận 200/201 và 409 nghiệp vụ trình tự.`,
      8,
      "attendance",
      [200, 201, 409],
      () =>
        drv({
          conns: 8,
          expected: [200, 201, 409],
          next: (id, i) => {
            const s = attS[attN++ % attS.length];
            return {
              method: "POST",
              path: "/api/app/attendance/events",
              headers: writeHeaders(s, origin, {
                "idempotency-key": `perf-att-${randomUUID()}`,
                "x-forwarded-for": ip(),
              }),
              body: JSON.stringify({
                kind: kinds[i % 4],
                device_time: new Date().toISOString(),
                source: "gps",
              }),
            };
          },
        }),
      "Trình tự sự kiện xen kẽ có thể bị 409 nghiệp vụ — chấp nhận, không tính là lỗi hệ thống (xem mục mã trạng thái để biết có xuất hiện không); 5xx và lỗi mạng luôn là lỗi.",
    );
    // Tạo đơn OT: trần nghiệp vụ theo ngày/tháng → đúng N request, mỗi cái một ngày riêng của quá khứ.
    const otN = 120;
    const otSessions = [...nv2S, ...nvS.slice(2)];
    await run(
      "Tạo đơn OT có Idempotency-Key (POST /api/app/ot-requests)",
      `${otN} đơn, mỗi đơn một ngày nghiệp vụ riêng (trần OT theo ngày/tháng) và khoá riêng, 8 kết nối.`,
      8,
      "otCreate",
      [201, 422],
      async () => {
        const r = await driveCount({
          base,
          agent,
          conns: 8,
          count: otN,
          expected: [201, 422],
          next: (i) => ({
            method: "POST",
            path: "/api/app/ot-requests",
            headers: writeHeaders(otSessions[i % otSessions.length], origin, {
              "idempotency-key": `perf-ot-${randomUUID()}`,
            }),
            body: JSON.stringify({
              business_date: otDate(30 + i),
              minutes: 20,
              reason: "đo tải",
              consent: true,
            }),
          }),
        });
        r.fixedCount = true;
        return r;
      },
      "Chấp nhận 201 và 422 (vượt hạn mức nghiệp vụ theo tháng — luật hợp lệ); 5xx/lỗi mạng là lỗi.",
    );
    const replayKey = `perf-replay-${randomUUID()}`;
    const replayBody = JSON.stringify({
      business_date: otDate(400),
      minutes: 20,
      reason: "phát lại",
      consent: true,
    });
    const first = await request(base, {
      method: "POST",
      path: "/api/app/ot-requests",
      headers: writeHeaders(nv2S[0], origin, { "idempotency-key": replayKey }),
      body: replayBody,
      agent,
    });
    await run(
      "Phát lại Idempotency-Key (POST /api/app/ot-requests)",
      `Cùng khoá + cùng thân (lần đầu → ${first.status}); các lần sau phải phát lại nguyên văn.`,
      8,
      "otReplay",
      [first.status],
      () =>
        drv({
          conns: 8,
          expected: [first.status],
          next: () => ({
            method: "POST",
            path: "/api/app/ot-requests",
            headers: writeHeaders(nv2S[0], origin, { "idempotency-key": replayKey }),
            body: replayBody,
          }),
        }),
    );
    await run(
      "Danh sách phân trang (tasks, inquiries ≥ 1 500 hàng)",
      "GET /api/app/inquiries?limit=50|200&offset lệch lên tới 1 400 (sales) xen /api/app/tasks?limit=50 (nv).",
      CONNS,
      "paging",
      [200],
      () =>
        drv({
          conns: CONNS,
          expected: [200],
          next: (id, i) => {
            if (i % 4 === 3)
              return { path: "/api/app/tasks?limit=50", headers: { cookie: pick(nvS, id).cookie } };
            const limit = i % 2 === 0 ? 50 : 200;
            return {
              path: `/api/app/inquiries?limit=${limit}&offset=${(i * 50) % 1400}`,
              headers: { cookie: pick(salesS, id).cookie },
            };
          },
        }),
    );
    // Chốt kỳ (AUD-PERF-001): tiến trình tsx riêng gọi thẳng lib (chưa có route), role ứng dụng; kỳ quá khứ, sau mọi kịch bản HTTP.
    {
      const before = db.samples.length;
      const r = spawnSync("npx", ["--no-install", "tsx", "scripts/perf-period.ts"], {
        cwd: ROOT,
        env: { ...process.env, DATABASE_URL: h.adminUrl, PERF_APP_DATABASE_URL: h.appDbUrl },
        encoding: "utf8",
        maxBuffer: 1 << 20,
        timeout: PERIOD_TIMEOUT_MS,
      });
      const failed = childFailure("perf-period", r, PERIOD_TIMEOUT_MS);
      if (failed) throw new Error(failed);
      const runs = JSON.parse(r.stdout.trim().split("\n").at(-1));
      const budget = BUDGETS.periodLock;
      const sum = summarize({
        latencies: runs.filter((x) => x.ms !== null).map((x) => x.ms),
        statuses: runs.map((x) => (x.error === undefined ? 200 : 500)),
        networkErrors: 0,
        durationMs: runs.reduce((a, x) => a + (x.ms ?? 0), 0),
        expected: [200],
      });
      const violations = evaluateLockBudget(runs, { maxMs: budget.p95Ms, maxQueries: budget.maxQueries });
      rows.push({
        name: `Chốt kỳ công ${PERIOD_EMPLOYEES} nhân viên × 31 ngày (lockPeriod)`,
        description: `${runs.length} kỳ quá khứ (${PERIOD_MONTHS.map((m) => m.code).join(", ")}) chốt lần lượt, mỗi kỳ ${PERIOD_EMPLOYEES} nhân viên có ca mọi ngày (10% có sự kiện vào/ra); đo cả giao dịch khoá kỳ.`,
        connections: 1,
        durationLabel: `${runs.length} lần chốt`,
        warmupLabel: "0s",
        summary: sum,
        dbConnMax: maxOf(db.samples.slice(before)),
        budget,
        budgetWhy: budget.why,
        violations,
        expected: [200],
        note: `Từng lần: ${runs.map((x) => `${x.code} ${x.ms ?? "n/a"} ms, ${x.queries} câu SQL, ${x.lines}/${x.expectedLines} dòng${x.error ? `, lỗi ${x.error}` : ""}`).join("; ")}. Mã 200/500 là quy ước của báo cáo (thành công/lỗi), không phải request HTTP.`,
      });
      out(
        `${violations.length === 0 ? "ĐẠT " : "VƯỢT "} chốt kỳ: ${runs.map((x) => `${x.code} ${x.ms ?? "n/a"} ms/${x.queries} SQL`).join(" · ")}${violations.length > 0 ? ` · ${violations.join("; ")}` : ""}`,
      );
    }
    await db.stop();
    const dbMax = maxOf(db.samples);
    const dbViol =
      dbMax === null || dbMax > DB_CONN_BUDGET ? [`kết nối DB tối đa ${dbMax} > ${DB_CONN_BUDGET}`] : [];
    out(
      `${dbViol.length === 0 ? "ĐẠT " : "VƯỢT "} kết nối DB tối đa toàn phiên: ${dbMax} (ngân sách ≤ ${DB_CONN_BUDGET})`,
    );

    const env = environmentInfo();
    const date = new Date().toISOString().slice(0, 10);
    const meta = {
      date,
      commit: gitCommit(),
      env: `máy dev (${env.os}); Node ${env.node}; Next ${env.next} \`next start\` bản build production; ${env.psql ?? "PostgreSQL tạm (initdb, fsync=off)"}; app chạy bằng role không superuser; DB_POOL_MAX=10 (mặc định)`,
      device: `${env.cpus}, ${env.memGiB} GiB RAM; bộ phát tải cùng máy; mạng loopback 127.0.0.1 (không mô phỏng băng thông/độ trễ)`,
      load: `${CONNS} kết nối keep-alive (ghi: 8), ${DURATION_S} s đo + ${WARMUP_S} s khởi động mỗi kịch bản (OT: ${otN} request cố định); dữ liệu seed e2e + ${INQUIRY_SEED} liên hệ; chốt ${PERIOD_MONTHS.length} kỳ × ${PERIOD_EMPLOYEES} nhân viên × 31 ngày`,
      slo: "SLI-2 ghi chấm công p95 < 1 s (95% ≤ 1 s/30 ngày); SLI-1 khả dụng 99,9% ⇒ tỉ lệ lỗi 5xx ≤ 0,1% (cổng ở đây dùng ≤ 1% theo `http_req_failed rate<0.01` của QA-PERF-002 vì mẫu ngắn).",
      budgetNotes: [
        "Ngân sách đặt TRƯỚC khi chạy trong `scripts/perf-load.mjs` (hằng `BUDGETS`) kèm lý do; ngưỡng ghi chấm công/OT dùng nguyên SLO, các ngưỡng còn lại là mục tiêu dev cho máy 4 nhân dùng chung với bộ phát tải. Nới ngưỡng sau khi thấy đỏ phải ghi lý do vào chính hằng này và báo cáo.",
        `Kết nối DB: ngân sách ≤ ${DB_CONN_BUDGET} (pool ứng dụng 10 + kết nối quản trị); đo toàn phiên = ${dbMax}${dbViol.length > 0 ? " — **VƯỢT**" : " — đạt"}.`,
        "Lỗi = lỗi mạng/timeout hoặc mã ngoài tập mong đợi của kịch bản; 5xx luôn là lỗi.",
      ],
      notProven: NOT_PROVEN,
    };
    const lh = lighthouseSection();
    const md = renderLoadReport(meta, rows, {
      lighthouse:
        lh ??
        "Chưa có kết quả: chạy `npm run -s lighthouse` trước `perf:load` (cần Chromium của Playwright và `npx` tải được @lhci/cli@0.15.1).",
    });
    const reportMd = reportFile(`docs/perf/load-report-${date}.md`);
    const reportJson = reportFile(`docs/perf/load-report-${date}.json`);
    writeFileSync(reportMd, md);
    const failedRows = rows.filter((r) => r.violations.length > 0);
    writeFileSync(
      reportJson,
      `${JSON.stringify({ label: "faithful-fixture", qa_perf_006: { commit: meta.commit, environment: meta.env, device_network: meta.device, load: meta.load, date }, dbConnectionsMax: dbMax, dbConnectionBudget: DB_CONN_BUDGET, scenarios: rows.map((r) => ({ name: r.name, connections: r.connections, budget: r.budget, summary: r.summary, dbConnMax: r.dbConnMax, violations: r.violations })), notProven: NOT_PROVEN }, null, 2)}\n`,
    );
    formatFiles([reportMd, reportJson]);
    out(
      `perf:load: ${rows.length - failedRows.length}/${rows.length} kịch bản đạt ngân sách · báo cáo ${reportMd}`,
    );
    return failedRows.length === 0 && dbViol.length === 0 ? 0 : 1;
  } finally {
    server.stop();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (c) => process.exit(c),
    (e) => {
      err(`perf:load lỗi hạ tầng: ${e?.stack ?? e}`);
      process.exit(2);
    },
  );
}
