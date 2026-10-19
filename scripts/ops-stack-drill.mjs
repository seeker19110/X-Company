// ops-stack-drill.mjs — Prometheus + Alertmanager THẬT chạy cục bộ (T-054, D-041; OPS-SLO-001/006, OPS-OBS-*).
// Gọi qua `npm run -s ops:stack:drill` (bọc bởi scripts/with-test-db.sh). Các bước:
//   1. Kiểm tĩnh bằng công cụ chính chủ: `promtool check rules` + `promtool test rules` (unit test mọi rule thật, đồng hồ giả),
//      `promtool check config --syntax-only` và `amtool check-config` cho cấu hình mẫu ở ops/.
//   2. End-to-end: bản build production (`next start`) xuất /api/metrics có bearer → Prometheus scrape mỗi giây, nạp rule thật
//      + một rule diễn tập (`up == 0`) → Alertmanager → webhook HTTP cục bộ. Dừng app → cảnh báo "firing" tới webhook;
//      bật lại → "resolved". Rule thật phải nạp với health=ok và không bắn khi lưu lượng sạch.
// Ghi docs/ops/ops-stack-drill.md + .json (sinh lại được); exit 1 khi có bước đỏ.
// Nhãn bằng chứng: faithful-fixture — máy dev, Postgres tạm, kênh webhook cục bộ; KHÔNG phải hạ tầng giám sát production.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { environmentInfo, err, formatFiles, gitCommit, out, prepare } from "./lib/prod-harness.mjs";
import { TOOLS, installedPath } from "./tools/install-tool.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const APP_PORT = Number(process.env.OPS_APP_PORT ?? 3400);
const RULES = path.join(ROOT, "ops", "prometheus", "alerts.yml");
const RULE_TESTS = path.join(ROOT, "ops", "prometheus", "alerts.test.yml");
const SAMPLE_PROM = path.join(ROOT, "ops", "prometheus", "prometheus.yml");
const SAMPLE_AM = path.join(ROOT, "ops", "alertmanager", "alertmanager.yml");
export const DRILL_ALERT = "XCDrillTargetDown";
const NEEDED = ["prometheus", "promtool", "alertmanager", "amtool"];

const NOT_PROVEN = [
  "Không phải hạ tầng production: một máy dev, Prometheus/Alertmanager một bản (không HA, không lưu trữ dài hạn, không remote-write).",
  "Kênh nhận là webhook HTTP cục bộ do drill dựng; chưa gửi tới kênh trực có người (Slack/điện thoại/email) — cần URL thật trong url_file.",
  "Rule SLO thật được kiểm bằng `promtool test rules` trên chuỗi tổng hợp với đồng hồ giả; end-to-end thời gian thật chỉ chạy rule diễn tập `up == 0` (cửa sổ burn-rate 1h–6h không chờ được trong một lần chạy).",
  "Cấu hình mẫu ops/ chỉ kiểm cú pháp (`--syntax-only`, amtool); đường dẫn credentials_file/url_file trên máy thật chưa tồn tại.",
  "Không TLS giữa Prometheus và app (scrape http trên 127.0.0.1); production nên scrape qua mạng nội bộ hoặc TLS.",
];

/** YAML cấu hình Prometheus cho drill (chuỗi thuần — mọi giá trị do drill tự sinh, không có đầu vào ngoài). */
export function renderPrometheusConfig({ appPort, amPort, tokenFile, ruleFiles, interval = "1s" }) {
  return [
    "global:",
    `  scrape_interval: ${interval}`,
    `  evaluation_interval: ${interval}`,
    "rule_files:",
    ...ruleFiles.map((f) => `  - ${JSON.stringify(f)}`),
    "alerting:",
    "  alertmanagers:",
    "    - static_configs:",
    `        - targets: ["127.0.0.1:${amPort}"]`,
    "scrape_configs:",
    "  - job_name: x-company",
    "    metrics_path: /api/metrics",
    "    authorization:",
    "      type: Bearer",
    `      credentials_file: ${JSON.stringify(tokenFile)}`,
    "    static_configs:",
    `      - targets: ["127.0.0.1:${appPort}"]`,
    "",
  ].join("\n");
}

