// Ứng dụng khách HTTP tối giản trên node:http (không phụ thuộc): kiểm soát đủ header thô (Origin, Cookie, X-Forwarded-For),
// không theo chuyển hướng, không giải nén — cần cho probe DAST và bộ tải. Không bao giờ ghi giá trị cookie/token ra log.
import http from "node:http";

/** Probe DAST/bộ tải chỉ được nhắm máy cục bộ hoặc tên staging khai trong ALLOWED_TEST_HOSTS (QA-PERF-007): không bao giờ gửi tải/payload tới production. */
export function assertLoopback(baseUrl) {
  const host = new URL(baseUrl).hostname;
  const extra = (process.env.ALLOWED_TEST_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  const ok =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "::1" ||
    extra.includes(host);
  if (!ok) throw new Error(`từ chối: ${host} không phải máy cục bộ/staging được phép (ALLOWED_TEST_HOSTS)`);
}

export function makeAgent(maxSockets = 64) {
  return new http.Agent({ keepAlive: true, maxSockets, maxFreeSockets: maxSockets });
}

/**
 * @param {string} baseUrl vd http://127.0.0.1:3200
 * @param {{method?:string, path:string, headers?:Record<string,string>, body?:string|Buffer|null, agent?:http.Agent, timeoutMs?:number}} o
 * @returns {Promise<{status:number, headers:Record<string,string>, setCookie:string[], body:string, ms:number}>}
 */
export function request(baseUrl, o) {
  assertLoopback(baseUrl);
  const u = new URL(baseUrl);
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: o.path, // đường dẫn THÔ: không chuẩn hoá `..`/`//`/`%2f` — probe cần gửi đúng như kẻ tấn công
        method: o.method ?? "GET",
        headers: {
          "accept-encoding": "identity",
          ...(o.body !== undefined && o.body !== null
            ? { "content-length": String(Buffer.byteLength(o.body)) }
            : {}),
          ...o.headers,
        },
        agent: o.agent,
        timeout: o.timeoutMs ?? 30_000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const headers = {};
          for (const [k, v] of Object.entries(res.headers))
            if (k !== "set-cookie") headers[k] = Array.isArray(v) ? v.join(", ") : String(v);
          resolve({
            status: res.statusCode ?? 0,
            headers,
            setCookie: res.headers["set-cookie"] ?? [],
            body: Buffer.concat(chunks).toString("utf8"),
            ms: performance.now() - started,
          });
        });
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (o.body !== undefined && o.body !== null) req.write(o.body);
    req.end();
  });
}

/** Phiên đăng nhập: cookie + CSRF token (trong bộ nhớ). */
export async function login(baseUrl, origin, email, password, extraHeaders = {}, opts = {}) {
  let r = await request(baseUrl, {
    method: "POST",
    path: "/api/app/auth/login",
    headers: { "content-type": "application/json", origin, ...extraHeaders },
    body: JSON.stringify({ email, password }),
  });
  if (r.status !== 200) throw new Error(`đăng nhập thất bại (${r.status})`);
  const first = JSON.parse(r.body);
  // Vai trò bắt buộc TOTP (AUD-SEC-002): đi tiếp bước mã bằng bí mật cố định của seed E2E (`opts.totpSecret`).
  // Dùng chung lõi thuần lib/identity/totp.pure.ts (Node ≥ 22.18 tự bỏ kiểu TS khi import).
  if (first.mfa) {
    if (!opts.totpSecret) throw new Error(`đăng nhập cần TOTP (${first.mfa}) nhưng không có totpSecret`);
    const { base32Decode, hotp, totpStep } = await import("../../lib/identity/totp.pure.ts");
    const secret = base32Decode(opts.totpSecret);
    // Bước hiện tại có thể đã dùng (chống phát lại) → thử bước kế (cửa sổ ±1).
    for (const off of [0, 1]) {
      r = await request(baseUrl, {
        method: "POST",
        path: "/api/app/auth/mfa",
        headers: { "content-type": "application/json", origin, ...extraHeaders },
        body: JSON.stringify({ challenge: first.challenge, code: hotp(secret, totpStep(Date.now()) + off) }),
      });
      if (r.status === 200) break;
    }
    if (r.status !== 200) throw new Error(`bước TOTP thất bại (${r.status})`);
  }
  const cookie = r.setCookie.map((c) => c.split(";")[0]).join("; ");
  const j = JSON.parse(r.body);
  return { cookie, csrf: j.csrf_token, userId: j.user_id, setCookie: r.setCookie };
}

/** Header cho request ghi của một phiên. */
export const writeHeaders = (s, origin, extra = {}) => ({
  "content-type": "application/json",
  origin,
  cookie: s.cookie,
  "x-csrf-token": s.csrf,
  ...extra,
});
