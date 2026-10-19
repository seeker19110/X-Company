// staging-drill.mjs — staging CÓ TLS chạy cục bộ (T-055, D-041; SEC-WEB-016, PRF-WEB-009). Gọi qua `npm run -s staging:drill`
// (bọc bởi scripts/with-test-db.sh). Bản build production (`next start`) sau Caddy 2 (`tls internal`, CA cục bộ tự sinh cho
// staging.localhost) — đúng hình dạng triển khai thật: reverse proxy chấm dứt TLS, app sau proxy (TRUST_PROXY_HOPS=1).
// Kiểm bằng client TLS XÁC MINH chứng chỉ (tin đúng CA gốc của Caddy, không tắt kiểm): bắt tay TLS 1.3, SAN đúng tên, từ chối
// tên lạ và TLS ≤ 1.1, http → https 308, header bảo mật + HSTS + cookie phiên `__Host-`/Secure qua https thật; rồi OWASP ZAP
// 2.17.0 (Java, không docker) quét baseline (spider + passive) qua https → scripts/zap-gate.mjs (đỏ khi còn Medium+).
// Kiểm cú pháp Caddyfile mẫu cho tên miền thật (ops/caddy/Caddyfile). Ghi docs/security/staging-tls-report.{md,json}.
// Nhãn bằng chứng: faithful-fixture — máy dev, CA nội bộ, KHÔNG phải staging/production thật với chứng chỉ ACME công khai.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { checkSecurityHeaders, checkSessionCookie } from "./lib/dast-probes.mjs";
import { environmentInfo, err, formatFiles, gitCommit, out, prepare } from "./lib/prod-harness.mjs";
import { TOOLS, installedPath } from "./tools/install-tool.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
export const HOST = "staging.localhost";
const APP_PORT = Number(process.env.STAGING_APP_PORT ?? 3500);
const SAMPLE_CADDYFILE = path.join(ROOT, "ops", "caddy", "Caddyfile");

const NOT_PROVEN = [
  "Chứng chỉ do CA nội bộ của Caddy cấp (`tls internal`), không phải ACME/Let's Encrypt công khai; trình duyệt người dùng thật không tin CA này. Tên miền thật + ACME: cấu hình mẫu ops/caddy/Caddyfile (chỉ kiểm cú pháp).",
  "Một máy dev: Caddy và app cùng máy qua 127.0.0.1; không có CDN/WAF/cân bằng tải, không đo độ trễ mạng thật.",
  "ZAP chỉ quét baseline (spider + passive, giới hạn thời gian); quét chủ động có ở job CI `dast` (http). Không phải pentest.",
  "ZAP (Java) không xác minh CA của Caddy khi quét — phần TLS được chứng minh bằng client Node có xác minh chứng chỉ, không bằng ZAP.",
  "TLS: kiểm phiên bản giao thức, chuỗi chứng chỉ, SAN; không chấm điểm bộ mã hoá kiểu SSL Labs, không kiểm OCSP stapling/CT.",
];

/** Caddyfile cho drill: CA nội bộ, không admin API, không cài CA vào hệ thống; http → https 308. */
export function renderDrillCaddyfile({ httpPort, httpsPort, appPort }) {
  return [
    "{",
    "\tadmin off",
    "\tlocal_certs",
    "\tskip_install_trust",
    `\thttp_port ${httpPort}`,
    `\thttps_port ${httpsPort}`,
    "}",
    "",
    `https://${HOST}:${httpsPort} {`,
    "\ttls internal",
    `\treverse_proxy 127.0.0.1:${appPort}`,
    "}",
    "",
    `http://${HOST}:${httpPort} {`,
    `\tredir https://${HOST}:${httpsPort}{uri} 308`,
    "}",
    "",
  ].join("\n");
}

