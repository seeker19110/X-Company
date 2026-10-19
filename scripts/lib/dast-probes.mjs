// Phần PHÂN TÍCH của DAST cục bộ (T-047): mọi hàm là hàm THUẦN nhận response giả `{status, headers, setCookie, body}`
// và trả danh sách lỗi (rỗng = đạt) — test đơn vị tests/unit/dast-baseline.test.ts chứng minh probe bắt được cái xấu
// (không chỉ đạt khi mọi thứ tốt). Phần gửi request thật ở scripts/dast-baseline.mjs.

// ---------- CSP & header ----------

/** "a b; c 'self'" → Map(directive → tokens[]). Chỉ lấy lần xuất hiện ĐẦU của mỗi directive (trình duyệt làm vậy). */
export function parseCsp(csp) {
  const m = new Map();
  for (const part of String(csp ?? "").split(";")) {
    const [name, ...tokens] = part.trim().split(/\s+/);
    if (name !== undefined && name !== "" && !m.has(name.toLowerCase())) m.set(name.toLowerCase(), tokens);
  }
  return m;
}

/** Nonce trong script-src của CSP, hoặc null. */
export function cspNonce(csp) {
  const t = parseCsp(csp).get("script-src") ?? [];
  const n = t.find((x) => /^'nonce-[A-Za-z0-9+/=_-]{16,}'$/.test(x));
  return n === undefined ? null : n.slice(7, -1);
}

const REFERRER_OK = new Set([
  "no-referrer",
  "same-origin",
  "strict-origin",
  "strict-origin-when-cross-origin",
]);