/** YAML cấu hình Alertmanager cho drill: gom tức thì, gửi cả "resolved" tới webhook cục bộ. */
export function renderAlertmanagerConfig({ webhookUrl }) {
  return [
    "route:",
    "  receiver: drill",
    '  group_by: ["alertname"]',
    "  group_wait: 1s",
    "  group_interval: 1s",
    "  repeat_interval: 1h",
    "receivers:",
    "  - name: drill",
    "    webhook_configs:",
    `      - url: ${JSON.stringify(webhookUrl)}`,
    "        send_resolved: true",
    "",
  ].join("\n");
}

/** Rule diễn tập: mục tiêu scrape mất → bắn ngay (for 0s) để thử đường ống Prometheus → Alertmanager → kênh. */
export function renderDrillRules() {
  return [
    "groups:",
    "  - name: x-company-drill",
    "    rules:",
    `      - alert: ${DRILL_ALERT}`,
    '        expr: up{job="x-company"} == 0',
    "        for: 0s",
    "        labels:",
    "          severity: page",
    "          owner: drill",
    "        annotations:",
    '          summary: "Diễn tập: Prometheus không scrape được x-company"',
    "",
  ].join("\n");
}

/** Lọc thông báo webhook của Alertmanager (payload v4) theo alertname + trạng thái. */
export function notificationsFor(payloads, alertname, status) {
  return payloads.filter(
    (p) =>
      p?.version === "4" &&
      p.status === status &&
      Array.isArray(p.alerts) &&
      p.alerts.some((a) => a?.labels?.alertname === alertname && a.status === status),
  );
}

