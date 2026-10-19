// dast-baseline.mjs — DAST cục bộ không cần docker (T-047, SEC-WEB-004): bộ probe tự viết tấn công THẬT bản build production
// (`next start`) + Postgres tạm + dữ liệu seed. Gọi qua `npm run -s dast:probes` (bọc bởi scripts/with-test-db.sh).
// Ghi docs/security/dast-report.md + docs/security/dast-report.json (sinh lại được); exit 1 khi có nhóm FAIL.
// Nhãn bằng chứng: faithful-fixture — máy dev, KHÔNG phải production/staging/thực địa.
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { makeAgent, login, request, writeHeaders } from "./lib/http-client.mjs";
import {
  analyzeHtmlForXss,
  checkCookieCleared,
  checkCors,
  checkCsrfRejected,
  checkDenied,
  checkIdempotency,
  checkNonceUse,
  checkNotServed,
  checkProblem,
  checkRateLimited,
  checkRedirectTarget,
  checkSecurityHeaders,
  checkSessionCookie,
  checkSourceMapNotPublic,
  evidenceLine,
  groupResult,
  leakFindings,
  parseSetCookie,
  renderReport,
  clip,
} from "./lib/dast-probes.mjs";
import { environmentInfo, err, formatFiles, gitCommit, out, prepare } from "./lib/prod-harness.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = Number(process.env.DAST_PORT ?? 3200);
const EVIL = "https://evil.test";

const NOT_PROVEN = [
  "Không phải ZAP/Burp: không có spider đầy đủ, không có active-scan theo chữ ký CVE; chỉ các nhóm probe liệt kê ở trên.",
  "Không có TLS thật: HSTS/Secure/`__Host-` kiểm trên instance chạy `APP_ORIGIN=https://…` (mô phỏng proxy chấm dứt TLS); cấu hình TLS, chứng chỉ, cipher, header của reverse proxy/CDN thật chưa được kiểm.",
  "Không chạy trên staging/production, không có WAF/CDN/proxy thật; X-Forwarded-For do probe tự đặt (`TRUST_PROXY_HOPS=1`).",
  "XSS: payload là tập hữu hạn (HTML thô, scheme nguy hiểm, SVG, template, markdown độc, tên tệp) trên các đầu vào hiện có; không chứng minh không còn biến thể nào. DOM kiểm bằng Chromium của Playwright, không phải mọi trình duyệt.",
  "BOLA/BFLA chỉ giữa các người dùng seed (hai nhân viên cùng công ty; vai trò khác nhau); không kiểm đa-tenant giữa hai công ty ở tầng HTTP (đã có test authz/RLS trong tests/).",
  "Không kiểm: DoS/tải lớn (xem perf:load), phụ thuộc có lỗ hổng (npm audit/OSV), cấu hình hạ tầng/IaC, bí mật trong lịch sử git (gitleaks), SSRF (chưa có tính năng gọi URL do người dùng cung cấp).",
];

let requestTotal = 0;
/** Mọi phản hồi (rút gọn) để quét rò thông tin ở cuối. */
const observed = [];
let ipCounter = 0;
const nextIp = () =>
  `10.${Math.floor(ipCounter / 250) % 250}.${(ipCounter += 1) % 250}.${1 + (ipCounter % 200)}`;

async function main() {
  const h = prepare({ prefix: "DAST", extraSeeds: ["scripts/seed-dast.ts"] });
  const metricsToken = randomBytes(24).toString("hex");
  const plain = await h.start(PORT, { TRUST_PROXY_HOPS: "1", METRICS_TOKEN: metricsToken });
  const secure = await h.start(PORT + 1, { TRUST_PROXY_HOPS: "1" }, `https://localhost:${PORT + 1}`);
  let browser = null;
  try {
    const seed = h.seed;
    const U = (k) => seed.users[k];
    const agent = makeAgent(16);
    /** Gửi request và ghi nhận. `inst`: instance đích. Mặc định mỗi request một IP giả riêng. */
    const req = async (inst, o) => {
      requestTotal += 1;
      const headers = { "x-forwarded-for": nextIp(), ...(o.headers ?? {}) };
      const r = await request(inst.baseUrl, { ...o, headers, agent });
      observed.push({
        path: o.path,
        method: o.method ?? "GET",
        status: r.status,
        ct: r.headers["content-type"] ?? "",
        body: r.body.slice(0, 20_000),
      });
      return r;
    };
    const P = (o) => req(plain, o);
    const S = (o) => req(secure, o);
    const loginAs = async (inst, key) => {
      requestTotal += 1;
      return login(inst.baseUrl, inst.origin, U(key).email, seed.password, { "x-forwarded-for": nextIp() });
    };
    const sessions = {};
    for (const k of ["nv", "nv2", "tl", "sales", "hr", "exec"]) sessions[k] = await loginAs(plain, k);
    const sessS = await loginAs(secure, "nv");

    const ctx = { P, S, plain, secure, seed, U, sessions, sessS, metricsToken };
    const groups = [];
    const run = async (fn) => {
      try {
        groups.push(await fn(ctx));
      } catch (e) {
        groups.push(
          groupResult(fn.gid, fn.gtitle, fn.grefs, [
            {
              name: "probe chạy được",
              ok: false,
              errors: [String(e?.stack ?? e).slice(0, 600)],
              evidence: "ngoại lệ trong probe",
            },
          ]),
        );
      }
    };
    try {
      const { chromium } = await import("@playwright/test");
      const exe = process.env.PW_CHROMIUM_PATH === "" ? undefined : process.env.PW_CHROMIUM_PATH;
      browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
      ctx.browser = browser;
    } catch (e) {
      ctx.browserError = String(e?.message ?? e).split("\n")[0];
    }
    ctx.browserVersion = browser
      ? `Chromium ${browser.version()} (Playwright, headless)`
      : `không khởi động được: ${ctx.browserError}`;

    for (const g of [
      groupHeaders,
      groupCookies,
      groupXss,
      groupCsrf,
      groupRedirect,
      groupErrors,
      groupPaths,
      groupBola,
      groupRates,
    ])
      await run(g);

    // Quét rò thông tin trên mọi phản hồi lỗi/JSON của cả phiên (gắn vào nhóm F).
    const sweepErrs = [];
    let swept = 0;
    for (const o of observed) {
      if (o.status < 400 && !/json/i.test(o.ct)) continue;
      swept += 1;
      for (const l of leakFindings(stripEcho(o.body, o.path)))
        sweepErrs.push(`${o.method} ${clip(o.path, 60)} (${o.status}): ${l}`);
    }
    const fg = groups.find((g) => g.id === "DAST-F");
    if (fg) {
      fg.checks.push({
        name: "quét toàn phiên: mọi phản hồi lỗi/JSON không lộ stack/SQL/đường dẫn",
        ok: sweepErrs.length === 0,
        errors: [...new Set(sweepErrs)].slice(0, 8),
        evidence: `${swept} phản hồi (4xx/5xx/JSON) trong ${requestTotal} request của cả phiên quét, không khớp mẫu rò`,
      });
      fg.status = fg.checks.every((c) => c.ok) ? "PASS" : "FAIL";
    }

    const meta = {
      date: new Date().toISOString().slice(0, 10),
      commit: gitCommit(),
      env: environmentInfo(),
      port: PORT,
      browser: ctx.browserVersion,
      checkTotal: groups.reduce((n, g) => n + g.checks.length, 0),
      requestTotal,
      notProven: NOT_PROVEN,
    };
    mkdirSync(path.join(ROOT, "docs/security"), { recursive: true });
    writeFileSync(path.join(ROOT, "docs/security/dast-report.md"), renderReport(meta, groups));
    writeFileSync(
      path.join(ROOT, "docs/security/dast-report.json"),
      `${JSON.stringify({ label: "faithful-fixture", ...meta, groups }, null, 2)}\n`,
    );
    formatFiles(["docs/security/dast-report.md", "docs/security/dast-report.json"]);
    for (const g of groups) {
      out(`${g.status}  ${g.id}  ${g.title}  (${g.checks.filter((c) => c.ok).length}/${g.checks.length})`);
      for (const c of g.checks.filter((c) => !c.ok)) out(`    ✗ ${c.name}: ${c.errors.join("; ")}`);
    }
    const failed = groups.filter((g) => g.status === "FAIL").length;
    out(
      `DAST: ${groups.length - failed}/${groups.length} nhóm PASS · ${meta.checkTotal} kiểm tra · ${requestTotal} request · báo cáo docs/security/dast-report.md`,
    );
    return failed === 0 ? 0 : 1;
  } finally {
    if (browser) await browser.close().catch((e) => err(`đóng trình duyệt: ${e?.message ?? e}`));
    plain.stop();
    secure.stop();
  }
}