/** Kế hoạch automation framework của ZAP tương đương zap-baseline.py: spider + chờ passive scan + báo cáo JSON truyền thống. */
export function renderZapPlan({ target, reportDir, spiderMinutes = 2 }) {
  return [
    "env:",
    "  contexts:",
    "    - name: staging",
    `      urls: [${JSON.stringify(target)}]`,
    `      includePaths: [${JSON.stringify(`${target}.*`)}]`,
    "  parameters:",
    "    failOnError: true",
    "    progressToStdout: true",
    "jobs:",
    "  - type: passiveScan-config",
    "    parameters:",
    "      maxAlertsPerRule: 100",
    "  - type: spider",
    "    parameters:",
    "      context: staging",
    `      maxDuration: ${spiderMinutes}`,
    "  - type: passiveScan-wait",
    "    parameters:",
    "      maxDuration: 5",
    "  - type: report",
    "    parameters:",
    "      template: traditional-json",
    `      reportDir: ${JSON.stringify(reportDir)}`,
    "      reportFile: baseline",
    "",
  ].join("\n");
}

/** SAN của chứng chỉ (chuỗi `DNS:a, IP Address:…` của node) có đúng tên host không. */
export function sanIncludes(subjectaltname, host) {
  return (subjectaltname ?? "")
    .split(",")
    .map((s) => s.trim())
    .some((s) => s === `DNS:${host}`);
}

/** Thông điệp lỗi OpenSSL có chứa TLS alert do máy chủ gửi (vd `tlsv1 alert protocol version`, `SSL alert number 70`). */
export const isServerAlert = (msg) => /\balert (?:number \d+|[a-z][a-z ]*)/i.test(String(msg));

/** Ô bảng markdown: escape `\` trước rồi `|`, gộp dòng. */
export const mdCell = (v) => String(v).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");

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

/**
 * Request HTTPS tới Caddy ở 127.0.0.1 với SNI/Host = staging.localhost; XÁC MINH chứng chỉ theo `ca` (không tắt kiểm).
 * Trả status/header/cookie + thông tin phiên TLS.
 */
function tlsRequest({
  port,
  ca,
  path: p = "/",
  method = "GET",
  headers = {},
  body = null,
  servername = HOST,
  tls = {},
}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: "127.0.0.1",
        port,
        servername,
        path: p,
        method,
        ca,
        rejectUnauthorized: true,
        headers: { host: `${HOST}:${port}`, ...headers },
        agent: false,
        timeout: 15_000,
        ...tls,
      },
      (res) => {
        const sock = res.socket;
        const info = {
          authorized: sock.authorized,
          protocol: sock.getProtocol(),
          cipher: sock.getCipher()?.name,
          san: sock.getPeerCertificate()?.subjectaltname,
          issuer: sock.getPeerCertificate()?.issuer?.CN,
        };
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (d) => (data += d));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            setCookie: res.headers["set-cookie"] ?? [],
            body: data,
            tls: info,
          }),
        );
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

function plainRequest(port, p) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: p, headers: { host: `${HOST}:${port}` }, agent: false },
      (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode, location: res.headers.location }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const procs = new Set();
function startDaemon(cmd, args, env, label) {
  const child = spawn(cmd, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  procs.add(child);
  let log = "";
  child.stdout.on("data", (d) => (log = (log + d).slice(-6000)));
  child.stderr.on("data", (d) => (log = (log + d).slice(-6000)));
  const done = new Promise((r) => child.once("exit", (code, sig) => r({ code, sig })));
  child.once("exit", () => procs.delete(child));
  return { label, child, done, log: () => log };
}
async function stopDaemonsAndWait(timeoutMs = 15_000) {
  const live = [...procs].filter((c) => c.exitCode === null && c.signalCode === null);
  const exited = live.map((c) => new Promise((r) => c.once("exit", r)));
  for (const c of live) c.kill("SIGTERM");
  const timer = sleep(timeoutMs).then(() => live.forEach((c) => c.kill("SIGKILL")));
  await Promise.race([Promise.all(exited), timer]);
  await Promise.all(exited);
}
process.on("exit", () => {
  for (const c of procs) c.kill("SIGKILL");
});

async function waitFor(desc, fn, timeoutMs, stepMs = 300) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(stepMs);
  }
  throw new Error(`hết ${timeoutMs} ms chờ: ${desc}${last instanceof Error ? ` (${last.message})` : ""}`);
}