/** Mỗi khối ```promql của SLO.md là MỘT biểu thức (tỉ lệ tốt/tổng nhiều dòng): bỏ chú thích `#`, gộp dòng. */
export function sloQueries(markdown) {
  const qs = [];
  for (const m of markdown.matchAll(/```promql\n([\s\S]*?)```/g)) {
    const q = m[1]
      .split("\n")
      .map((l) => l.replace(/(^|\s)#.*$/, "").trim())
      .filter((l) => l !== "")
      .join(" ");
    if (q !== "") qs.push(q);
  }
  return qs;
}

/** Tên alert trong tệp rule. */
export function alertNames(rulesYml) {
  return [...rulesYml.matchAll(/^\s*- alert:\s*(\S+)\s*$/gm)].map((m) => m[1]);
}

/** OPS-SLO-006 "mọi alert được thử": mỗi alert phải có ≥ 1 ca BẮN và ≥ 1 ca KHÔNG BẮN trong tệp promtool test. */
export function ruleCoverage(rulesYml, testsYml) {
  const fire = new Set();
  const quiet = new Set();
  for (const m of testsYml.matchAll(/alertname:\s*(\S+)\s*\n\s*exp_alerts:[ \t]*(\[\])?/g))
    (m[2] === "[]" ? quiet : fire).add(m[1]);
  return alertNames(rulesYml).flatMap((a) => [
    ...(fire.has(a) ? [] : [`${a}: thiếu ca bắn`]),
    ...(quiet.has(a) ? [] : [`${a}: thiếu ca không bắn`]),
  ]);
}

/** Tóm tắt /api/v1/rules: các rule đọc từ tệp nào, health từng rule. */
export function summarizeRules(body) {
  const rows = [];
  for (const g of body?.data?.groups ?? [])
    for (const r of g.rules ?? [])
      rows.push({ group: g.name, file: g.file, name: r.name, health: r.health, state: r.state });
  return rows;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function tool(name) {
  let p = installedPath(name);
  if (p === null) {
    const r = spawnSync(
      process.execPath,
      [path.join(ROOT, "scripts/tools/install-tool.mjs"), "install", name],
      {
        cwd: ROOT,
        stdio: ["ignore", "inherit", "inherit"],
      },
    );
    if (r.status !== 0) throw new Error(`không cài được ${name}`);
    p = installedPath(name);
  }
  if (p === null) throw new Error(`thiếu ${name}`);
  return p;
}

function check(label, bin, args) {
  const t0 = Date.now();
  const r = spawnSync(bin, args, { cwd: ROOT, encoding: "utf8" });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  return {
    label,
    cmd: [path.basename(bin), ...args.map((a) => path.relative(ROOT, a) || a)].join(" "),
    ok: r.status === 0,
    ms: Date.now() - t0,
    output,
  };
}

const procs = new Set();
function startDaemon(bin, args, label) {
  const child = spawn(bin, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  procs.add(child);
  let log = "";
  child.stdout.on("data", (d) => (log = (log + d).slice(-4000)));
  child.stderr.on("data", (d) => (log = (log + d).slice(-4000)));
  child.on("exit", () => procs.delete(child));
  return { label, child, log: () => log };
}
function stopDaemons() {
  for (const c of procs) c.kill("SIGTERM");
}
process.on("exit", stopDaemons);

async function waitFor(desc, fn, timeoutMs, stepMs = 250) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) {
    try {
      last = await fn();
      if (last) return { value: last, ms: Date.now() - t0 };
    } catch (e) {
      last = e;
    }
    await sleep(stepMs);
  }
  throw new Error(`hết ${timeoutMs} ms chờ: ${desc}${last instanceof Error ? ` (${last.message})` : ""}`);
}

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

async function promQuery(base, q) {
  const body = await getJson(`${base}/api/v1/query?query=${encodeURIComponent(q)}`);
  return body?.data?.result ?? [];
}

async function main() {
  const startedAt = new Date().toISOString();
  const versions = Object.fromEntries(NEEDED.map((n) => [n, TOOLS[n].version]));
  const bins = Object.fromEntries(NEEDED.map((n) => [n, tool(n)]));

  // 1. Kiểm tĩnh.
  const checks = [
    check("rule hợp lệ", bins.promtool, ["check", "rules", RULES]),
    check("unit test rule (đồng hồ giả)", bins.promtool, ["test", "rules", RULE_TESTS]),
    check("cấu hình Prometheus mẫu", bins.promtool, ["check", "config", "--syntax-only", SAMPLE_PROM]),
    check("cấu hình Alertmanager mẫu", bins.amtool, ["check-config", SAMPLE_AM]),
  ];
  const rulesText = readFileSync(RULES, "utf8");
  const gaps = ruleCoverage(rulesText, readFileSync(RULE_TESTS, "utf8"));
  checks.push({
    label: "mọi alert có ca bắn + ca không bắn",
    cmd: "ruleCoverage(alerts.yml, alerts.test.yml)",
    ok: gaps.length === 0,
    ms: 0,
    output: gaps.length === 0 ? `${alertNames(rulesText).length} alert đủ ca` : gaps.join("\n"),
  });
  for (const c of checks) out(`${c.ok ? "✓" : "✗"} ${c.label}: ${c.cmd}`);

  // 2. End-to-end.
  const steps = [];
  const step = (name, ok, detail) => {
    steps.push({ name, ok, detail });
    out(`${ok ? "✓" : "✗"} ${name} — ${detail}`);
  };
  const work = mkdtempSync(path.join(tmpdir(), "ops-stack-"));
  const payloads = [];
  const hook = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      try {
        payloads.push({ ...JSON.parse(body), receivedAt: Date.now() });
      } catch {
        payloads.push({ invalid: body.slice(0, 200), receivedAt: Date.now() });
      }
      res.writeHead(200).end();
    });
  });
  try {
    const h = prepare({ prefix: "OPS" });
    const token = randomBytes(24).toString("hex");
    let app = await h.start(APP_PORT, { METRICS_TOKEN: token });

    await new Promise((r) => hook.listen(0, "127.0.0.1", r));
    const webhookUrl = `http://127.0.0.1:${hook.address().port}/hook`;
    const [amPort, promPort] = [await freePort(), await freePort()];
    const tokenFile = path.join(work, "metrics_token");
    writeFileSync(tokenFile, token);
    chmodSync(tokenFile, 0o600);
    const drillRules = path.join(work, "drill.rules.yml");
    writeFileSync(drillRules, renderDrillRules());
    writeFileSync(path.join(work, "alertmanager.yml"), renderAlertmanagerConfig({ webhookUrl }));
    writeFileSync(
      path.join(work, "prometheus.yml"),
      renderPrometheusConfig({ appPort: APP_PORT, amPort, tokenFile, ruleFiles: [RULES, drillRules] }),
    );
    mkdirSync(path.join(work, "am"));
    mkdirSync(path.join(work, "tsdb"));

    // Không token → 401; Prometheus có token mới scrape được (quyền kiểm ở server).
    const noAuth = await fetch(`${app.baseUrl}/api/metrics`);
    step("/api/metrics từ chối khi thiếu bearer", noAuth.status === 401, `HTTP ${noAuth.status}`);

    const am = startDaemon(
      bins.alertmanager,
      [
        `--config.file=${path.join(work, "alertmanager.yml")}`,
        `--storage.path=${path.join(work, "am")}`,
        `--web.listen-address=127.0.0.1:${amPort}`,
        "--cluster.listen-address=",
      ],
      "alertmanager",
    );
    const prom = startDaemon(
      bins.prometheus,
      [
        `--config.file=${path.join(work, "prometheus.yml")}`,
        `--storage.tsdb.path=${path.join(work, "tsdb")}`,
        `--web.listen-address=127.0.0.1:${promPort}`,
      ],
      "prometheus",
    );
    const promBase = `http://127.0.0.1:${promPort}`;
    const amBase = `http://127.0.0.1:${amPort}`;
    try {
      await waitFor("alertmanager sẵn sàng", async () => (await fetch(`${amBase}/-/ready`)).ok, 30_000);
      await waitFor("prometheus sẵn sàng", async () => (await fetch(`${promBase}/-/ready`)).ok, 30_000);
    } catch (e) {
      throw new Error(`${e.message}\n[alertmanager] ${am.log()}\n[prometheus] ${prom.log()}`);
    }

    // Lưu lượng thật qua route có đo RED (lib/http: withActor/withPublic): /api/app/me không phiên → 401.
    for (let i = 0; i < 40; i++) await fetch(`${app.baseUrl}/api/app/me`);
    const up = await waitFor(
      "scrape up == 1",
      async () => (await promQuery(promBase, 'up{job="x-company"} == 1')).length === 1,
      30_000,
    );
    step("Prometheus scrape /api/metrics có bearer", true, `up == 1 sau ${up.ms} ms`);
    const series = await waitFor(
      "metric HTTP vào Prometheus",
      async () => {
        const r = await promQuery(promBase, "sum(http_server_request_duration_seconds_count)");
        const v = Number(r[0]?.value?.[1] ?? 0);
        return v >= 40 ? v : false;
      },
      30_000,
    );
    step(
      "metric HTTP của app vào TSDB",
      true,
      `sum(http_server_request_duration_seconds_count) = ${series.value}`,
    );
    const dead = await promQuery(promBase, "outbox_dead_total");
    step("gauge outbox_dead_total có mặt", dead.length === 1, `giá trị ${dead[0]?.value?.[1] ?? "vắng"}`);

    const rules = summarizeRules(await getJson(`${promBase}/api/v1/rules`));
    const real = rules.filter((r) => r.file === RULES);
    step(
      "rule thật nạp, health=ok",
      real.length === alertNames(rulesText).length && real.every((r) => r.health === "ok"),
      real.map((r) => `${r.name}:${r.health}`).join(", "),
    );
    const slo = sloQueries(readFileSync(path.join(ROOT, "docs/ops/SLO.md"), "utf8"));
    const sloBad = [];
    for (const q of slo) {
      const r = await fetch(`${promBase}/api/v1/query?query=${encodeURIComponent(q)}`);
      const b = await r.json().catch(() => ({}));
      if (!r.ok || b.status !== "success") sloBad.push(`${q} → ${b.error ?? r.status}`);
    }
    step(
      "truy vấn SLI trong docs/ops/SLO.md chạy được",
      slo.length >= 2 && sloBad.length === 0,
      sloBad.length === 0 ? `${slo.length} truy vấn status=success` : sloBad.join("; "),
    );
    const ams = await getJson(`${promBase}/api/v1/alertmanagers`);
    step(
      "Prometheus nối Alertmanager",
      (ams?.data?.activeAlertmanagers ?? []).length === 1,
      `${(ams?.data?.activeAlertmanagers ?? []).length} Alertmanager hoạt động`,
    );
    await sleep(3000);
    step(
      "nền khoẻ: không thông báo nào",
      payloads.length === 0,
      `${payloads.length} thông báo trong lúc app chạy bình thường`,
    );

    // Sự cố giả: dừng app.
    const stopAt = Date.now();
    app.stop();
    const fired = await waitFor(
      "firing tới webhook",
      async () => notificationsFor(payloads, DRILL_ALERT, "firing")[0] ?? false,
      60_000,
    );
    step("dừng app → firing tới webhook", true, `${DRILL_ALERT} sau ${fired.value.receivedAt - stopAt} ms`);

    // Phục hồi: bật lại app.
    app = await h.start(APP_PORT, { METRICS_TOKEN: token });
    const restartAt = Date.now();
    const resolved = await waitFor(
      "resolved tới webhook",
      async () => notificationsFor(payloads, DRILL_ALERT, "resolved")[0] ?? false,
      60_000,
    );
    step("bật lại app → resolved tới webhook", true, `sau ${resolved.value.receivedAt - restartAt} ms`);

    const firingReal = (await getJson(`${promBase}/api/v1/alerts`)).data.alerts.filter(
      (a) => a.labels.alertname !== DRILL_ALERT && a.state === "firing",
    );
    step(
      "rule SLO thật không bắn khi lưu lượng sạch",
      firingReal.length === 0,
      firingReal.length === 0 ? "0 cảnh báo" : firingReal.map((a) => a.labels.alertname).join(", "),
    );
    const invalid = payloads.filter((p) => p.invalid !== undefined).length;
    step("payload webhook đúng định dạng v4", invalid === 0, `${payloads.length} thông báo, ${invalid} hỏng`);
    app.stop();
  } catch (e) {
    step("end-to-end chạy hết", false, String(e?.message ?? e).slice(0, 1500));
  } finally {
    stopDaemons();
    hook.close();
    rmSync(work, { recursive: true, force: true });
  }

  const ok = checks.every((c) => c.ok) && steps.length > 0 && steps.every((s) => s.ok);
  const report = {
    label: "faithful-fixture",
    startedAt,
    commit: gitCommit(),
    environment: environmentInfo(),
    tools: versions,
    checks: checks.map(({ output, ...c }) => ({ ...c, output: output.split("\n").slice(-6).join("\n") })),
    steps,
    verdict: ok ? "PASS" : "FAIL",
    notProven: NOT_PROVEN,
  };
  const md = [
    "---",
    "title: Diễn tập Prometheus + Alertmanager cục bộ",
    `updated: ${startedAt.slice(0, 10)}`,
    "status: faithful-fixture — máy dev, KHÔNG phải hạ tầng giám sát production",
    "---",
    "",
    "# Diễn tập Prometheus + Alertmanager (T-054)",
    "",
    `Sinh bởi \`npm run -s ops:stack:drill\` lúc ${startedAt} trên commit \`${report.commit}\`. Kết luận: **${report.verdict}**.`,
    "",
    `Công cụ (ghim sha256, \`scripts/tools/install-tool.mjs\`): Prometheus/promtool ${versions.prometheus} · Alertmanager/amtool ${versions.alertmanager}. Node ${report.environment.node}, Next ${report.environment.next}, ${report.environment.os}.`,
    "",
    "## Kiểm tĩnh",
    "",
    "| Kiểm | Lệnh | Kết quả |",
    "| --- | --- | --- |",
    ...checks.map((c) => `| ${c.label} | \`${c.cmd}\` | ${c.ok ? "đạt" : "ĐỎ"} |`),
    "",
    "## End-to-end (app → Prometheus → Alertmanager → webhook)",
    "",
    "| Bước | Kết quả | Chi tiết |",
    "| --- | --- | --- |",
    ...steps.map(
      (s) => `| ${s.name} | ${s.ok ? "đạt" : "ĐỎ"} | ${s.detail.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`,
    ),
    "",
    "## Không chứng minh",
    "",
    ...NOT_PROVEN.map((n) => `- ${n}`),
    "",
  ].join("\n");
  writeFileSync(path.join(ROOT, "docs/ops/ops-stack-drill.md"), md);
  writeFileSync(path.join(ROOT, "docs/ops/ops-stack-drill.json"), `${JSON.stringify(report, null, 2)}\n`);
  formatFiles(["docs/ops/ops-stack-drill.md", "docs/ops/ops-stack-drill.json"]);
  if (!ok) {
    for (const c of checks.filter((x) => !x.ok)) err(`✗ ${c.label}:\n${c.output}`);
    err("ops:stack:drill ĐỎ — xem docs/ops/ops-stack-drill.md");
    process.exit(1);
  }
  out("ops:stack:drill: PASS — docs/ops/ops-stack-drill.md");
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    err(String(e?.stack ?? e));
    process.exit(1);
  });
}