// ---------------------------------------------------------------- tiện ích nhóm
/** Bỏ đoạn đường dẫn yêu cầu mà trang 404 phản chiếu lại (không phải rò rỉ nội bộ) trước khi quét. */
const stripEcho = (body, p) => {
  let dec = p;
  try {
    dec = decodeURIComponent(p);
  } catch {
    /* giữ nguyên */
  }
  let b = body;
  // Trang 404 của Next phản chiếu đường dẫn ở nhiều dạng: `/a/b`, `a/b` (khoá param) và từng đoạn (mảng `c`).
  for (const full of new Set([p, p.split("?")[0], dec, dec.split("?")[0]])) {
    for (const v of new Set([full, full.replace(/^\//, "")])) if (v.length > 1) b = b.split(v).join("");
    for (const seg of full.split("?")[0].split("/")) if (seg.length > 1) b = b.split(seg).join("");
  }
  return b;
};
const chk = (name, errors, evidence) => ({ name, ok: errors.length === 0, errors, evidence });
const tag = (fn, gid, gtitle, grefs) => Object.assign(fn, { gid, gtitle, grefs });
const json = (r) => {
  try {
    return JSON.parse(r.body);
  } catch {
    return null;
  }
};
const SEC_HDRS = [
  "content-security-policy",
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
  "strict-transport-security",
];
/** Ngày nghiệp vụ n ngày trước (UTC) — tránh ngày hôm nay có ca 23h50 làm OT vượt trần ngày. */
const otDate = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const mk = (n) => `MK-R${n}`;
const XSS = [
  `"><img data-mk="${mk(1)}" src=x onerror="window.__dastHit='${mk(1)}'">`,
  `<script data-mk="${mk(2)}">window.__dastHit='${mk(2)}'</script>`,
  `javascript:window.__dastHit='${mk(3)}'`,
  `<svg data-mk="${mk(4)}" onload="window.__dastHit='${mk(4)}'"></svg>`,
  `'-window.__dastHit='${mk(5)}'-'`,
  `{{constructor.constructor("window.__dastHit='${mk(6)}'")()}}`,
  `[x](javascript:window.__dastHit='${mk(7)}')`,
  `</title><script data-mk="${mk(8)}">window.__dastHit='${mk(8)}'</script>`,
  `<math data-mk="${mk(9)}"><mtext><table><mglyph><style><img src=x onerror=window.__dastHit='${mk(9)}'>`,
  `\u202e<img data-mk="${mk(10)}" src=x onerror="window.__dastHit='${mk(10)}'">`,
];
const XSS_MARKERS = XSS.map((_, i) => mk(i + 1));
const SEED_MARKERS = [
  "MK-MD",
  "MK-TITLE",
  "MK-SUM",
  "MK-SEO",
  "MK-CAN",
  "MK-PRJ",
  "MK-TASK",
  "MK-AC",
  "MK-STORED",
];

// ---------------------------------------------------------------- A. header
const groupHeaders = tag(
  async ({ P, S, sessions, sessS }) => {
    const checks = [];
    const pages = [
      "/",
      "/dich-vu",
      "/lien-he",
      "/gioi-thieu",
      "/tin-tuc",
      "/dich-vu/tu-van-thiet-ke",
      "/dich-vu/dast-markdown-doc",
      "/chinh-sach-du-lieu",
      "/khong-co-trang-nay",
      "/app/login",
    ];
    const nonces = new Set();
    for (const p of pages) {
      const r = await P({ path: p });
      const errs = checkSecurityHeaders(r, { https: false, kind: "html" });
      if (r.status === 200 || r.status === 404)
        errs.push(...checkNonceUse(r.body, r.headers["content-security-policy"]));
      const m = /nonce-([A-Za-z0-9+/=_-]+)/.exec(r.headers["content-security-policy"] ?? "");
      if (m) nonces.add(m[1]);
      checks.push(chk(`HTML ${p}`, errs, evidenceLine(`GET ${p}`, r, SEC_HDRS)));
    }
    checks.push(
      chk(
        "nonce CSP đổi mỗi request",
        nonces.size === pages.length ? [] : [`${nonces.size} nonce khác nhau cho ${pages.length} request`],
        `${nonces.size}/${pages.length} nonce khác nhau`,
      ),
    );
    for (const p of [
      "/app/today",
      "/app/tasks",
      "/app/attendance",
      "/app/approvals",
      "/app/dashboard",
      "/app/me",
    ]) {
      const r = await P({ path: p, headers: { cookie: sessions.tl.cookie } });
      const errs = checkSecurityHeaders(r, { https: false, kind: "html" });
      if (r.status !== 200) errs.push(`status ${r.status} khi đã đăng nhập`);
      if ((r.headers["cache-control"] ?? "") !== "private, no-store")
        errs.push(
          `khu nội bộ phải Cache-Control: private, no-store, thấy "${r.headers["cache-control"] ?? ""}"`,
        );
      checks.push(
        chk(
          `HTML nội bộ ${p}`,
          errs,
          evidenceLine(`GET ${p} (đã đăng nhập)`, r, [...SEC_HDRS, "cache-control"]),
        ),
      );
    }
    const redirect = await P({ path: "/app/today" });
    checks.push(
      chk(
        "redirect chưa đăng nhập vẫn không cache",
        (redirect.headers["cache-control"] ?? "") === "private, no-store"
          ? []
          : ["thiếu private, no-store trên redirect"],
        evidenceLine("GET /app/today (không phiên)", redirect, ["location", "cache-control"]),
      ),
    );
    for (const p of ["/api/healthz", "/api/readyz", "/api/app/me", "/api/app/tasks"]) {
      const r = await P({ path: p, headers: { cookie: sessions.nv.cookie } });
      checks.push(
        chk(
          `API ${p}`,
          checkSecurityHeaders(r, { https: false, kind: "api" }),
          evidenceLine(`GET ${p}`, r, ["content-type", "x-content-type-options", "cache-control"]),
        ),
      );
    }
    const s1 = await S({ path: "/" });
    checks.push(
      chk(
        "HTTPS: / có HSTS + CSP + còn lại",
        checkSecurityHeaders(s1, { https: true, kind: "html" }),
        evidenceLine("GET / (APP_ORIGIN https)", s1, SEC_HDRS),
      ),
    );
    const s2 = await S({ path: "/app/login" });
    checks.push(
      chk(
        "HTTPS: /app/login có HSTS",
        checkSecurityHeaders(s2, { https: true, kind: "html" }),
        evidenceLine("GET /app/login (APP_ORIGIN https)", s2, SEC_HDRS),
      ),
    );
    const s3 = await S({ path: "/api/app/me", headers: { cookie: sessS.cookie } });
    checks.push(
      chk(
        "HTTPS: API có HSTS",
        checkSecurityHeaders(s3, { https: true, kind: "api" }),
        evidenceLine("GET /api/app/me (APP_ORIGIN https)", s3, [
          "strict-transport-security",
          "x-content-type-options",
        ]),
      ),
    );
    const tr = await P({ method: "TRACE", path: "/" });
    checks.push(
      chk(
        "TRACE bị từ chối",
        [200].includes(tr.status) || tr.body.toLowerCase().includes("trace /")
          ? ["TRACE được phản hồi 200/echo"]
          : [],
        evidenceLine("TRACE /", tr),
      ),
    );
    return groupResult(groupHeaders.gid, groupHeaders.gtitle, groupHeaders.grefs, checks);
  },
  "DAST-A",
  "Header bảo mật mọi trang/route chính",
  ["PRF-WEB-007", "SEC-WEB-006", "SEC-WEB-014"],
);

// ---------------------------------------------------------------- B. cookie phiên
const groupCookies = tag(
  async ({ P, plain, seed, U, sessions, sessS }) => {
    const checks = [];
    checks.push(
      chk(
        "HTTP: cookie phiên HttpOnly + SameSite + Path + hạn",
        checkSessionCookie(sessions.nv.setCookie, { https: false }),
        `Set-Cookie: ${clip(sessions.nv.setCookie[0] ?? "", 160)}`,
      ),
    );
    checks.push(
      chk(
        "HTTPS: cookie phiên Secure + __Host- + HttpOnly + SameSite",
        checkSessionCookie(sessS.setCookie, { https: true }),
        `Set-Cookie: ${clip(sessS.setCookie[0] ?? "", 160)}`,
      ),
    );
    const cookieValue = sessions.nv.cookie.split("=")[1] ?? "";
    checks.push(
      chk(
        "CSRF token không trùng giá trị cookie phiên (không lộ phiên cho script)",
        sessions.nv.csrf !== cookieValue && !sessions.nv.csrf.includes(cookieValue)
          ? []
          : ["csrf_token chứa/bằng token phiên"],
        "csrf_token ≠ cookie phiên",
      ),
    );
    const bad = await P({
      method: "POST",
      path: "/api/app/auth/login",
      headers: { "content-type": "application/json", origin: plain.origin },
      body: JSON.stringify({ email: U("nv").email, password: "sai-mat-khau-dast" }),
    });
    const unknown = await P({
      method: "POST",
      path: "/api/app/auth/login",
      headers: { "content-type": "application/json", origin: plain.origin },
      body: JSON.stringify({ email: "khong-ton-tai@e2e.test", password: "sai-mat-khau-dast" }),
    });
    const e1 = [];
    if (bad.setCookie.length > 0 || unknown.setCookie.length > 0)
      e1.push("đăng nhập thất bại vẫn đặt cookie");
    if (bad.status !== 401 || unknown.status !== 401)
      e1.push(`status ${bad.status}/${unknown.status} (cần 401)`);
    if ((json(bad)?.detail ?? "a") !== (json(unknown)?.detail ?? "b"))
      e1.push("thông điệp khác nhau giữa sai mật khẩu và email không tồn tại (lộ tài khoản)");
    checks.push(
      chk(
        "đăng nhập sai: không cookie, cùng thông điệp cho email lạ và sai mật khẩu",
        e1,
        evidenceLine("POST /api/app/auth/login (sai)", bad),
      ),
    );
    // Session fixation: cookie do kẻ tấn công chọn sẵn không được dùng lại.
    const fixed = "a".repeat(64);
    const lr = await P({
      method: "POST",
      path: "/api/app/auth/login",
      headers: { "content-type": "application/json", origin: plain.origin, cookie: `xc_session=${fixed}` },
      body: JSON.stringify({ email: U("ed").email, password: seed.password }),
    });
    const newTok = parseSetCookie(lr.setCookie[0] ?? "x=").value;
    checks.push(
      chk(
        "fixation: token phiên mới do server cấp, khác cookie đã gài",
        lr.status === 200 && newTok !== fixed && newTok.length >= 32
          ? []
          : [`status ${lr.status}, token ${newTok === fixed ? "bị giữ nguyên" : "ngắn"}`],
        `POST login kèm cookie gài sẵn → ${lr.status}`,
      ),
    );
    const again = await P({
      method: "POST",
      path: "/api/app/auth/login",
      headers: { "content-type": "application/json", origin: plain.origin },
      body: JSON.stringify({ email: U("ed").email, password: seed.password }),
    });
    checks.push(
      chk(
        "mỗi lần đăng nhập một token phiên mới",
        parseSetCookie(again.setCookie[0] ?? "x=").value !== newTok ? [] : ["hai lần đăng nhập cùng token"],
        "2 đăng nhập liên tiếp → 2 token khác nhau",
      ),
    );
    const tampered = `${sessions.nv.cookie.slice(0, -1)}${sessions.nv.cookie.endsWith("A") ? "B" : "A"}`;
    const tr = await P({ path: "/api/app/me", headers: { cookie: tampered } });
    checks.push(
      chk(
        "cookie bị sửa 1 ký tự → 401",
        tr.status === 401 ? [] : [`status ${tr.status}`],
        evidenceLine("GET /api/app/me (cookie sửa)", tr),
      ),
    );
    const mal = await P({ path: "/api/app/me", headers: { cookie: "xc_session=%E0%A4%A" } });
    checks.push(
      chk(
        "cookie mã hoá sai → 401 (không 500)",
        mal.status === 401 ? [] : [`status ${mal.status}`],
        evidenceLine("GET /api/app/me (cookie %E0%A4%A)", mal),
      ),
    );
    // Đăng xuất: xoá cookie + vô hiệu token cũ phía server.
    const s = await login(plain.baseUrl, plain.origin, U("ed2").email, seed.password, {
      "x-forwarded-for": "10.250.0.9",
    });
    const lo = await P({
      method: "POST",
      path: "/api/app/auth/logout",
      headers: writeHeaders(s, plain.origin),
      body: "{}",
    });
    const e2 = checkCookieCleared(lo.setCookie);
    if (lo.status !== 200) e2.push(`logout status ${lo.status}`);
    if (!/storage/.test(lo.headers["clear-site-data"] ?? "")) e2.push("thiếu Clear-Site-Data khi đăng xuất");
    checks.push(
      chk(
        "đăng xuất xoá cookie + Clear-Site-Data",
        e2,
        evidenceLine("POST /api/app/auth/logout", lo, ["clear-site-data"]) +
          ` set-cookie: ${clip(lo.setCookie[0] ?? "", 90)}`,
      ),
    );
    const old = await P({ path: "/api/app/me", headers: { cookie: s.cookie } });
    checks.push(
      chk(
        "token cũ bị từ chối sau đăng xuất (phiên bị huỷ ở server)",
        old.status === 401 ? [] : [`token cũ vẫn dùng được (status ${old.status})`],
        evidenceLine("GET /api/app/me (token đã đăng xuất)", old),
      ),
    );
    return groupResult(groupCookies.gid, groupCookies.gtitle, groupCookies.grefs, checks);
  },
  "DAST-B",
  "Cookie phiên (HttpOnly/SameSite/Secure/__Host-/vòng đời)",
  ["SEC-WEB-023", "SEC-WEB-007", "ASVS V7"],
);

// ---------------------------------------------------------------- C. XSS
function multipart(fields, file) {
  const b = `----dast${randomBytes(8).toString("hex")}`;
  const parts = [];
  for (const [k, v] of Object.entries(fields))
    parts.push(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`);
  parts.push(
    `--${b}\r\nContent-Disposition: form-data; name="file"; filename="${file.name.replace(/"/g, "%22")}"\r\nContent-Type: ${file.type}\r\n\r\n`,
  );
  return {
    type: `multipart/form-data; boundary=${b}`,
    body: Buffer.concat([Buffer.from(parts.join("")), file.data, Buffer.from(`\r\n--${b}--\r\n`)]),
  };
}
export const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

async function domProbe(ctx, { url, cookieHeader, markers, clickSelector }) {
  const { browser, plain } = ctx;
  const hits = [];
  const dialogs = [];
  const bctx = await browser.newContext({
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    viewport: { width: 1280, height: 900 },
  });
  try {
    if (cookieHeader !== undefined) {
      const [name, ...v] = cookieHeader.split("=");
      await bctx.addCookies([
        { name, value: v.join("="), url: plain.baseUrl, httpOnly: true, sameSite: "Lax" },
      ]);
    }
    await bctx.exposeFunction("__dastReport", (v) => hits.push(String(v)));
    await bctx.addInitScript(() => {
      Object.defineProperty(window, "__dastHit", {
        configurable: false,
        get: () => undefined,
        set: (v) => window.__dastReport(String(v)),
      });
    });
    await bctx.route("**/*", (route) =>
      new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
    );
    const load = async () => {
      const page = await bctx.newPage();
      page.on("dialog", (d) => {
        dialogs.push(`${d.type()}: ${d.message().slice(0, 60)}`);
        d.dismiss().catch((e) => err(`dialog: ${e.message}`));
      });
      page.on("popup", () => dialogs.push("popup"));
      const resp = await page.goto(`${plain.baseUrl}${url}`, { waitUntil: "networkidle", timeout: 30_000 });
      return { page, resp };
    };
    const { page, resp } = await load();
    const html = await page.content();
    const dom = await page.evaluate(() => ({
      title: document.title,
      hasMk: document.querySelectorAll("[data-mk]").length,
      inline: document.querySelectorAll("[onclick],[onerror],[onload],[onmouseover]").length,
    }));
    const anchors = await page.$$eval(clickSelector ?? "main a, article a", (as) =>
      as.slice(0, 20).map((a) => a.getAttribute("href") ?? ""),
    );
    await page.close();
    for (let i = 0; i < anchors.length; i++) {
      const { page: p2 } = await load();
      const els = await p2.$$(clickSelector ?? "main a, article a");
      try {
        await els[i]?.evaluate((el) => el.click());
        await p2.waitForTimeout(80);
      } catch (e) {
        if (!/context was destroyed|navigat|Target closed/i.test(String(e))) throw e;
      }
      await p2.close();
    }
    return { status: resp?.status() ?? 0, html, dom, hits, dialogs, anchors, markers };
  } finally {
    await bctx.close();
  }
}

const groupXss = tag(
  async (ctx) => {
    const { P, plain, sessions } = ctx;
    const checks = [];
    // 1. Phản chiếu qua query/path (HTTP + phân tích HTML).
    const enc = encodeURIComponent;
    const targets = [
      (e) => `/lien-he?service=${e}&source=${e}&q=${e}`,
      (e) => `/?q=${e}&utm_source=${e}`,
      (e) => `/app/login?next=${e}&error=${e}&email=${e}`,
      (e) => `/tim-kiem?q=${e}`,
      (e) => `/dich-vu/${e}`,
      (e) => `/${e}`,
    ];
    for (const t of targets) {
      const errs = [];
      let first = "";
      for (const p of XSS) {
        const path = t(enc(p));
        const r = await P({ path });
        if (first === "") first = evidenceLine(`GET ${clip(t("<payload>"), 60)}`, r);
        if (r.status >= 500) errs.push(`5xx với payload ${p.slice(0, 30)}`);
        errs.push(
          ...analyzeHtmlForXss(r.body, { markers: XSS_MARKERS }).map((x) => `${p.slice(0, 24)}…: ${x}`),
        );
      }
      checks.push(
        chk(
          `phản chiếu ${t("{payload}")} × ${XSS.length} payload`,
          errs.slice(0, 6),
          `${first}; ${XSS.length} payload (script, img/onerror, javascript:, svg, template, markdown, </title>, mXSS, RLO) — HTML không có phần tử/thuộc tính bị chèn`,
        ),
      );
    }
    const reflApi = [];
    for (const p of XSS) {
      const r = await P({ path: `/api/app/tasks?limit=${enc(p)}`, headers: { cookie: sessions.nv.cookie } });
      if (!/json/i.test(r.headers["content-type"] ?? ""))
        reflApi.push(
          `${r.status} Content-Type ${r.headers["content-type"] ?? ""} (payload phản chiếu trong phản hồi không phải JSON)`,
        );
    }
    checks.push(
      chk(
        "phản chiếu trong lỗi API chỉ ở dạng JSON (không HTML)",
        reflApi.slice(0, 3),
        `GET /api/app/tasks?limit=<payload> × ${XSS.length} → application/problem+json`,
      ),
    );

    // 2. Lưu: markdown CMS + tiêu đề/tóm tắt/SEO do biên tập viên nhập (seed-dast.ts), đọc lại trang công khai.
    const cms = await P({ path: "/dich-vu/dast-markdown-doc" });
    const pre = [];
    if (cms.status !== 200) pre.push(`trang độc không render được (status ${cms.status})`);
    if (!cms.body.includes("Đoạn mở đầu bình thường.")) pre.push("thân trang không có đoạn văn lành");
    if (!/MK-MD1/.test(cms.body))
      pre.push(
        "payload không xuất hiện ở dạng văn bản đã escape — tiền điều kiện của probe không thoả (bị loại bỏ thay vì escape?)",
      );
    checks.push(
      chk(
        "tiền điều kiện: trang CMS độc đã xuất bản và có nội dung render",
        pre,
        evidenceLine("GET /dich-vu/dast-markdown-doc", cms) + ` — thân ${cms.body.length} B`,
      ),
    );
    const cmsErrs = analyzeHtmlForXss(cms.body, { markers: SEED_MARKERS });
    checks.push(
      chk(
        "CMS markdown độc (script/img/svg/iframe/javascript:/data:/entity/tab/autolink/bảng/code) + tiêu đề/tóm tắt/SEO/canonical",
        cmsErrs,
        "GET /dich-vu/dast-markdown-doc → HTML không chứa phần tử/thuộc tính/URL nguy hiểm",
      ),
    );
    const list = await P({ path: "/dich-vu" });
    checks.push(
      chk(
        "danh sách /dich-vu (tiêu đề + tóm tắt độc)",
        analyzeHtmlForXss(list.body, { markers: SEED_MARKERS }),
        evidenceLine("GET /dich-vu", list),
      ),
    );
    const sm = await P({ path: "/sitemap.xml" });
    checks.push(
      chk(
        "sitemap.xml an toàn (XML, không HTML chèn)",
        /<script|<img|onerror/i.test(sm.body) ? ["sitemap chứa thẻ HTML thô"] : [],
        evidenceLine("GET /sitemap.xml", sm, ["content-type"]),
      ),
    );

    // 3. Lưu qua đầu vào công khai → đọc lại ở API nội bộ.
    const stored = [];
    const subs = [];
    for (let i = 0; i < XSS.length; i++) {
      const p = XSS[i];
      const sid = randomUUID();
      subs.push(sid);
      const r = await P({
        method: "POST",
        path: "/api/public/inquiries",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          submission_id: sid,
          name: p,
          email: "khach@dast.test",
          message: p,
          source: p,
          consent: true,
          elapsed_ms: 6000,
        }),
      });
      if (![200, 201].includes(r.status))
        stored.push(`inquiry payload #${i + 1}: status ${r.status} ${clip(r.body, 80)}`);
      const a = await P({
        method: "POST",
        path: "/api/public/applications",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          submission_id: randomUUID(),
          name: p,
          email: "ungvien@dast.test",
          cover_letter: p,
          consent: true,
          elapsed_ms: 6000,
        }),
      });
      if (![200, 201].includes(a.status))
        stored.push(`application payload #${i + 1}: status ${a.status} ${clip(a.body, 80)}`);
    }
    checks.push(
      chk(
        `gửi ${XSS.length} payload qua form liên hệ + ứng tuyển công khai (chấp nhận hoặc từ chối có cấu trúc, không 5xx)`,
        stored.filter((x) => /status 5/.test(x)),
        `POST /api/public/inquiries|applications × ${XSS.length}; mỗi request một IP giả riêng`,
      ),
    );
    const inq = await P({ path: "/api/app/inquiries?limit=200", headers: { cookie: sessions.sales.cookie } });
    const inqBody = json(inq);
    const ie = [];
    if (inq.status !== 200 || inqBody === null) ie.push(`status ${inq.status}`);
    if (!/^application\/json/i.test(inq.headers["content-type"] ?? ""))
      ie.push("Content-Type không phải application/json");
    if ((inq.headers["x-content-type-options"] ?? "") !== "nosniff")
      ie.push("thiếu nosniff trên JSON chứa dữ liệu người dùng");
    const found = (inqBody?.items ?? []).filter((x) => String(x.message).includes("window.__dastHit")).length;
    if (found === 0) ie.push("không tìm thấy bản ghi payload đã lưu (tiền điều kiện)");
    checks.push(
      chk(
        "đọc lại liên hệ đã lưu (sales): JSON đúng kiểu, nosniff, dữ liệu giữ nguyên dạng văn bản",
        ie,
        evidenceLine("GET /api/app/inquiries", inq, ["content-type", "x-content-type-options"]) +
          ` — ${found} bản ghi payload`,
      ),
    );
    const apps = await P({
      path: "/api/app/applications?limit=200",
      headers: { cookie: sessions.hr.cookie },
    });
    const ae = [];
    if (!/^application\/json/i.test(apps.headers["content-type"] ?? ""))
      ae.push("Content-Type không phải application/json");
    if ((apps.headers["x-content-type-options"] ?? "") !== "nosniff")
      ae.push("thiếu nosniff trên JSON chứa dữ liệu người dùng");
    checks.push(
      chk(
        "đọc lại hồ sơ ứng tuyển đã lưu (hr): JSON đúng kiểu + nosniff",
        ae,
        evidenceLine("GET /api/app/applications", apps, ["content-type", "x-content-type-options"]),
      ),
    );

    // 4. Lưu qua bình luận, đơn OT/sửa công (hiển thị cho trưởng nhóm ở /app/approvals), tên tệp.
    const tasks = json(await P({ path: "/api/app/tasks", headers: { cookie: sessions.nv.cookie } }));
    const taskId =
      (tasks?.items ?? []).find((t) => String(t.title).startsWith("Lắp đặt"))?.id ?? tasks?.items?.[0]?.id;
    ctx.taskId = taskId;
    const ce = [];
    for (let i = 0; i < XSS.length; i++) {
      const r = await P({
        method: "POST",
        path: "/api/app/comments",
        headers: writeHeaders(sessions.nv, plain.origin, { "idempotency-key": `dast-cm-${randomUUID()}` }),
        body: JSON.stringify({ object_type: "task", object_id: taskId, body: XSS[i] }),
      });
      if (r.status !== 201) ce.push(`bình luận #${i + 1}: ${r.status} ${clip(r.body, 80)}`);
    }
    const cl = await P({
      path: `/api/app/comments?object_type=task&object_id=${taskId}`,
      headers: { cookie: sessions.nv.cookie },
    });
    if (!/^application\/json/i.test(cl.headers["content-type"] ?? ""))
      ce.push("danh sách bình luận không phải JSON");
    if (!cl.body.includes("window.__dastHit"))
      ce.push("không đọc lại được bình luận đã lưu (tiền điều kiện)");
    checks.push(
      chk(
        `bình luận ${XSS.length} payload: lưu được, đọc lại ở JSON`,
        ce,
        evidenceLine("GET /api/app/comments?object_type=task", cl, ["content-type"]),
      ),
    );
    let otOk = 0;
    for (let i = 0; i < 3; i++) {
      const r = await P({
        method: "POST",
        path: "/api/app/ot-requests",
        headers: writeHeaders(sessions.nv, plain.origin, { "idempotency-key": `dast-ot-${randomUUID()}` }),
        body: JSON.stringify({
          business_date: otDate(1 + i),
          minutes: 30 + i,
          reason: XSS[i],
          consent: true,
        }),
      });
      if (r.status === 201) otOk += 1;
    }
    const fname = `"><img data-mk="MK-STORED" src=x onerror=window.__dastHit=1>.pdf`;
    const mp = multipart(
      { object_type: "task", object_id: taskId },
      { name: fname, type: "application/pdf", data: PDF },
    );
    const up = await P({
      method: "POST",
      path: "/api/app/files",
      headers: {
        cookie: sessions.nv.cookie,
        origin: plain.origin,
        "x-csrf-token": sessions.nv.csrf,
        "content-type": mp.type,
        "idempotency-key": `dast-up-${randomUUID()}`,
      },
      body: mp.body,
    });
    const ue = [];
    if (up.status !== 201) ue.push(`upload PDF với tên độc: ${up.status} ${clip(up.body, 100)}`);
    const fileId = json(up)?.file_id;
    ctx.fileId = fileId;
    if (fileId !== undefined) {
      const dl = await P({ path: `/api/app/files/${fileId}`, headers: { cookie: sessions.nv.cookie } });
      const cd = dl.headers["content-disposition"] ?? "";
      if (!/^attachment/i.test(cd)) ue.push("tải tệp không ép attachment");
      if (/[<>"]\s*>|<img/i.test(cd.replace(/filename="tep"/, "")))
        ue.push("tên tệp thô trong Content-Disposition");
      if ((dl.headers["x-content-type-options"] ?? "") !== "nosniff") ue.push("tải tệp thiếu nosniff");
      if (dl.headers["content-type"] !== "application/pdf")
        ue.push(`Content-Type tải về ${dl.headers["content-type"]}`);
    }
    for (const [name, type, data] of [
      ["x.svg", "image/svg+xml", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')],
      ["x.html", "text/html", Buffer.from("<script>alert(1)</script>")],
      ["x.pdf.html", "application/pdf", PDF],
      ["x.html.pdf", "application/pdf", PDF],
      ["x.pdf", "application/pdf", Buffer.from("<script>alert(1)</script>")],
    ]) {
      const m2 = multipart({ object_type: "task", object_id: taskId }, { name, type, data });
      const r = await P({
        method: "POST",
        path: "/api/app/files",
        headers: {
          cookie: sessions.nv.cookie,
          origin: plain.origin,
          "x-csrf-token": sessions.nv.csrf,
          "content-type": m2.type,
          "idempotency-key": `dast-up-${randomUUID()}`,
        },
        body: m2.body,
      });
      if (r.status !== 415) ue.push(`tệp ${name} (${type}) phải bị 415, thấy ${r.status}`);
    }
    checks.push(
      chk(
        "tệp: tên độc lưu an toàn, tải về attachment+nosniff; svg/html/đuôi kép/nội dung giả bị 415",
        ue,
        `POST /api/app/files (tên chứa <img onerror>) → ${up.status}; svg/html/.pdf.html/.html.pdf/nội dung script → 415`,
      ),
    );

    // 5. Trình duyệt thật: trang đã render không thực thi payload (dialog/biến toàn cục) — gồm trang nội bộ người khác nhập vào.
    if (ctx.browser === undefined) {
      checks.push(
        chk("Chromium chạy được", [`không có trình duyệt: ${ctx.browserError}`], "bắt buộc cho kiểm DOM"),
      );
    } else {
      const canary = await ctx.browser.newContext();
      const cHits = [];
      try {
        await canary.exposeFunction("__dastReport", (v) => cHits.push(String(v)));
        await canary.addInitScript(() => {
          Object.defineProperty(window, "__dastHit", {
            configurable: false,
            get: () => undefined,
            set: (v) => window.__dastReport(String(v)),
          });
        });
        const pg = await canary.newPage();
        await pg.setContent(`<img src="x" onerror="window.__dastHit='MK-CANARY'">`);
        await pg.waitForTimeout(300);
      } finally {
        await canary.close();
      }
      checks.push(
        chk(
          "công cụ đo: payload canary CHẠY được trong Chromium thì probe bắt được",
          cHits.includes("MK-CANARY") ? [] : ["probe không bắt được payload canary — công cụ đo hỏng"],
          `canary onerror → ${cHits.length} lần báo`,
        ),
      );
      const allP = XSS.map((p) => enc(p));
      const pages = [
        ["/dich-vu/dast-markdown-doc", undefined, "CMS markdown độc (công khai)", SEED_MARKERS],
        ["/dich-vu", undefined, "danh sách dịch vụ (tiêu đề/tóm tắt độc)", SEED_MARKERS],
        [
          `/lien-he?service=${allP[0]}&source=${allP[1]}&q=${allP[3]}`,
          undefined,
          "phản chiếu query ở /lien-he",
          XSS_MARKERS,
        ],
        [`/dich-vu/${allP[0]}`, undefined, "404 phản chiếu đường dẫn", XSS_MARKERS],
        [`/app/login?next=${allP[0]}&error=${allP[1]}`, undefined, "phản chiếu ở /app/login", XSS_MARKERS],
        ["/app/tasks", sessions.nv.cookie, "việc của nv (tiêu đề + tiêu chí độc từ seed)", SEED_MARKERS],
        ["/app/today", sessions.nv.cookie, "hôm nay (nv)", SEED_MARKERS],
        ["/app/me", sessions.nv.cookie, "hồ sơ (nv)", XSS_MARKERS],
        ["/app/attendance", sessions.nv.cookie, "chấm công (nv)", XSS_MARKERS],
        ["/app/approvals", sessions.tl.cookie, "hộp duyệt (tl) — lý do OT do nv nhập", XSS_MARKERS],
        ["/app/dashboard", sessions.exec.cookie, "bảng điều hành (exec)", SEED_MARKERS],
      ];
      for (const [url, cookie, label, markers] of pages) {
        const d = await domProbe(ctx, { url, cookieHeader: cookie, markers });
        const errs = analyzeHtmlForXss(d.html, { markers });
        if (d.hits.length > 0) errs.push(`payload THỰC THI (window.__dastHit): ${d.hits.join(",")}`);
        if (d.dialogs.length > 0) errs.push(`hộp thoại/popup bật lên: ${d.dialogs.join(" | ")}`);
        if (d.dom.hasMk > 0) errs.push(`${d.dom.hasMk} phần tử [data-mk] trong DOM`);
        if (d.dom.inline > 0) errs.push(`${d.dom.inline} phần tử có handler inline trong DOM`);
        if (d.status !== 200 && d.status !== 404) errs.push(`status ${d.status}`);
        checks.push(
          chk(
            `DOM thật: ${label}`,
            errs,
            `Chromium mở ${clip(url.split("?")[0], 40)}${url.includes("?") ? "?…" : ""} → ${d.status}; 0 dialog, 0 lần gán __dastHit, 0 [data-mk]; đã bấm ${d.anchors.length} liên kết trong nội dung`,
          ),
        );
      }
      void otOk;
    }
    return groupResult(groupXss.gid, groupXss.gtitle, groupXss.grefs, checks);
  },
  "DAST-C",
  "XSS phản chiếu & lưu (HTML + Chromium thật)",
  ["SEC-WEB-004", "FE-SEC-001", "ASVS V1/V3", "Top10:2025 A05"],
);

// ---------------------------------------------------------------- D. CSRF / CORS
const groupCsrf = tag(
  async ({ P, plain, sessions, seed, U, taskId }) => {
    const checks = [];
    const s = sessions.nv;
    const body = JSON.stringify({ object_type: "task", object_id: taskId, body: "kiểm CSRF" });
    const base = { "content-type": "application/json", cookie: s.cookie };
    const variants = [
      ["thiếu x-csrf-token", { ...base, origin: plain.origin }],
      ["x-csrf-token sai", { ...base, origin: plain.origin, "x-csrf-token": "A".repeat(64) }],
      [
        "x-csrf-token của người khác (nv2) với cookie của nv",
        { ...base, origin: plain.origin, "x-csrf-token": sessions.nv2.csrf },
      ],
      ["Origin lạ + token đúng", { ...base, origin: EVIL, "x-csrf-token": s.csrf }],
      ["không Origin, không Sec-Fetch-Site + token đúng", { ...base, "x-csrf-token": s.csrf }],
      [
        "Sec-Fetch-Site: cross-site, không Origin",
        { ...base, "sec-fetch-site": "cross-site", "x-csrf-token": s.csrf },
      ],
      ["Origin: null (iframe sandbox) + token đúng", { ...base, origin: "null", "x-csrf-token": s.csrf }],
      [
        "Origin giả hậu tố (host hợp lệ + .evil.test)",
        { ...base, origin: `${plain.origin}.evil.test`, "x-csrf-token": s.csrf },
      ],
      [
        "form chéo nguồn (text/plain, không token)",
        { "content-type": "text/plain", cookie: s.cookie, origin: EVIL },
      ],
    ];
    for (const [name, headers] of variants) {
      const r = await P({
        method: "POST",
        path: "/api/app/comments",
        headers: { ...headers, "idempotency-key": `dast-cs-${randomUUID()}` },
        body,
      });
      checks.push(
        chk(`POST ghi: ${name} → 403 CSRF`, checkCsrfRejected(r), evidenceLine("POST /api/app/comments", r)),
      );
    }
    const ok = await P({
      method: "POST",
      path: "/api/app/comments",
      headers: writeHeaders(s, plain.origin, { "idempotency-key": `dast-cs-${randomUUID()}` }),
      body,
    });
    checks.push(
      chk(
        "đối chứng: cùng request hợp lệ (Origin + token đúng) → 201 (probe không đỏ/xanh vô nghĩa)",
        ok.status === 201 ? [] : [`status ${ok.status}`],
        evidenceLine("POST /api/app/comments (hợp lệ)", ok),
      ),
    );
    const lcsrf = await P({
      method: "POST",
      path: "/api/app/auth/login",
      headers: { "content-type": "application/json", origin: EVIL },
      body: JSON.stringify({ email: U("nv").email, password: seed.password }),
    });
    const le = checkCsrfRejected(lcsrf);
    if (lcsrf.setCookie.length > 0) le.push("đặt cookie phiên cho request chéo nguồn (login CSRF)");
    checks.push(
      chk(
        "login CSRF: đăng nhập từ Origin lạ → 403 và không cookie",
        le,
        evidenceLine("POST /api/app/auth/login (Origin lạ, mật khẩu đúng)", lcsrf),
      ),
    );
    const lo = await P({
      method: "POST",
      path: "/api/app/auth/logout",
      headers: { "content-type": "application/json", cookie: s.cookie, origin: EVIL },
      body: "{}",
    });
    const still = await P({ path: "/api/app/me", headers: { cookie: s.cookie } });
    checks.push(
      chk(
        "logout CSRF: Origin lạ → 403 và phiên còn nguyên",
        [...checkCsrfRejected(lo), ...(still.status === 200 ? [] : ["phiên bị huỷ bởi request chéo nguồn"])],
        evidenceLine("POST /api/app/auth/logout (Origin lạ)", lo),
      ),
    );
    const gl = await P({ path: "/api/app/auth/logout", headers: { cookie: s.cookie } });
    checks.push(
      chk(
        "GET không đổi trạng thái: GET /api/app/auth/logout → 405",
        gl.status === 405 && (await P({ path: "/api/app/me", headers: { cookie: s.cookie } })).status === 200
          ? []
          : [`status ${gl.status} hoặc phiên bị huỷ`],
        evidenceLine("GET /api/app/auth/logout", gl),
      ),
    );
    for (const p of ["/api/app/me", "/api/public/inquiries", "/api/app/tasks", "/api/readyz"]) {
      const pre = await P({
        method: "OPTIONS",
        path: p,
        headers: {
          origin: EVIL,
          "access-control-request-method": "POST",
          "access-control-request-headers": "x-csrf-token,content-type",
          cookie: s.cookie,
        },
      });
      const get = await P({ path: p, headers: { origin: EVIL, cookie: s.cookie } });
      checks.push(
        chk(
          `CORS ${p}: preflight và GET với Origin lạ không được cấp quyền`,
          [...checkCors(pre, EVIL), ...checkCors(get, EVIL)],
          evidenceLine(`OPTIONS ${p} (Origin lạ)`, pre, [
            "access-control-allow-origin",
            "access-control-allow-credentials",
          ]) + ` | GET → ${get.status}, ACAO: ${get.headers["access-control-allow-origin"] ?? "(không có)"}`,
        ),
      );
    }
    return groupResult(groupCsrf.gid, groupCsrf.gtitle, groupCsrf.grefs, checks);
  },
  "DAST-D",
  "CSRF (token + Origin) và CORS",
  ["SEC-WEB-007", "SEC-WEB-013", "ASVS V3"],
);

// ---------------------------------------------------------------- E. open redirect
const groupRedirect = tag(
  async ({ P, plain, sessions }) => {
    const checks = [];
    const names = [
      "next",
      "redirect",
      "returnTo",
      "callbackUrl",
      "url",
      "continue",
      "redirect_uri",
      "return_to",
      "r",
    ];
    const evilTargets = [EVIL, `//evil.test`, `/\\evil.test`, `https:evil.test`, `%2F%2Fevil.test`];
    for (const [label, cookie] of [
      ["chưa đăng nhập", undefined],
      ["đã đăng nhập", sessions.nv.cookie],
    ]) {
      const errs = [];
      let n = 0;
      let ev = "";
      for (const nm of names)
        for (const t of evilTargets) {
          const r = await P({
            path: `/app/login?${nm}=${encodeURIComponent(t)}`,
            headers: cookie ? { cookie } : {},
          });
          const r2 = await P({ path: `/app/login?${nm}=${t}`, headers: cookie ? { cookie } : {} });
          for (const x of [r, r2]) {
            n += 1;
            errs.push(...checkRedirectTarget(x, plain.baseUrl, { allowedOrigins: [plain.origin] }));
            if (ev === "") ev = evidenceLine(`GET /app/login?${nm}=${EVIL}`, x, ["location"]);
          }
        }
      checks.push(
        chk(
          `/app/login với ${names.length} tên tham số × ${evilTargets.length} đích lạ (${label})`,
          [...new Set(errs)].slice(0, 5),
          `${ev}; ${n} request, không Location nào ra ngoài nguồn`,
        ),
      );
    }
    const odd = [
      "//evil.test",
      "//evil.test/%2e%2e",
      "/%5Cevil.test",
      "/\\evil.test",
      "//evil.test//",
      "/app//evil.test",
      "/dich-vu//evil.test",
      "/%2F%2Fevil.test",
      "/dich-vu/",
      "/app/today/",
      "/app/login/",
      "///evil.test",
    ];
    const errs2 = [];
    let ev2 = "";
    for (const p of odd) {
      const r = await P({ path: p });
      errs2.push(
        ...checkRedirectTarget(r, plain.baseUrl, { allowedOrigins: [plain.origin] }).map((x) => `${p}: ${x}`),
      );
      if (r.status >= 500) errs2.push(`${p}: 5xx`);
      if (r.status >= 300 && r.status < 400 && ev2 === "") ev2 = evidenceLine(`GET ${p}`, r, ["location"]);
    }
    checks.push(
      chk(
        `đường dẫn dị dạng (// \\\\ %2F, thừa dấu /) × ${odd.length}: chuẩn hoá/chuyển hướng không ra ngoài`,
        errs2.slice(0, 5),
        `${ev2 || "không có chuyển hướng"}; ${odd.length} đường dẫn`,
      ),
    );
    const host = await P({ path: "/app/today", headers: { host: "evil.test" } });
    checks.push(
      chk(
        "Host header lạ: chuyển hướng chưa đăng nhập không bị đầu độc bằng Host",
        checkRedirectTarget(host, plain.baseUrl, { allowedOrigins: [plain.origin] }),
        evidenceLine("GET /app/today (Host: evil.test)", host, ["location"]),
      ),
    );
    const xfh = await P({
      path: "/app/today",
      headers: { "x-forwarded-host": "evil.test", "x-forwarded-proto": "https" },
    });
    checks.push(
      chk(
        "X-Forwarded-Host lạ không đầu độc chuyển hướng",
        checkRedirectTarget(xfh, plain.baseUrl, { allowedOrigins: [plain.origin] }),
        evidenceLine("GET /app/today (X-Forwarded-Host: evil.test)", xfh, ["location"]),
      ),
    );
    return groupResult(groupRedirect.gid, groupRedirect.gtitle, groupRedirect.grefs, checks);
  },
  "DAST-E",
  "Open redirect (next/redirect/returnTo…, đường dẫn dị dạng, Host)",
  ["SEC-WEB-017", "ASVS V3"],
);

// ---------------------------------------------------------------- F. rò thông tin lỗi
const groupErrors = tag(
  async ({ P, plain, sessions, taskId }) => {
    const checks = [];
    const auth = { cookie: sessions.nv.cookie };
    const w = (extra = {}) => writeHeaders(sessions.nv, plain.origin, extra);
    const noLeak = (r, p = "") => leakFindings(stripEcho(r.body, p)).map((x) => `rò: ${x}`);
    const cases = [
      [
        "API: JSON hỏng",
        {
          method: "POST",
          path: "/api/app/comments",
          headers: w({ "idempotency-key": `dast-e-${randomUUID()}` }),
          body: "{",
        },
        [400],
      ],
      [
        "API: thiếu trường / sai kiểu",
        {
          method: "POST",
          path: "/api/app/comments",
          headers: w({ "idempotency-key": `dast-e-${randomUUID()}` }),
          body: JSON.stringify({ object_type: 5, object_id: "x" }),
        },
        [400, 422],
      ],
      [
        "API: body vượt trần (Content-Length)",
        {
          method: "POST",
          path: "/api/app/comments",
          headers: w({ "idempotency-key": `dast-e-${randomUUID()}` }),
          body: JSON.stringify({ body: "x".repeat(40_000) }),
        },
        [413],
      ],
      ["API: limit=abc", { path: "/api/app/tasks?limit=abc", headers: auth }, [400]],
      [
        "API: limit nghịch (SQL-ish)",
        { path: `/api/app/tasks?limit=${encodeURIComponent("1' OR '1'='1")}`, headers: auth },
        [400],
      ],
      ["API: offset âm", { path: "/api/app/tasks?offset=-1", headers: auth }, [400]],
      ["API: limit vượt trần", { path: "/api/app/tasks?limit=1000000", headers: auth }, [400]],
      ["API: id không phải UUID", { path: "/api/app/files/not-a-uuid", headers: auth }, [404]],
      ["API: UUID không tồn tại", { path: `/api/app/files/${randomUUID()}`, headers: auth }, [404]],
      [
        "API: id kiểu SQL injection",
        { path: `/api/app/files/${encodeURIComponent("'; DROP TABLE app_user;--")}`, headers: auth },
        [404],
      ],
      [
        "API: hành động việc không tồn tại",
        {
          method: "POST",
          path: `/api/app/tasks/${taskId}/hack`,
          headers: w({ "idempotency-key": `dast-e-${randomUUID()}` }),
          body: "{}",
        },
        [404],
      ],
      ["API: chưa đăng nhập", { path: "/api/app/me" }, [401]],
      ["API: cookie hỏng", { path: "/api/app/me", headers: { cookie: "xc_session=%E0%A4%A" } }, [401]],
      [
        "API: phương thức không hỗ trợ (DELETE /api/app/me)",
        { method: "DELETE", path: "/api/app/me", headers: auth },
        [401, 403, 405],
      ],
      [
        "API công khai: dữ liệu sai kiểu",
        {
          method: "POST",
          path: "/api/public/inquiries",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ submission_id: "x", name: 1, consent: "yes" }),
        },
        [400],
      ],
      [
        "API công khai: JSON hỏng",
        {
          method: "POST",
          path: "/api/public/inquiries",
          headers: { "content-type": "application/json" },
          body: "{{{",
        },
        [400],
      ],
      [
        "API công khai: body rất lớn",
        {
          method: "POST",
          path: "/api/public/inquiries",
          headers: { "content-type": "application/json" },
          body: "x".repeat(100_000),
        },
        [413, 400],
      ],
      ["API: route không tồn tại", { path: "/api/app/khong-co" }, [404, 401]],
      [
        "API: đăng nhập thiếu trường",
        {
          method: "POST",
          path: "/api/app/auth/login",
          headers: { "content-type": "application/json", origin: plain.origin },
          body: "{}",
        },
        [400],
      ],
    ];
    for (const [name, o, okStatuses] of cases) {
      const r = await P(o);
      const errs = [...noLeak(r, o.path)];
      if (r.status >= 500) errs.push(`5xx (${r.status}) với đầu vào sai`);
      if (!okStatuses.includes(r.status)) errs.push(`status ${r.status} ∉ [${okStatuses}]`);
      if (/json/i.test(r.headers["content-type"] ?? "") && r.status >= 400 && r.body !== "") {
        const pe = checkProblem(r).filter((x) => !x.startsWith("status "));
        errs.push(...pe);
      }
      checks.push(
        chk(name, errs, evidenceLine(`${o.method ?? "GET"} ${clip(o.path, 70)}`, r, ["content-type"])),
      );
    }
    const web = [
      ["trang 404", "/khong-co-trang-nay"],
      ["404 với đường dẫn rất dài (6 000 ký tự)", `/dich-vu/${"a".repeat(6000)}`],
      ["slug SQL injection", `/dich-vu/${encodeURIComponent("' OR 1=1--")}`],
      ["percent-encoding hỏng", "/%E0%A4%A"],
      ["byte NUL", "/%00"],
      ["traversal thô", "/dich-vu/..%2f..%2f..%2fetc%2fpasswd"],
      ["/app/<không có>", "/app/khong-co-trang"],
    ];
    for (const [name, p] of web) {
      const r = await P({ path: p, headers: p.startsWith("/app") ? auth : {} });
      const errs = [...noLeak(r, p)];
      if (r.status >= 500) errs.push(`5xx (${r.status})`);
      if (/<!--\s*(?:digest|error)|"digest"\s*:|stack/i.test(r.body))
        errs.push("trang lỗi chứa digest/stack");
      checks.push(chk(`web: ${name}`, errs, evidenceLine(`GET ${clip(p, 60)}`, r)));
    }
    const rz = await P({ path: "/api/readyz" });
    checks.push(
      chk(
        "readyz chỉ trả trạng thái ngắn (không chuỗi kết nối/phiên bản)",
        [
          ...noLeak(rz),
          ...(Object.keys(json(rz) ?? {}).join() === "status" ? [] : ["readyz trả thêm trường ngoài status"]),
        ],
        evidenceLine("GET /api/readyz", rz),
      ),
    );
    return groupResult(groupErrors.gid, groupErrors.gtitle, groupErrors.grefs, checks);
  },
  "DAST-F",
  "Rò thông tin lỗi (stack/SQL/đường dẫn; RFC 9457)",
  ["BASE-ERR-003", "SEC-WEB-002", "SEC-WEB-014", "ASVS V16"],
);