async function main() {
  const startedAt = new Date().toISOString();
  const caddy = tool("caddy");
  const zap = tool("zap");
  const steps = [];
  const step = (group, name, ok, detail) => {
    steps.push({ group, name, ok, detail: String(detail) });
    out(`${ok ? "✓" : "✗"} [${group}] ${name} — ${detail}`);
  };
  const work = mkdtempSync(path.join(tmpdir(), "staging-"));
  const caddyEnv = {
    PATH: process.env.PATH,
    HOME: work,
    XDG_DATA_HOME: path.join(work, "data"),
    XDG_CONFIG_HOME: path.join(work, "config"),
  };
  let zapReport = null;
  let app = null;
  try {
    // Mẫu triển khai thật: cú pháp hợp lệ (biến môi trường giả lập tên miền/email).
    const v = spawnSync(caddy, ["validate", "--config", SAMPLE_CADDYFILE, "--adapter", "caddyfile"], {
      cwd: ROOT,
      env: {
        ...caddyEnv,
        SITE_DOMAIN: "app.example.com",
        ACME_EMAIL: "ops@example.com",
        APP_UPSTREAM: "127.0.0.1:3000",
      },
      encoding: "utf8",
    });
    step(
      "cấu hình",
      "Caddyfile mẫu cho tên miền thật hợp lệ",
      v.status === 0,
      v.status === 0 ? "caddy validate: OK" : (v.stderr || v.stdout).trim().slice(-300),
    );

    const [httpPort, httpsPort] = [await freePort(), await freePort()];
    const origin = `https://${HOST}:${httpsPort}`;
    const h = prepare({ prefix: "STAGING" });
    app = await h.start(APP_PORT, { TRUST_PROXY_HOPS: "1" }, origin);
    const caddyfile = path.join(work, "Caddyfile");
    writeFileSync(caddyfile, renderDrillCaddyfile({ httpPort, httpsPort, appPort: APP_PORT }));
    const cd = startDaemon(
      caddy,
      ["run", "--config", caddyfile, "--adapter", "caddyfile"],
      caddyEnv,
      "caddy",
    );
    const rootCrt = path.join(caddyEnv.XDG_DATA_HOME, "caddy", "pki", "authorities", "local", "root.crt");
    try {
      await waitFor("CA gốc của Caddy", async () => existsSync(rootCrt), 30_000);
    } catch (e) {
      throw new Error(`${e.message}\n[caddy] ${cd.log()}`);
    }
    const ca = readFileSync(rootCrt);
    const home = await waitFor(
      "https qua Caddy",
      async () =>
        (await tlsRequest({ port: httpsPort, ca })).status === 200 &&
        (await tlsRequest({ port: httpsPort, ca })),
      60_000,
    );

    // TLS
    step(
      "TLS",
      "chuỗi chứng chỉ hợp lệ với CA của Caddy, đúng tên",
      home.tls.authorized === true,
      `authorized=${home.tls.authorized}, issuer=${home.tls.issuer}`,
    );
    step(
      "TLS",
      "giao thức TLS 1.3",
      home.tls.protocol === "TLSv1.3",
      `${home.tls.protocol} · ${home.tls.cipher}`,
    );
    step(
      "TLS",
      "SAN chứa đúng tên staging",
      sanIncludes(home.tls.san, HOST),
      home.tls.san ?? "(không có SAN)",
    );
    // Từ chối phải đến từ MÁY CHỦ (TLS alert trong thông điệp OpenSSL), không phải client tự hỏng (EPROTO chung chung).
    const wrongName = await tlsRequest({ port: httpsPort, ca, servername: "khac.localhost" }).then(
      (r) => `chấp nhận: HTTP ${r.status}`,
      (e) => `từ chối: ${e.message}`,
    );
    step(
      "TLS",
      "tên lạ: máy chủ từ chối bằng TLS alert",
      wrongName.startsWith("từ chối") && isServerAlert(wrongName),
      wrongName,
    );
    const old = await tlsRequest({
      port: httpsPort,
      ca,
      tls: { minVersion: "TLSv1", maxVersion: "TLSv1.1", ciphers: "DEFAULT@SECLEVEL=0" },
    }).then(
      (r) => `chấp nhận (${r.tls.protocol})`,
      (e) => `từ chối: ${e.message}`,
    );
    step(
      "TLS",
      "máy chủ từ chối TLS ≤ 1.1 (alert protocol version)",
      old.startsWith("từ chối") && /alert protocol version/i.test(old),
      old,
    );
    const tls12 = await tlsRequest({ port: httpsPort, ca, tls: { maxVersion: "TLSv1.2" } }).then(
      (r) => `${r.tls.protocol} · ${r.tls.cipher}`,
      (e) => `lỗi: ${e.message}`,
    );
    step(
      "TLS",
      "TLS 1.2 (khách cũ) vẫn bắt tay với bộ mã ECDHE + AEAD",
      /^TLSv1\.2 · ECDHE-.*(GCM|CHACHA20)/.test(tls12),
      tls12,
    );

    // HTTP → HTTPS
    const redir = await plainRequest(httpPort, "/lien-he?x=1");
    step(
      "HTTP",
      "http chuyển hướng 308 sang https giữ nguyên đường dẫn",
      redir.status === 308 && redir.location === `${origin}/lien-he?x=1`,
      `${redir.status} → ${redir.location}`,
    );

    // Header + cookie qua https thật
    const hdrHtml = checkSecurityHeaders(home, { https: true, kind: "html" });
    step(
      "header",
      "trang HTML: CSP, HSTS ≥ 180 ngày, XFO, nosniff, Referrer-Policy…",
      hdrHtml.length === 0,
      hdrHtml.length === 0 ? `HSTS: ${home.headers["strict-transport-security"]}` : hdrHtml.join("; "),
    );
    const api = await tlsRequest({ port: httpsPort, ca, path: "/api/app/me" });
    const hdrApi = checkSecurityHeaders(api, { https: true, kind: "api" });
    step(
      "header",
      "API: nosniff, HSTS, JSON",
      api.status === 401 && hdrApi.length === 0,
      `HTTP ${api.status}${hdrApi.length === 0 ? "" : ` · ${hdrApi.join("; ")}`}`,
    );
    const seed = h.seed;
    const loginRes = await tlsRequest({
      port: httpsPort,
      ca,
      method: "POST",
      path: "/api/app/auth/login",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({
        email: seed.users.ed.email,
        password: seed.password,
      }),
    });
    const cookieErrs =
      loginRes.status === 200
        ? checkSessionCookie(loginRes.setCookie, { https: true })
        : [`đăng nhập HTTP ${loginRes.status}`];
    step(
      "cookie",
      "đăng nhập qua https: cookie phiên __Host-, Secure, HttpOnly, SameSite",
      cookieErrs.length === 0,
      cookieErrs.length === 0
        ? loginRes.setCookie.map((c) => c.split("=")[0]).join(", ")
        : cookieErrs.join("; "),
    );

    // ZAP baseline qua https
    const zapHome = path.join(work, "zap-home");
    const zapOut = path.join(work, "zap-out");
    mkdirSync(zapHome);
    mkdirSync(zapOut);
    const hosts = path.join(work, "hosts");
    writeFileSync(hosts, `127.0.0.1 ${HOST}\n`);
    const plan = path.join(work, "zap-plan.yaml");
    writeFileSync(plan, renderZapPlan({ target: origin, reportDir: zapOut }));
    const zapDir = path.dirname(zap);
    const jar = path.join(zapDir, `zap-${TOOLS.zap.version}.jar`);
    const zenv = { PATH: process.env.PATH, HOME: work };
    const z = startDaemon(
      "java",
      [
        `-Djdk.net.hosts.file=${hosts}`,
        "-Xmx1g",
        "-jar",
        jar,
        "-cmd",
        "-dir",
        zapHome,
        "-config",
        "start.checkForUpdates=false",
        "-autorun",
        plan,
      ],
      zenv,
      "zap",
    );
    const zr = await Promise.race([z.done, sleep(900_000).then(() => ({ code: "timeout" }))]);
    const reportPath = path.join(zapOut, "baseline.json");
    if (!existsSync(reportPath)) {
      step("ZAP", "ZAP baseline qua https sinh báo cáo", false, `exit ${zr.code}; ${z.log().slice(-600)}`);
    } else {
      zapReport = JSON.parse(readFileSync(reportPath, "utf8"));
      const sites = (zapReport.site ?? []).map((s) => s["@name"]);
      const alerts = (zapReport.site ?? []).flatMap((s) => s.alerts ?? []);
      step(
        "ZAP",
        "ZAP 2.17.0 quét baseline qua https (spider + passive)",
        sites.includes(origin) && zr.code === 0,
        `site: ${sites.join(", ")} · ${alerts.length} loại cảnh báo · exit ${zr.code}`,
      );
      const gate = spawnSync(process.execPath, [path.join(ROOT, "scripts/zap-gate.mjs"), reportPath], {
        cwd: ROOT,
        encoding: "utf8",
      });
      step(
        "ZAP",
        "zap-gate: không còn cảnh báo Medium+ ngoài allowlist",
        gate.status === 0,
        (gate.stdout + gate.stderr).trim().split("\n").slice(-3).join(" "),
      );
      mkdirSync(path.join(ROOT, "docs/security"), { recursive: true });
      writeFileSync(
        path.join(ROOT, "docs/security/staging-zap-baseline.json"),
        `${JSON.stringify(zapReport, null, 2)}\n`,
      );
    }
  } catch (e) {
    step("drill", "chạy hết", false, String(e?.message ?? e).slice(0, 1500));
  } finally {
    app?.stop();
    await stopDaemonsAndWait();
    rmSync(work, { recursive: true, force: true, maxRetries: 3 });
  }

  const ok = steps.length > 0 && steps.every((s) => s.ok);
  const report = {
    label: "faithful-fixture",
    startedAt,
    commit: gitCommit(),
    environment: environmentInfo(),
    tools: { caddy: TOOLS.caddy.version, zap: TOOLS.zap.version },
    host: HOST,
    steps,
    verdict: ok ? "PASS" : "FAIL",
    notProven: NOT_PROVEN,
  };
  const md = [
    "---",
    "title: Staging có TLS cục bộ (Caddy + ZAP)",
    `updated: ${startedAt.slice(0, 10)}`,
    "status: faithful-fixture — máy dev, CA nội bộ của Caddy; KHÔNG phải staging/production thật",
    "---",
    "",
    "# Staging có TLS cục bộ (T-055)",
    "",
    `Sinh bởi \`npm run -s staging:drill\` lúc ${startedAt} trên commit \`${report.commit}\`. Kết luận: **${report.verdict}**.`,
    "",
    `Caddy ${report.tools.caddy} (\`tls internal\`) chấm dứt TLS cho \`https://${HOST}\` → \`next start\` (TRUST_PROXY_HOPS=1); OWASP ZAP ${report.tools.zap} quét qua https. Công cụ ghim hash ở \`scripts/tools/install-tool.mjs\`. Node ${report.environment.node}, Next ${report.environment.next}.`,
    "",
    "| Nhóm | Kiểm | Kết quả | Chi tiết |",
    "| --- | --- | --- | --- |",
    ...steps.map((s) => `| ${s.group} | ${mdCell(s.name)} | ${s.ok ? "đạt" : "ĐỎ"} | ${mdCell(s.detail)} |`),
    "",
    "Báo cáo ZAP đầy đủ: [staging-zap-baseline.json](staging-zap-baseline.json).",
    "",
    "## Không chứng minh",
    "",
    ...NOT_PROVEN.map((n) => `- ${n}`),
    "",
  ].join("\n");
  writeFileSync(path.join(ROOT, "docs/security/staging-tls-report.md"), md);
  writeFileSync(
    path.join(ROOT, "docs/security/staging-tls-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  const files = ["docs/security/staging-tls-report.md", "docs/security/staging-tls-report.json"];
  if (zapReport !== null) files.push("docs/security/staging-zap-baseline.json");
  formatFiles(files);
  if (!ok) {
    err("staging:drill ĐỎ — xem docs/security/staging-tls-report.md");
    process.exit(1);
  }
  out("staging:drill: PASS — docs/security/staging-tls-report.md");
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    err(String(e?.stack ?? e));
    process.exit(1);
  });
}