/** Lỗi CSP cho tài liệu HTML. */
export function checkCsp(csp) {
  const errs = [];
  if (csp === undefined || csp === "") return ["thiếu Content-Security-Policy"];
  const d = parseCsp(csp);
  const script = d.get("script-src");
  if (script === undefined) errs.push("CSP thiếu script-src (dựa vào default-src)");
  else {
    if (cspNonce(csp) === null) errs.push("script-src không có nonce");
    for (const bad of ["'unsafe-inline'", "'unsafe-eval'", "*", "data:", "http:", "https:"])
      if (script.includes(bad)) errs.push(`script-src chứa ${bad}`);
    if (
      script.some((x) => /^'sha(256|384|512)-/.test(x)) === false &&
      !script.includes("'strict-dynamic'") &&
      !script.includes("'self'")
    )
      errs.push("script-src không giới hạn nguồn");
  }
  if (!d.has("default-src")) errs.push("CSP thiếu default-src");
  const fa = d.get("frame-ancestors");
  if (fa === undefined) errs.push("CSP thiếu frame-ancestors");
  else if (!(fa.length === 1 && (fa[0] === "'none'" || fa[0] === "'self'")))
    errs.push("frame-ancestors quá rộng");
  const obj = d.get("object-src");
  if (obj === undefined || !obj.includes("'none'")) errs.push("object-src không phải 'none'");
  const base = d.get("base-uri");
  if (base === undefined || !(base.includes("'none'") || base.includes("'self'")))
    errs.push("base-uri không bị khoá");
  const fo = d.get("form-action");
  if (fo === undefined || fo.some((x) => x === "*" || x === "http:")) errs.push("form-action thiếu/quá rộng");
  return errs;
}

/**
 * Header bảo mật theo loại response.
 * kind: "html" (tài liệu), "api" (JSON), "asset" (tĩnh). `https`: instance chạy với APP_ORIGIN https.
 */
export function checkSecurityHeaders(res, { https, kind }) {
  const h = res.headers;
  const errs = [];
  if (kind === "html") {
    errs.push(...checkCsp(h["content-security-policy"]));
    const xfo = (h["x-frame-options"] ?? "").toUpperCase();
    if (xfo !== "DENY" && xfo !== "SAMEORIGIN") errs.push("thiếu/sai X-Frame-Options");
    if ((h["permissions-policy"] ?? "") === "") errs.push("thiếu Permissions-Policy");
    if ((h["cross-origin-opener-policy"] ?? "") === "") errs.push("thiếu Cross-Origin-Opener-Policy");
    if (!/^text\/html/i.test(h["content-type"] ?? ""))
      errs.push(`Content-Type không phải HTML: ${h["content-type"] ?? "(không có)"}`);
  }
  if (kind === "html" || kind === "api") {
    if ((h["x-content-type-options"] ?? "").toLowerCase() !== "nosniff")
      errs.push("thiếu X-Content-Type-Options: nosniff");
  }
  if (kind === "html") {
    const rp = (h["referrer-policy"] ?? "").toLowerCase();
    if (rp === "" || !REFERRER_OK.has(rp))
      errs.push(`Referrer-Policy yếu/thiếu: ${rp === "" ? "(không có)" : rp}`);
  }
  if (kind === "api") {
    const ct = h["content-type"] ?? "";
    if (!/^application\/(json|problem\+json)|^text\/plain/i.test(ct) && res.body !== "" && res.status !== 204)
      errs.push(`API trả Content-Type không phải JSON: ${ct === "" ? "(không có)" : ct}`);
  }
  if (https && (kind === "html" || kind === "api")) {
    const hsts = h["strict-transport-security"] ?? "";
    const age = Number(/max-age=(\d+)/i.exec(hsts)?.[1] ?? "0");
    if (age < 15_552_000)
      errs.push(`HSTS thiếu hoặc max-age < 180 ngày: ${hsts === "" ? "(không có)" : hsts}`);
  }
  if ((h["x-powered-by"] ?? "") !== "") errs.push(`lộ X-Powered-By: ${h["x-powered-by"]}`);
  if (/\d+\.\d+/.test(h.server ?? "")) errs.push(`Server lộ phiên bản: ${h.server}`);
  return errs;
}

/** Nonce trong header khớp MỌI thẻ <script> của HTML (strict-dynamic: script không nonce bị chặn nhưng cũng là dấu hiệu chèn). */
export function checkNonceUse(html, csp) {
  const nonce = cspNonce(csp);
  if (nonce === null) return ["không có nonce để đối chiếu"];
  const errs = [];
  const scripts = tokenize(html).filter((t) => t.tag === "script");
  if (scripts.length === 0) errs.push("trang không có <script> nào (Next luôn nhúng) — không đối chiếu được");
  for (const s of scripts) {
    const type = (s.attrs.type ?? "").toLowerCase();
    if (type === "application/json" || type === "application/ld+json") continue;
    if (s.attrs.nonce !== nonce)
      errs.push(
        `<script> thiếu/sai nonce${s.attrs.src === undefined ? " (inline)" : ` (src=${s.attrs.src.slice(0, 60)})`}`,
      );
  }
  return errs;
}

// ---------- cookie ----------

/** Phân tích một dòng Set-Cookie. */
export function parseSetCookie(line) {
  const [nv, ...attrs] = line.split(";").map((x) => x.trim());
  const i = nv.indexOf("=");
  const c = { name: nv.slice(0, i), value: nv.slice(i + 1), flags: new Set(), attrs: {} };
  for (const a of attrs) {
    const j = a.indexOf("=");
    if (j < 0) c.flags.add(a.toLowerCase());
    else c.attrs[a.slice(0, j).toLowerCase()] = a.slice(j + 1);
  }
  return c;
}

/** Cookie phiên khi đăng nhập thành công. */
export function checkSessionCookie(setCookie, { https }) {
  const errs = [];
  const cs = setCookie.map(parseSetCookie).filter((c) => /session/i.test(c.name));
  if (cs.length !== 1) return [`cần đúng 1 cookie phiên, thấy ${cs.length}`];
  const c = cs[0];
  if (!c.flags.has("httponly")) errs.push("thiếu HttpOnly");
  const ss = (c.attrs.samesite ?? "").toLowerCase();
  if (ss !== "lax" && ss !== "strict")
    errs.push(`SameSite phải Lax/Strict, thấy ${ss === "" ? "(không có)" : ss}`);
  if ((c.attrs.path ?? "") !== "/") errs.push("Path phải là /");
  if (c.attrs.domain !== undefined) errs.push("không được đặt Domain (cookie lan sang subdomain)");
  if (c.attrs["max-age"] === undefined && c.attrs.expires === undefined)
    errs.push("cookie phiên không có hạn (Max-Age/Expires)");
  if (c.value.length < 32) errs.push("giá trị phiên ngắn (< 32 ký tự)");
  if (https) {
    if (!c.flags.has("secure")) errs.push("https nhưng thiếu Secure");
    if (!c.name.startsWith("__Host-")) errs.push("https nhưng cookie không có tiền tố __Host-");
  } else if (c.name.startsWith("__Host-")) errs.push("tiền tố __Host- trên http sẽ bị trình duyệt từ chối");
  return errs;
}

/** Cookie bị xoá (đăng xuất): Max-Age=0 hoặc Expires quá khứ, giá trị rỗng. */
export function checkCookieCleared(setCookie) {
  const cs = setCookie.map(parseSetCookie).filter((c) => /session/i.test(c.name));
  if (cs.length !== 1) return [`cần đúng 1 cookie phiên bị xoá, thấy ${cs.length}`];
  const c = cs[0];
  const gone =
    c.attrs["max-age"] === "0" || (c.attrs.expires !== undefined && Date.parse(c.attrs.expires) < Date.now());
  return [
    ...(gone ? [] : ["cookie không bị xoá khi đăng xuất"]),
    ...(c.value === "" ? [] : ["cookie xoá còn giá trị"]),
  ];
}

// ---------- HTML / XSS ----------

const VOID_RAW = new Set(["script", "style", "textarea", "title"]);

/** Giải entity số/tên thông dụng và bỏ ký tự trình duyệt bỏ khi tách scheme. */
export function normalizeUrlAttr(v) {
  let s = String(v);
  for (let i = 0; i < 3; i++) {
    const n = s.replace(
      /&(?:#x([0-9a-f]+)|#(\d+)|(colon|tab|newline|lt|gt|quot|amp));?/gi,
      (m, h, d, name) => {
        if (h !== undefined) return String.fromCodePoint(parseInt(h, 16) || 0x20);
        if (d !== undefined) return String.fromCodePoint(parseInt(d, 10) || 0x20);
        return { colon: ":", tab: "\t", newline: "\n", lt: "<", gt: ">", quot: '"', amp: "&" }[
          name.toLowerCase()
        ];
      },
    );
    if (n === s) break;
    s = n;
  }
  return s.replace(/[\x00-\x20\x7f-\x9f\u00ad\u200b-\u200f\u2028\u2029\u2060\ufeff]/g, "").toLowerCase();
}

/** Bộ tách thẻ đơn giản (đủ cho HTML do máy sinh): [{tag, attrs, raw, body?}]. Bỏ chú thích; script/style lấy cả thân. */
export function tokenize(html) {
  const out = [];
  const re = /<!--[\s\S]*?-->|<([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1] === undefined) continue;
    const tag = m[1].toLowerCase();
    const attrs = {};
    const are = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let a;
    while ((a = are.exec(m[2])) !== null) {
      const k = a[1].toLowerCase();
      if (!(k in attrs)) attrs[k] = a[2] ?? a[3] ?? a[4] ?? "";
    }
    const tok = { tag, attrs, raw: m[0] };
    if (VOID_RAW.has(tag)) {
      const end = html.toLowerCase().indexOf(`</${tag}`, re.lastIndex);
      if (end >= 0) {
        tok.body = html.slice(re.lastIndex, end);
        re.lastIndex = end;
      }
    }
    out.push(tok);
  }
  return out;
}

const URL_ATTRS = [
  "href",
  "src",
  "action",
  "formaction",
  "xlink:href",
  "data",
  "poster",
  "background",
  "srcset",
  "ping",
];
const EMBED_TAGS = new Set(["iframe", "object", "embed", "applet", "frame", "frameset", "base"]);

/**
 * Tìm dấu hiệu payload thực thi/thoát escape trong HTML. `markers`: chuỗi MK-… đã gài trong payload.
 * opts.checkNonce=false cho DOM sau hydrate (trình duyệt xoá giá trị nonce khỏi DOM).
 */
export function analyzeHtmlForXss(html, { markers = [] } = {}) {
  const errs = [];
  const toks = tokenize(html);
  for (const t of toks) {
    for (const k of Object.keys(t.attrs)) {
      if (/^on/i.test(k)) errs.push(`<${t.tag}> có thuộc tính xử lý sự kiện ${k}`);
      if (k === "data-mk") errs.push(`phần tử bị chèn: <${t.tag} data-mk="${t.attrs[k]}">`);
      if (k === "srcdoc") errs.push(`<${t.tag}> có srcdoc`);
      if (URL_ATTRS.includes(k)) {
        const v = normalizeUrlAttr(t.attrs[k]);
        if (/^(javascript|vbscript):/.test(v) || /^data:(text\/html|application\/xhtml|image\/svg)/.test(v))
          errs.push(`<${t.tag} ${k}> trỏ tới scheme nguy hiểm: ${String(t.attrs[k]).slice(0, 60)}`);
      }
      if (k === "style" && /expression\s*\(|javascript:|url\(\s*['"]?\s*javascript/i.test(t.attrs[k]))
        errs.push(`<${t.tag}> style nguy hiểm`);
    }
    if (EMBED_TAGS.has(t.tag)) errs.push(`thẻ nhúng <${t.tag}> xuất hiện`);
    if (
      t.tag === "meta" &&
      (t.attrs["http-equiv"] ?? "").toLowerCase() === "refresh" &&
      /javascript:/i.test(t.attrs.content ?? "")
    )
      errs.push("meta refresh tới javascript:");
    if (t.tag === "script" && t.body !== undefined && markers.some((m) => t.body.includes(m))) {
      const type = (t.attrs.type ?? "").toLowerCase();
      // Thân script dữ liệu (RSC/JSON) chứa marker dạng chuỗi đã thoát là bình thường; chỉ lỗi khi nó chứa thẻ thô.
      if (/<\/?script|<img|<svg|<iframe/i.test(t.body) && type !== "")
        errs.push("thân script dữ liệu chứa thẻ HTML thô");
    }
  }
  // Payload thô lọt ra ngoài thân script: chuỗi chứa `<tag data-mk=` hay `<script …MK-` chưa bị escape.
  const outside = stripScriptElements(html);
  for (const m of markers) {
    const idx = outside.indexOf(m);
    if (idx >= 0) {
      const before = outside.slice(Math.max(0, idx - 200), idx);
      const lt = before.lastIndexOf("<");
      const gt = before.lastIndexOf(">");
      // marker nằm trong một thẻ chưa đóng (lt > gt) = đã thoát khỏi ngữ cảnh text/thuộc tính ngoài ý muốn.
      const tag = before.slice(lt);
      const insideQuotedAttr = /^<[a-z]+\s/i.test(tag) && (tag.split('"').length - 1) % 2 === 1; // trong giá trị thuộc tính đang mở
      const lowerTag = tag.toLowerCase();
      if (lt > gt && !insideQuotedAttr && !lowerTag.startsWith("<title") && !lowerTag.startsWith("<meta"))
        errs.push(`marker ${m} nằm trong thẻ HTML thô`);
    }
  }
  return [...new Set(errs)];
}

// ---------- rò thông tin lỗi ----------

const LEAK_PATTERNS = [
  [/(?:\n|\\n)\s+at\s+[^\n"]*\([^)]*:\d+:\d+\)/, "stack trace (at … file:dòng:cột)"],
  [/\bat\s+(?:async\s+)?\S+\s+\(node:/, "stack trace nội bộ Node"],
  [/node_modules[\\/]/, "đường dẫn node_modules"],
  [/\/home\/[a-z0-9_-]+\//i, "đường dẫn /home/…"],
  [/\b[A-Za-z]:\\(?:Users|Windows)\\/, "đường dẫn Windows"],
  [/\/(?:usr|var|opt|srv|tmp|root)\/[a-z0-9._-]+\//i, "đường dẫn hệ thống tệp"],
  [/\.next\/(?:server|static)\//, "đường dẫn .next nội bộ"],
  [/\b(?:SELECT|INSERT INTO|UPDATE|DELETE FROM)\b[^"\n]{0,80}\b(?:FROM|VALUES|SET|WHERE)\b/, "câu SQL"],
  [
    /\b(?:syntax error at or near|relation "[^"]+" does not exist|column "[^"]+" does not exist|violates (?:foreign key|unique|check) constraint|duplicate key value)/i,
    "thông điệp lỗi PostgreSQL",
  ],
  [
    /\bpg_[a-z_]+|\bSQLSTATE\b|\bECONNREFUSED\b|\bECONNRESET\b|password authentication failed/i,
    "chi tiết kết nối/driver DB",
  ],
  [/postgres(?:ql)?:\/\/[^\s"']+/i, "chuỗi kết nối DB"],
  [/\b(?:TypeError|ReferenceError|RangeError|SyntaxError|AggregateError): /, "tên lỗi JS thô"],
  [/\bZodError\b|"code"\s*:\s*"invalid_type"/, "lỗi nội bộ của thư viện validate (zod)"],
  [/Error: [^\n"]{3,}(?:\n|\\n)\s+at /, "lỗi kèm stack"],
];

/** Chuỗi lộ chi tiết nội bộ trong một thân phản hồi. */
export function leakFindings(text) {
  const out = [];
  for (const [re, what] of LEAK_PATTERNS) if (re.test(text)) out.push(what);
  return out;
}

/** Phản hồi lỗi theo RFC 9457: loại nội dung, trường bắt buộc, không rò rỉ. */
export function checkProblem(res, expectedStatus) {
  const errs = [];
  if (expectedStatus !== undefined && res.status !== expectedStatus)
    errs.push(`status ${res.status} ≠ ${expectedStatus}`);
  const ct = res.headers["content-type"] ?? "";
  if (!/^application\/problem\+json/i.test(ct))
    errs.push(`Content-Type ${ct === "" ? "(không có)" : ct} ≠ application/problem+json`);
  let j;
  try {
    j = JSON.parse(res.body);
  } catch {
    return [...errs, "thân không phải JSON"];
  }
  for (const k of ["type", "title", "status", "detail", "instance"])
    if (!(k in j)) errs.push(`thiếu trường RFC 9457 "${k}"`);
  if (j.status !== undefined && j.status !== res.status) errs.push("trường status không khớp mã HTTP");
  for (const k of ["stack", "stacktrace", "sql", "query", "trace", "file", "path", "cause"])
    if (k in j) errs.push(`thân có trường nội bộ "${k}"`);
  for (const l of leakFindings(res.body)) errs.push(`rò: ${l}`);
  if ((res.headers["cache-control"] ?? "").includes("no-store") === false)
    errs.push("lỗi API không có Cache-Control: no-store");
  return errs;
}

// ---------- chuyển hướng ----------

/** Vị trí chuyển hướng phải cùng nguồn (đường dẫn tương đối hoặc cùng host:port); host lạ = open redirect. */
export function checkRedirectTarget(res, baseUrl, { allowedOrigins = [], evilHosts = ["evil.test"] } = {}) {
  if (res.status < 300 || res.status > 399) return [];
  const loc = res.headers.location;
  if (loc === undefined || loc === "") return [];
  let u;
  try {
    u = new URL(loc, baseUrl);
  } catch {
    return [`Location không phân tích được: ${loc}`];
  }
  const b = new URL(baseUrl);
  const errs = [];
  if (u.host !== b.host && !allowedOrigins.includes(u.origin))
    errs.push(`chuyển hướng ra ngoài nguồn: ${loc}`);
  if (evilHosts.some((h) => u.hostname.includes(h)))
    errs.push(`Location trỏ tới host của kẻ tấn công: ${loc}`);
  if (/^(\/\/|\/\\|\\\\)/.test(loc)) errs.push(`Location kiểu protocol-relative: ${loc}`);
  return errs;
}

// ---------- đường dẫn nhạy cảm ----------

const SECRET_MARKERS = [
  /DATABASE_URL\s*=/,
  /SESSION_SECRET\s*=/,
  /QR_SIGNING_KEYS\s*=/,
  /^\[core\]/m,
  /^ref: refs\//m,
  /"name"\s*:\s*"x-company"/,
  /sourceMappingURL=/,
  /"sourcesContent"/,
  /BEGIN (?:RSA |EC )?PRIVATE KEY/,
  /CREATE TABLE/i,
];

/** Đường dẫn không được phục vụ: status không phải 2xx và thân không chứa dấu hiệu bí mật/mã nguồn. */
export function checkNotServed(res, { allowRedirectToLogin = false } = {}) {
  const errs = [];
  const ok =
    res.status === 404 ||
    res.status === 403 ||
    res.status === 401 ||
    res.status === 400 ||
    res.status === 405 ||
    (allowRedirectToLogin &&
      res.status >= 300 &&
      res.status < 400 &&
      /\/app\/login$/.test(res.headers.location ?? ""));
  if (!ok) errs.push(`status ${res.status} (cần 404/401/403/400)`);
  for (const re of SECRET_MARKERS) if (re.test(res.body)) errs.push(`thân chứa dấu hiệu nhạy cảm ${re}`);
  return errs;
}

/** Trang dùng `//# sourceMappingURL=` hoặc *.map phục vụ công khai. */
export function checkSourceMapNotPublic(jsRes, mapRes) {
  const errs = [];
  if (/\/\/[#@]\s*sourceMappingURL=/.test(jsRes.body)) errs.push("tệp JS còn tham chiếu sourceMappingURL");
  if (mapRes.status === 200) errs.push(".map được phục vụ công khai (200)");
  if (/"sourcesContent"|"mappings"/.test(mapRes.body)) errs.push(".map chứa mã nguồn/ánh xạ");
  return errs;
}

// ---------- giới hạn tần suất / idempotency ----------

/** Dãy phản hồi từ vòng bắn liên tiếp: cần ≥ 1 mã 429, mỗi 429 có Retry-After số nguyên ≥ 1, không có 5xx. */
export function checkRateLimited(responses, { expectBeforeLimit = 0 } = {}) {
  const errs = [];
  const limited = responses.filter((r) => r.status === 429);
  if (limited.length === 0) errs.push(`không có 429 sau ${responses.length} lần gửi`);
  for (const r of limited) {
    const ra = r.headers["retry-after"];
    if (ra === undefined || !/^\d+$/.test(ra) || Number(ra) < 1)
      errs.push(`429 thiếu Retry-After hợp lệ (${ra ?? "không có"})`);
  }
  if (responses.some((r) => r.status >= 500)) errs.push("có phản hồi 5xx khi vượt giới hạn");
  const firstLimited = responses.findIndex((r) => r.status === 429);
  if (firstLimited >= 0 && firstLimited < expectBeforeLimit)
    errs.push(`bị chặn quá sớm (lần ${firstLimited + 1} < ${expectBeforeLimit})`);
  return errs;
}

/** Idempotency: lần đầu tạo, lần lặp phát lại nguyên văn (cùng thân + cờ), khoá tái dùng khác thân → 422, thiếu khoá → 400. */
export function checkIdempotency({ first, replay, reused, missing, concurrent }) {
  const errs = [];
  if (first.status < 200 || first.status > 299) errs.push(`lần đầu không 2xx (${first.status})`);
  if (replay.status !== first.status) errs.push(`phát lại đổi status ${first.status}→${replay.status}`);
  if (replay.body !== first.body) errs.push("phát lại không nguyên văn thân lần đầu");
  if (replay.headers["idempotent-replayed"] !== "true")
    errs.push("thiếu header Idempotent-Replayed: true khi phát lại");
  if (reused.status !== 422) errs.push(`tái dùng khoá với thân khác phải 422, thấy ${reused.status}`);
  if (missing.status !== 400) errs.push(`thiếu Idempotency-Key phải 400, thấy ${missing.status}`);
  if (concurrent !== undefined) {
    const created = concurrent.filter(
      (r) => r.status >= 200 && r.status < 300 && r.headers["idempotent-replayed"] !== "true",
    );
    if (created.length !== 1)
      errs.push(`gửi song song cùng khoá: cần đúng 1 lần chạy thật, thấy ${created.length}`);
    const ids = new Set(concurrent.filter((r) => r.status >= 200 && r.status < 300).map((r) => r.body));
    if (ids.size > 1) errs.push("gửi song song cùng khoá cho nhiều kết quả khác nhau (trùng bản ghi)");
    if (concurrent.some((r) => r.status >= 500)) errs.push("gửi song song cùng khoá gây 5xx");
  }
  return errs;
}

// ---------- CSRF / CORS / BOLA ----------

/** Request ghi bị từ chối bởi lớp CSRF: 403 mã CSRF, không có tác dụng phụ. */
export function checkCsrfRejected(res) {
  const errs = [];
  if (res.status !== 403) errs.push(`status ${res.status} (cần 403)`);
  else {
    let code = "";
    try {
      code = JSON.parse(res.body).code ?? "";
    } catch {
      /* thân không JSON */
    }
    if (code !== "CSRF") errs.push(`mã lỗi "${code}" ≠ CSRF`);
  }
  return errs;
}

/** CORS: không phản chiếu Origin lạ, không `*` cùng credential. */
export function checkCors(res, evilOrigin) {
  const h = res.headers;
  const errs = [];
  const acao = h["access-control-allow-origin"];
  if (acao !== undefined && (acao === "*" || acao === evilOrigin))
    errs.push(`Access-Control-Allow-Origin: ${acao} cho origin lạ`);
  if ((h["access-control-allow-credentials"] ?? "").toLowerCase() === "true" && acao !== undefined)
    errs.push("Allow-Credentials: true kèm ACAO");
  return errs;
}

/** Truy cập chéo người dùng (BOLA/IDOR): từ chối bằng 403/404 và KHÔNG chứa dữ liệu của nạn nhân. */
export function checkDenied(res, secrets = []) {
  const errs = [];
  if (![401, 403, 404].includes(res.status)) errs.push(`status ${res.status} (cần 401/403/404)`);
  for (const s of secrets)
    if (s !== "" && res.body.includes(s)) errs.push("phản hồi chứa dữ liệu của người dùng khác");
  return errs;
}

// ---------- báo cáo ----------

/** Rút gọn + che bí mật trong bằng chứng (cookie, token, chuỗi dài giống khoá). */
export function redact(s) {
  return String(s)
    .replace(/((?:__Host-)?xc_session=)[^;\s"]+/g, "$1<đã-che>")
    .replace(
      /("?(?:csrf_token|x-csrf-token|authorization)"?\s*[:=]\s*"?)[A-Za-z0-9._~+/=-]{12,}/gi,
      "$1<đã-che>",
    )
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "<đã-che>")
    .replace(/nonce-[A-Za-z0-9+/=_-]{8,}/g, "nonce-<n>");
}

export const clip = (s, n = 140) => {
  const t = redact(s).replace(/\s+/g, " ");
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/** Một dòng bằng chứng request → response. */
export function evidenceLine(req, res, pickHeaders = []) {
  const hs = pickHeaders
    .filter((k) => res.headers[k] !== undefined)
    .map((k) => `${k}: ${clip(res.headers[k], 90)}`)
    .join("; ");
  return `${req} → ${res.status}${hs === "" ? "" : ` [${hs}]`}${res.body !== "" && res.status >= 400 ? ` ${clip(res.body, 100)}` : ""}`;
}

/** @typedef {{name:string, ok:boolean, evidence:string, errors:string[]}} Check */

/** Gộp các check thành kết quả nhóm: PASS khi mọi check đạt. */
export function groupResult(id, title, refs, checks) {
  return {
    id,
    title,
    refs,
    status: checks.length > 0 && checks.every((c) => c.ok) ? "PASS" : "FAIL",
    checks,
  };
}

export function renderReport(meta, groups) {
  const fails = groups.filter((g) => g.status === "FAIL").length;
  const L = [];
  L.push("---");
  L.push("title: Báo cáo DAST cục bộ — X-Company");
  L.push(`updated: ${meta.date}`);
  L.push(
    `status: ${fails === 0 ? "PASS" : "FAIL"} — faithful-fixture, máy dev (sinh bằng \`npm run -s dast\`; không sửa tay)`,
  );
  L.push("---");
  L.push("");
  L.push("# Báo cáo DAST cục bộ (T-047, SEC-WEB-004)");
  L.push("");
  L.push(
    "> **Nhãn bằng chứng: faithful-fixture.** Bộ probe tự viết (Node thuần + Chromium của Playwright) tấn công bản build production",
  );
  L.push(
    "> (`next start`) trên máy dev với Postgres tạm và dữ liệu seed. **Không phải** quét hạ tầng production/staging thật, **không phải** ZAP,",
  );
  L.push("> và không thay pentest. Sinh lại: `npm run -s dast`.");
  L.push("");
  L.push("| Mục | Giá trị |");
  L.push("|---|---|");
  L.push(`| Ngày (UTC) | ${meta.date} |`);
  L.push(`| Commit | \`${meta.commit}\` |`);
  L.push(
    `| Môi trường | máy dev: ${meta.env.os}; ${meta.env.cpus}; ${meta.env.memGiB} GiB RAM; Node ${meta.env.node}; Next ${meta.env.next}; ${meta.env.psql ?? "PostgreSQL tạm (initdb)"} |`,
  );
  L.push(
    `| Đích | \`next start\` bản build production, 127.0.0.1:${meta.port} (http) + instance thứ hai ${meta.port + 1} với \`APP_ORIGIN=https://…\` để kiểm HSTS/Secure/__Host- (TLS không chấm dứt ở Node — mô phỏng proxy TLS) |`,
  );
  L.push(
    `| Cấu hình đặc biệt | \`TRUST_PROXY_HOPS=1\` (mỗi nhóm probe dùng X-Forwarded-For riêng để không giành bộ đếm giới hạn); \`METRICS_TOKEN\` ngẫu nhiên đặt để kiểm 401 |`,
  );
  L.push(`| Trình duyệt | ${meta.browser} |`);
  L.push(
    `| Tổng | ${groups.length} nhóm: ${groups.length - fails} PASS, ${fails} FAIL; ${meta.checkTotal} kiểm tra, ${meta.requestTotal} request |`,
  );
  L.push("");
  L.push("| Nhóm | Kết quả | Mục blueprint/chuẩn |");
  L.push("|---|---|---|");
  for (const g of groups) L.push(`| ${g.id} ${g.title} | **${g.status}** | ${g.refs.join(", ")} |`);
  L.push("");
  for (const g of groups) {
    L.push(`## ${g.id} — ${g.title}: ${g.status}`);
    L.push("");
    L.push(`Tham chiếu: ${g.refs.join(", ")}`);
    L.push("");
    L.push("| Kiểm tra | Kết quả | Bằng chứng (rút gọn, đã che bí mật) |");
    L.push("|---|---|---|");
    for (const c of g.checks) {
      const ev = c.ok ? c.evidence : `${c.evidence}<br>LỖI: ${c.errors.join("; ")}`;
      L.push(
        `| ${c.name} | ${c.ok ? "PASS" : "**FAIL**"} | ${ev.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ")} |`,
      );
    }
    L.push("");
  }
  L.push("## Không chứng minh");
  L.push("");
  for (const x of meta.notProven) L.push(`- ${x}`);
  L.push("");
  return L.join("\n");
}

/**
 * Bỏ mọi phần tử <script>…</script> bằng quét thủ tục (không regex): chịu được `</script >`, `</script foo="bar">`, chữ hoa/
 * thường lẫn lộn, và thẻ đóng thiếu (bỏ tới hết chuỗi — an toàn: phần bị bỏ chỉ làm probe bớt nhạy, không tạo FAIL giả).
 */
export function stripScriptElements(html) {
  const lower = html.toLowerCase();
  let out = "";
  let i = 0;
  for (;;) {
    const open = lower.indexOf("<script", i);
    if (open < 0) return out + html.slice(i);
    const after = lower.charAt(open + 7);
    if (after !== "" && !/[\s/>]/.test(after)) {
      out += html.slice(i, open + 7);
      i = open + 7;
      continue;
    }
    out += html.slice(i, open);
    const close = lower.indexOf("</script", open + 7);
    if (close < 0) return out;
    const gt = lower.indexOf(">", close);
    if (gt < 0) return out;
    i = gt + 1;
  }
}