// ---------------------------------------------------------------- G. đường dẫn nhạy cảm
const groupPaths = tag(
  async ({ P, S, plain, metricsToken, sessions }) => {
    const checks = [];
    const { readdirSync } = await import("node:fs");
    const mig =
      readdirSync(path.join(ROOT, "migrations"))
        .filter((f) => f.endsWith(".sql"))
        .sort()[0] ?? "0001.sql";
    const direct = [
      "/.env",
      "/.env.local",
      "/.env.production",
      "/.git/config",
      "/.git/HEAD",
      "/package.json",
      "/package-lock.json",
      "/next.config.ts",
      "/proxy.ts",
      "/lib/nen/env.ts",
      `/migrations/${mig}`,
      "/node_modules/next/package.json",
      "/e2e/.seed.json",
      "/scripts/dast-baseline.mjs",
      "/docs/security/dast-report.md",
      "/BLUEPRINT.md",
      "/CLAUDE.md",
      "/xt.yaml",
      "/coverage/lcov.info",
      "/.xtemplates/",
      "/.next/BUILD_ID",
      "/.next/server/app-paths-manifest.json",
      "/uploads/",
      "/files/",
      "/storage/",
      "/public/uploads/",
      "/.data/",
      "/api/",
      "/_next/",
      "/_next/static/",
      "/_next/server/app/index.html",
      "/server-status",
      "/actuator/health",
      "/api/debug",
      "/api/openapi.json",
      "/graphql",
      "/admin",
      "/wp-login.php",
    ];
    const errs = [];
    for (const p of direct) {
      let r = await P({ path: p });
      // Chuẩn hoá dấu / cuối của Next (308 → cùng đường dẫn không có /): theo một bước để xét đích thật.
      if (
        [301, 307, 308].includes(r.status) &&
        /^\/[^/]/.test(r.headers.location ?? "") &&
        !/\/app\/login/.test(r.headers.location)
      )
        r = await P({ path: r.headers.location });
      errs.push(...checkNotServed(r, { allowRedirectToLogin: true }).map((x) => `${p}: ${x}`));
    }
    checks.push(
      chk(
        `${direct.length} đường dẫn nhạy cảm/mã nguồn/thư mục/debug không được phục vụ`,
        errs.slice(0, 6),
        `GET × ${direct.length} (.env, .git, package.json, mã nguồn, migrations, seed, báo cáo, .next, uploads, debug…) → 404/401/403, không dấu hiệu bí mật`,
      ),
    );
    const trav = [
      "/_next/static/../../.env",
      "/_next/static/%2e%2e/%2e%2e/package.json",
      "/..%2f..%2fpackage.json",
      "/public/../package.json",
      "/%2e%2e/%2e%2e/etc/passwd",
      "/.env%00",
      "/_next/static/chunks/..%5c..%5c..%5cpackage.json",
      "/static/..;/package.json",
      "/_next/image?url=/../../.env&w=64&q=75",
    ];
    const terrs = [];
    for (const p of trav) {
      const r = await P({ path: p });
      if (r.status === 200 && /"name"\s*:\s*"x-company"|root:.*:0:0|DATABASE_URL/.test(r.body))
        terrs.push(`${p}: lộ nội dung (200)`);
      if (r.status >= 500) terrs.push(`${p}: 5xx`);
      terrs.push(...leakFindings(r.body).map((x) => `${p}: rò ${x}`));
    }
    checks.push(
      chk(
        `path traversal thô × ${trav.length} (.. %2e %2f %5c ;.. NUL)`,
        terrs.slice(0, 5),
        `GET × ${trav.length}, đường dẫn gửi nguyên văn không chuẩn hoá phía khách`,
      ),
    );
    // Source map
    const home = await P({ path: "/" });
    const scripts = [...home.body.matchAll(/src="(\/_next\/static\/[^"]+\.js[^"]*)"/g)]
      .map((m) => m[1])
      .slice(0, 14);
    const merrs = [];
    if (scripts.length === 0) merrs.push("không tìm thấy script để kiểm .map (tiền điều kiện)");
    for (const js of scripts) {
      const jsRes = await P({ path: js });
      const clean = js.split("?")[0];
      const mapRes = await P({ path: `${clean}.map` });
      merrs.push(...checkSourceMapNotPublic(jsRes, mapRes).map((x) => `${clean}: ${x}`));
    }
    checks.push(
      chk(
        `source map: ${scripts.length} chunk JS không có sourceMappingURL và *.map trả 404`,
        merrs.slice(0, 5),
        `GET ${clip(scripts[0] ?? "", 60)}.map → 404 (… ${scripts.length} chunk)`,
      ),
    );
    // metrics
    const m0 = await P({ path: "/api/metrics" });
    const m1 = await P({
      path: "/api/metrics",
      headers: { authorization: "Bearer sai-token-sai-token-sai" },
    });
    const m2 = await P({ path: `/api/metrics?token=${metricsToken}&access_token=${metricsToken}` });
    const m3 = await P({ path: "/api/metrics", headers: { authorization: `Bearer ${metricsToken}` } });
    const me = [];
    if (m0.status !== 401) me.push(`không token: ${m0.status} (cần 401)`);
    if (m1.status !== 401) me.push(`token sai: ${m1.status} (cần 401)`);
    if (m2.status !== 401) me.push(`token trên query string: ${m2.status} (không được chấp nhận)`);
    if (m3.status !== 200) me.push(`token đúng: ${m3.status} (đối chứng cần 200)`);
    if (/[\w.-]+@[\w-]+\.\w+/.test(m3.body)) me.push("metrics chứa địa chỉ email");
    if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(m3.body))
      me.push("metrics chứa UUID (nhãn cardinality cao/PII)");
    checks.push(
      chk(
        "/api/metrics cần bearer (không token/sai/query-string → 401; đúng → 200 không PII)",
        me,
        `${evidenceLine("GET /api/metrics (không token)", m0)} | sai → ${m1.status} | ?token= → ${m2.status} | đúng → ${m3.status}`,
      ),
    );
    const mt = await S({ path: "/api/metrics", headers: { authorization: `Bearer ${metricsToken}` } });
    checks.push(
      chk(
        "/api/metrics khi METRICS_TOKEN chưa đặt → 404 (như không tồn tại)",
        mt.status === 404 ? [] : [`status ${mt.status}`],
        evidenceLine("GET /api/metrics (instance không đặt token)", mt),
      ),
    );
    // SSRF qua bộ tối ưu ảnh của Next
    const ssrf = [];
    for (const u of [
      `http://127.0.0.1:${plain.port}/api/readyz`,
      "https://evil.test/x.png",
      "http://169.254.169.254/latest/meta-data/",
      "file:///etc/passwd",
    ]) {
      const r = await P({ path: `/_next/image?url=${encodeURIComponent(u)}&w=64&q=75` });
      if (r.status === 200) ssrf.push(`/_next/image nạp URL ngoài: ${u}`);
      if (r.status >= 500) ssrf.push(`5xx với url=${u}`);
    }
    checks.push(
      chk(
        "/_next/image không nạp URL tuỳ ý (SSRF qua bộ tối ưu ảnh)",
        ssrf,
        "GET /_next/image?url=<nội bộ|ngoài|metadata|file> → 4xx",
      ),
    );
    // Tệp tải lên không phục vụ trực tiếp
    const fid = (await P({ path: "/api/app/files/" + randomUUID() })).status;
    checks.push(
      chk(
        "tải tệp chưa đăng nhập → 401",
        fid === 401 ? [] : [`status ${fid}`],
        `GET /api/app/files/<uuid> (không phiên) → ${fid}`,
      ),
    );
    const sm = await P({ path: "/sitemap.xml" });
    const rb = await P({ path: "/robots.txt" });
    const se = [];
    if (/\/app\b|\/api\b/.test(sm.body)) se.push("sitemap liệt kê /app hoặc /api");
    if (sm.body.includes("dich-vu-nhap")) se.push("sitemap lộ bản nháp");
    if (!/disallow:\s*\/app/i.test(rb.body)) se.push("robots.txt không chặn /app");
    checks.push(
      chk(
        "sitemap/robots: không lộ bản nháp, /app bị chặn bot",
        se,
        `${evidenceLine("GET /robots.txt", rb)} ${clip(rb.body, 80)}`,
      ),
    );
    void sessions;
    return groupResult(groupPaths.gid, groupPaths.gtitle, groupPaths.grefs, checks);
  },
  "DAST-G",
  "Đường dẫn nhạy cảm không được phục vụ (.env, .git, source map, metrics, uploads)",
  ["PRF-WEB-008", "SEC-WEB-014", "SEC-WEB-019", "OPS-OBS-003", "ASVS V13"],
);

// ---------------------------------------------------------------- I. BOLA / BFLA
const groupBola = tag(
  async ({ P, plain, sessions, seed, taskId, fileId }) => {
    const checks = [];
    const nv = sessions.nv;
    const nv2 = sessions.nv2;
    const w2 = (extra = {}) => writeHeaders(nv2, plain.origin, extra);
    const secretMark = "BOLA-BI-MAT-" + randomBytes(4).toString("hex");
    const cm = await P({
      method: "POST",
      path: "/api/app/comments",
      headers: writeHeaders(nv, plain.origin, { "idempotency-key": `dast-bola-${randomUUID()}` }),
      body: JSON.stringify({ object_type: "task", object_id: taskId, body: secretMark }),
    });
    checks.push(
      chk(
        "tiền điều kiện: nv sở hữu việc, tệp và bình luận",
        taskId !== undefined && fileId !== undefined && cm.status === 201
          ? []
          : [`taskId=${taskId}, fileId=${fileId}, bình luận ${cm.status}`],
        `việc ${String(taskId).slice(0, 8)}…, tệp ${String(fileId).slice(0, 8)}…, bình luận → ${cm.status}`,
      ),
    );
    const ownRead = await P({
      path: `/api/app/comments?object_type=task&object_id=${taskId}`,
      headers: { cookie: nv.cookie },
    });
    checks.push(
      chk(
        "đối chứng: chủ việc đọc được bình luận của mình",
        ownRead.status === 200 && ownRead.body.includes(secretMark) ? [] : [`status ${ownRead.status}`],
        evidenceLine("GET /api/app/comments (nv)", ownRead),
      ),
    );
    const secrets = [secretMark, "window.__dastHit"];
    const cross = [
      ["BOLA: nv2 tải tệp của nv", { path: `/api/app/files/${fileId}`, headers: { cookie: nv2.cookie } }],
      [
        "BOLA: nv2 đọc bình luận của việc nv",
        { path: `/api/app/comments?object_type=task&object_id=${taskId}`, headers: { cookie: nv2.cookie } },
      ],
      [
        "BOLA: nv2 bình luận lên việc của nv",
        {
          method: "POST",
          path: "/api/app/comments",
          headers: w2({ "idempotency-key": `dast-bola-${randomUUID()}` }),
          body: JSON.stringify({ object_type: "task", object_id: taskId, body: "xâm nhập" }),
        },
      ],
      [
        "BOLA: nv2 đính kèm tệp vào việc của nv",
        (() => {
          const m = multipart(
            { object_type: "task", object_id: taskId },
            { name: "x.pdf", type: "application/pdf", data: PDF },
          );
          return {
            method: "POST",
            path: "/api/app/files",
            headers: {
              cookie: nv2.cookie,
              origin: plain.origin,
              "x-csrf-token": nv2.csrf,
              "content-type": m.type,
              "idempotency-key": `dast-bola-${randomUUID()}`,
            },
            body: m.body,
          };
        })(),
      ],
      ...["start", "submit", "accept", "cancel"].map((a) => [
        `BOLA: nv2 ${a} việc của nv`,
        {
          method: "POST",
          path: `/api/app/tasks/${taskId}/${a}`,
          headers: w2({ "idempotency-key": `dast-bola-${randomUUID()}` }),
          body: JSON.stringify({ version: 1 }),
        },
      ]),
    ];
    for (const [name, o] of cross) {
      const r = await P(o);
      checks.push(
        chk(name, checkDenied(r, secrets), evidenceLine(`${o.method ?? "GET"} ${clip(o.path, 60)}`, r)),
      );
    }
    const l2 = json(await P({ path: "/api/app/tasks?limit=200", headers: { cookie: nv2.cookie } }));
    checks.push(
      chk(
        "BOLA: danh sách việc của nv2 không chứa việc của nv",
        (l2?.items ?? []).some((t) => t.id === taskId) ? ["thấy việc của người khác"] : [],
        `GET /api/app/tasks (nv2) → ${(l2?.items ?? []).length} mục, không có ${String(taskId).slice(0, 8)}…`,
      ),
    );
    const me2 = json(
      await P({
        path: `/api/app/me?user_id=${seed.users.nv.userId}&employee_id=${seed.users.nv.employeeId}`,
        headers: { cookie: nv2.cookie, "x-user-id": seed.users.nv.userId },
      }),
    );
    checks.push(
      chk(
        "BOLA: tham số/header user_id không đổi danh tính (mass assignment danh tính)",
        me2?.user_id === seed.users.nv2.userId ? [] : ["/api/app/me trả danh tính khác phiên"],
        `GET /api/app/me?user_id=<nv> (phiên nv2) → user_id của nv2`,
      ),
    );
    // Chéo công ty (tenant)
    const m = seed.mobile.users.nv;
    const mS = await login(plain.baseUrl, plain.origin, m.email, seed.password, {
      "x-forwarded-for": nextIp(),
    });
    const tenant = [
      [
        "tenant: người dùng công ty khác tải tệp",
        { path: `/api/app/files/${fileId}`, headers: { cookie: mS.cookie } },
      ],
      [
        "tenant: đọc bình luận việc công ty khác",
        { path: `/api/app/comments?object_type=task&object_id=${taskId}`, headers: { cookie: mS.cookie } },
      ],
      [
        "tenant: đổi trạng thái việc công ty khác",
        {
          method: "POST",
          path: `/api/app/tasks/${taskId}/start`,
          headers: writeHeaders(mS, plain.origin, { "idempotency-key": `dast-bola-${randomUUID()}` }),
          body: JSON.stringify({ version: 1 }),
        },
      ],
    ];
    for (const [name, o] of tenant) {
      const r = await P(o);
      checks.push(
        chk(name, checkDenied(r, secrets), evidenceLine(`${o.method ?? "GET"} ${clip(o.path, 60)}`, r)),
      );
    }
    // IDOR trên đơn OT + phê duyệt
    const ot = await P({
      method: "POST",
      path: "/api/app/ot-requests",
      headers: writeHeaders(nv, plain.origin, { "idempotency-key": `dast-bola-${randomUUID()}` }),
      body: JSON.stringify({
        business_date: otDate(5),
        minutes: 20,
        reason: "BOLA OT",
        consent: true,
      }),
    });
    const otId = json(ot)?.id;
    if (otId !== undefined) {
      for (const [name, s2] of [
        ["nv2 (đồng cấp)", nv2],
        ["nv (tự duyệt đơn của mình)", nv],
      ]) {
        const r = await P({
          method: "POST",
          path: `/api/app/approvals/ot/${otId}/approve`,
          headers: writeHeaders(s2, plain.origin, { "idempotency-key": `dast-bola-${randomUUID()}` }),
          body: "{}",
        });
        checks.push(
          chk(
            `BFLA/BOLA: ${name} duyệt đơn OT của nv → bị từ chối`,
            checkDenied(r),
            evidenceLine(`POST /api/app/approvals/ot/<id>/approve`, r),
          ),
        );
      }
    } else
      checks.push(
        chk(
          "tạo đơn OT để thử IDOR",
          [`không tạo được đơn OT: ${ot.status} ${clip(ot.body, 120)}`],
          "POST /api/app/ot-requests",
        ),
      );
    // BFLA theo chức năng
    const bfla = [
      ["nv (nhân viên) đọc liên hệ khách", { path: "/api/app/inquiries", headers: { cookie: nv.cookie } }],
      ["nv đọc hồ sơ ứng tuyển", { path: "/api/app/applications", headers: { cookie: nv.cookie } }],
      ["nv đọc yêu cầu DSAR", { path: "/api/app/privacy/requests", headers: { cookie: nv.cookie } }],
      [
        "nv tạo yêu cầu DSAR",
        {
          method: "POST",
          path: "/api/app/privacy/requests",
          headers: writeHeaders(nv, plain.origin, { "idempotency-key": `dast-bfla-${randomUUID()}` }),
          body: "{}",
        },
      ],
      [
        "sales đọc hồ sơ ứng tuyển (tách quyền ứng viên)",
        { path: "/api/app/applications", headers: { cookie: sessions.sales.cookie } },
      ],
      ["hr đọc liên hệ khách", { path: "/api/app/inquiries", headers: { cookie: sessions.hr.cookie } }],
      [
        "nv hiển thị QR địa điểm",
        { path: `/api/app/attendance/qr/${randomUUID()}`, headers: { cookie: nv.cookie } },
      ],
    ];
    for (const [name, o] of bfla) {
      const r = await P(o);
      checks.push(
        chk(
          `BFLA: ${name} → bị từ chối`,
          checkDenied(r),
          evidenceLine(`${o.method ?? "GET"} ${clip(o.path, 50)}`, r),
        ),
      );
    }
    // Không phiên → 401 trên mọi route nội bộ
    const gets = [
      "/api/app/me",
      "/api/app/tasks",
      "/api/app/approvals",
      "/api/app/inquiries",
      "/api/app/applications",
      `/api/app/comments?object_type=task&object_id=${taskId}`,
      "/api/app/privacy/requests",
      `/api/app/files/${randomUUID()}`,
      `/api/app/attendance/qr/${randomUUID()}`,
    ];
    const posts = [
      "/api/app/attendance/events",
      "/api/app/leave-requests",
      "/api/app/ot-requests",
      "/api/app/adjustments",
      "/api/app/files",
      "/api/app/sync",
      "/api/app/comments",
      "/api/app/privacy/requests",
      "/api/app/auth/logout",
    ];
    const ue = [];
    for (const p of gets) {
      const r = await P({ path: p });
      if (r.status !== 401) ue.push(`GET ${clip(p, 50)} → ${r.status}`);
    }
    for (const p of posts) {
      const r = await P({
        method: "POST",
        path: p,
        headers: { "content-type": "application/json", origin: plain.origin },
        body: "{}",
      });
      if (r.status !== 401) ue.push(`POST ${p} → ${r.status}`);
    }
    checks.push(
      chk(
        `không phiên → 401 trên ${gets.length + posts.length} route /api/app/*`,
        ue,
        `GET×${gets.length} + POST×${posts.length} không cookie → 401`,
      ),
    );
    return groupResult(groupBola.gid, groupBola.gtitle, groupBola.grefs, checks);
  },
  "DAST-I",
  "IDOR/BOLA và BFLA giữa các người dùng seed trên /api/app/*",
  ["STD-SEC-004", "OWASP API1 (BOLA)", "OWASP API5 (BFLA)", "ASVS V8"],
);

// ---------------------------------------------------------------- H. giới hạn tần suất + idempotency (chạy cuối: đốt bộ đếm)
const groupRates = tag(
  async ({ P, plain, seed, U, sessions }) => {
    const checks = [];
    const ipA = "172.16.9.1";
    const inqBody = () =>
      JSON.stringify({
        submission_id: randomUUID(),
        name: "Kiểm tần suất",
        email: "rate@dast.test",
        message: "kiểm tra giới hạn",
        consent: true,
        elapsed_ms: 6000,
      });
    const r1 = [];
    for (let i = 0; i < 8; i++)
      r1.push(
        await P({
          method: "POST",
          path: "/api/public/inquiries",
          headers: { "content-type": "application/json", "x-forwarded-for": ipA },
          body: inqBody(),
        }),
      );
    checks.push(
      chk(
        "form liên hệ: > 5 lần/10 phút/IP → 429 + Retry-After",
        checkRateLimited(r1, { expectBeforeLimit: 5 }),
        `${r1.map((r) => r.status).join(",")} ; ${evidenceLine("lần bị chặn", r1.find((r) => r.status === 429) ?? r1.at(-1), ["retry-after"])}`,
      ),
    );
    const r1b = await P({
      method: "POST",
      path: "/api/public/inquiries",
      headers: { "content-type": "application/json", "x-forwarded-for": "172.16.9.2" },
      body: inqBody(),
    });
    checks.push(
      chk(
        "giới hạn theo IP: IP khác không bị chặn lây",
        r1b.status === 201 ? [] : [`IP khác bị ${r1b.status}`],
        `IP khác → ${r1b.status}`,
      ),
    );
    const r2 = [];
    for (let i = 0; i < 8; i++)
      r2.push(
        await P({
          method: "POST",
          path: "/api/public/applications",
          headers: { "content-type": "application/json", "x-forwarded-for": "172.16.9.3" },
          body: JSON.stringify({
            submission_id: randomUUID(),
            name: "Ứng viên",
            email: "uv@dast.test",
            consent: true,
            elapsed_ms: 6000,
          }),
        }),
      );
    checks.push(
      chk(
        "form ứng tuyển: > 5 lần/10 phút/IP → 429 + Retry-After",
        checkRateLimited(r2, { expectBeforeLimit: 5 }),
        r2.map((r) => r.status).join(","),
      ),
    );
    const ipL = "172.16.9.4";
    const lg = (email, password, ip) =>
      P({
        method: "POST",
        path: "/api/app/auth/login",
        headers: { "content-type": "application/json", origin: plain.origin, "x-forwarded-for": ip },
        body: JSON.stringify({ email, password }),
      });
    const r3 = [];
    for (let i = 0; i < 8; i++) r3.push(await lg(U("ed").email, `sai-${i}-dast`, ipL));
    checks.push(
      chk(
        "đăng nhập sai: > 5 lần/15 phút/(email, IP) → 429 + Retry-After",
        checkRateLimited(r3, { expectBeforeLimit: 5 }),
        `${r3.map((r) => r.status).join(",")} ; ${evidenceLine("lần bị chặn", r3.find((r) => r.status === 429) ?? r3.at(-1), ["retry-after"])}`,
      ),
    );
    const locked = await lg(U("ed").email, seed.password, ipL);
    checks.push(
      chk(
        "khoá đăng nhập giữ: mật khẩu ĐÚNG từ cùng (email, IP) vẫn 429",
        locked.status === 429 ? [] : [`status ${locked.status} — bị khoá mà vẫn đăng nhập được`],
        evidenceLine("POST login (đúng mật khẩu, đang bị khoá)", locked, ["retry-after"]),
      ),
    );
    const other = await lg(U("ed").email, seed.password, "172.16.9.5");
    checks.push(
      chk(
        "khoá theo (email, IP): chủ tài khoản từ IP khác không bị khoá lây",
        other.status === 200 ? [] : [`status ${other.status}`],
        `IP khác → ${other.status}`,
      ),
    );
    // Giới hạn theo người dùng (60/phút/nhóm) — vòng tối đa 3 lượt vì cửa sổ căn theo đồng hồ.
    const s = sessions.sales;
    const phantom = randomUUID();
    const all = [];
    for (let round = 0; round < 3 && !all.some((r) => r.status === 429); round++) {
      const batch = await Promise.all(
        Array.from({ length: 62 }, () =>
          P({
            method: "POST",
            path: "/api/app/comments",
            headers: writeHeaders(s, plain.origin, { "idempotency-key": `dast-rl-${randomUUID()}` }),
            body: JSON.stringify({ object_type: "task", object_id: phantom, body: "x" }),
          }),
        ),
      );
      all.push(...batch);
    }
    checks.push(
      chk(
        "API ghi theo người dùng: > 60/phút → 429 + Retry-After",
        checkRateLimited(all),
        `${all.length} request song song; ${evidenceLine("lần bị chặn", all.find((r) => r.status === 429) ?? all.at(-1), ["retry-after"])}`,
      ),
    );
    // Idempotency
    const n2 = sessions.nv2;
    const mkOt = (key, minutes, date = otDate(20)) => ({
      method: "POST",
      path: "/api/app/ot-requests",
      headers: writeHeaders(n2, plain.origin, key === null ? {} : { "idempotency-key": key }),
      body: JSON.stringify({ business_date: date, minutes, reason: "kiểm idempotency", consent: true }),
    });
    const key = `dast-idem-${randomUUID()}`;
    const first = await P(mkOt(key, 30));
    const replay = await P(mkOt(key, 30));
    const reused = await P(mkOt(key, 45));
    const missing = await P(mkOt(null, 30));
    const key2 = `dast-idem-${randomUUID()}`;
    const concurrent = await Promise.all(Array.from({ length: 6 }, () => P(mkOt(key2, 25, otDate(21)))));
    checks.push(
      chk(
        "Idempotency-Key: tạo → phát lại nguyên văn; tái dùng khoá khác thân → 422; thiếu khoá → 400; song song cùng khoá → 1 lần chạy thật",
        checkIdempotency({ first, replay, reused, missing, concurrent }),
        `${first.status} / phát lại ${replay.status} (${replay.headers["idempotent-replayed"] ?? "-"}) / khoá tái dùng ${reused.status} / thiếu khoá ${missing.status} / song song ${concurrent.map((r) => r.status).join(",")}`,
      ),
    );
    return groupResult(groupRates.gid, groupRates.gtitle, groupRates.grefs, checks);
  },
  "DAST-H",
  "Giới hạn tần suất (429 + Retry-After) và Idempotency-Key",
  ["SEC-WEB-012", "BE-REL-006", "BE-API-008", "ARC-INT-001", "ASVS V2"],
);

// ---------------------------------------------------------------- vào chương trình
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      err(`DAST lỗi hạ tầng: ${e?.stack ?? e}`);
      process.exit(2);
    },
  );
}
