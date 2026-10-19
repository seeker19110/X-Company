/* eslint-disable @typescript-eslint/strict-boolean-expressions -- giá trị `any` trả về từ script .mjs thuần JS không có khai báo kiểu */
// T-047: phần phân tích của DAST cục bộ là hàm thuần — chứng minh probe BẮT được cái xấu (không chỉ xanh khi mọi thứ tốt).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import * as P from "../../scripts/lib/dast-probes.mjs";

type Res = { status: number; headers: Record<string, string>; setCookie: string[]; body: string };
const res = (o: Partial<Res> = {}): Res => ({ status: 200, headers: {}, setCookie: [], body: "", ...o });
const NONCE = "YmY3N2Q3M2YtZjU1Yy00OGQ0LWEwYWYtOTVhMzRmNTA5OWYy";
const GOOD_CSP = `default-src 'self'; script-src 'self' 'nonce-${NONCE}' 'strict-dynamic'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'`;
const goodHtml = (): Res =>
  res({
    headers: {
      "content-security-policy": GOOD_CSP,
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "permissions-policy": "camera=(self)",
      "cross-origin-opener-policy": "same-origin",
      "content-type": "text/html; charset=utf-8",
      "strict-transport-security": "max-age=31536000; includeSubDomains",
    },
  });

describe("header bảo mật", () => {
  test("đạt khi đủ; bắt từng thiếu sót", () => {
    assert.deepEqual(P.checkSecurityHeaders(goodHtml(), { https: true, kind: "html" }), []);
    const drop = (k: string) => {
      const r = goodHtml();
      delete r.headers[k];
      return P.checkSecurityHeaders(r, { https: true, kind: "html" }) as string[];
    };
    for (const k of [
      "content-security-policy",
      "x-frame-options",
      "x-content-type-options",
      "referrer-policy",
      "permissions-policy",
      "strict-transport-security",
    ])
      assert.ok(drop(k).length > 0, `thiếu ${k} phải bị bắt`);
    assert.deepEqual(
      P.checkSecurityHeaders(
        { ...goodHtml(), headers: { ...goodHtml().headers, "strict-transport-security": "" } },
        { https: false, kind: "html" },
      ),
      [],
    );
  });
  test("CSP: unsafe-inline/eval, thiếu nonce, frame-ancestors rộng", () => {
    const bad = (csp: string) => P.checkCsp(csp) as string[];
    assert.ok(
      bad(GOOD_CSP.replace("'strict-dynamic'", "'unsafe-inline'")).some((e) => e.includes("unsafe-inline")),
    );
    assert.ok(
      bad(GOOD_CSP.replace("'strict-dynamic'", "'unsafe-eval'")).some((e) => e.includes("unsafe-eval")),
    );
    assert.ok(bad(GOOD_CSP.replace(`'nonce-${NONCE}'`, "")).some((e) => e.includes("nonce")));
    assert.ok(bad(GOOD_CSP.replace("frame-ancestors 'none'", "frame-ancestors *")).length > 0);
    assert.deepEqual(bad(""), ["thiếu Content-Security-Policy"]);
  });
  test("nonce: mọi <script> phải mang nonce của header", () => {
    const ok = `<script nonce="${NONCE}">1</script><script nonce="${NONCE}" src="/a.js"></script><script type="application/json">{}</script>`;
    assert.deepEqual(P.checkNonceUse(ok, GOOD_CSP), []);
    assert.equal(P.checkNonceUse(`${ok}<script>alert(1)</script>`, GOOD_CSP).length, 1);
    assert.equal(P.checkNonceUse(`<script nonce="sai">1</script>`, GOOD_CSP).length, 1);
  });
});

describe("cookie", () => {
  const good = `xc_session=${"a".repeat(40)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`;
  test("cookie tốt qua; thiếu cờ bị bắt; https đòi Secure + __Host-", () => {
    assert.deepEqual(P.checkSessionCookie([good], { https: false }), []);
    assert.ok(P.checkSessionCookie([good.replace("; HttpOnly", "")], { https: false }).length > 0);
    assert.ok(P.checkSessionCookie([good.replace("Lax", "None")], { https: false }).length > 0);
    assert.ok(P.checkSessionCookie([`${good}; Domain=x.vn`], { https: false }).length > 0);
    assert.ok(P.checkSessionCookie([good], { https: true }).length >= 2);
    const host = `__Host-xc_session=${"a".repeat(40)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=60`;
    assert.deepEqual(P.checkSessionCookie([host], { https: true }), []);
    assert.equal(P.checkSessionCookie([], { https: false }).length, 1);
  });
  test("cookie xoá khi đăng xuất", () => {
    assert.deepEqual(P.checkCookieCleared(["xc_session=; Path=/; Max-Age=0"]), []);
    assert.ok(P.checkCookieCleared([`xc_session=abc; Max-Age=600`]).length > 0);
  });
});

describe("XSS", () => {
  test("HTML an toàn (payload đã escape) qua", () => {
    const html = `<p>&lt;script data-mk=&quot;MK-1&quot;&gt;x&lt;/script&gt;</p><meta name="d" content="&quot;&gt;&lt;script data-mk=&quot;MK-2&quot;&gt;"><a href="https://a.vn">a</a>`;
    assert.deepEqual(P.analyzeHtmlForXss(html, { markers: ["MK-1", "MK-2"] }), []);
  });
  test("bắt handler, phần tử chèn, scheme nguy hiểm (kể cả giấu), iframe, thoát thuộc tính", () => {
    const f = (h: string) => P.analyzeHtmlForXss(h, { markers: ["MK-1"] }) as string[];
    assert.ok(f(`<img src=x onerror="alert(1)">`).length > 0);
    assert.ok(f(`<b data-mk="MK-1">x</b>`).length > 0);
    assert.ok(f(`<a href="javascript:alert(1)">x</a>`).length > 0);
    assert.ok(f(`<a href=" jAvA&#x09;script:alert(1)">x</a>`).length > 0);
    assert.ok(f(`<a href="&#106;avascript&colon;alert(1)">x</a>`).length > 0);
    assert.ok(f(`<a href="data:text/html;base64,AAAA">x</a>`).length > 0);
    assert.ok(f(`<iframe srcdoc="x"></iframe>`).length > 0);
    assert.ok(
      f(`<meta content="&quot;"><img data-mk="MK-1" src=x>`).length > 0,
      "thoát khỏi thuộc tính phải bị bắt",
    );
    assert.ok(f(`<svg onload=1></svg>`).length > 0);
  });
  test("tokenize: thuộc tính trích dẫn/không trích dẫn, chú thích bị bỏ qua", () => {
    const t = P.tokenize(`<!-- <b x=1> --><a href="x y" data-a='1' B=2 disabled>`) as {
      tag: string;
      attrs: Record<string, string>;
    }[];
    assert.equal(t.length, 1);
    assert.deepEqual(t[0]!.attrs, { href: "x y", "data-a": "1", b: "2", disabled: "" });
  });
});

describe("rò thông tin lỗi", () => {
  test("bắt stack, SQL, đường dẫn, chuỗi kết nối; không báo oan thông điệp lành", () => {
    for (const bad of [
      "Error: boom\n    at foo (/app/lib/x.ts:10:5)",
      'relation "app_user" does not exist',
      "SELECT id FROM app_user WHERE x = 1",
      "/home/user/X-Company/lib/a.ts",
      "postgres://u:p@h/db",
      "TypeError: x is not a function",
      "duplicate key value violates unique constraint",
    ])
      assert.ok(P.leakFindings(bad).length > 0, bad);
    for (const ok of [
      "Không tìm thấy",
      "Dữ liệu không hợp lệ",
      '{"status":"ok"}',
      "Vui lòng chọn từ danh sách và gửi lại",
    ])
      assert.deepEqual(P.leakFindings(ok), [], ok);
  });
  test("RFC 9457: đủ trường, đúng content-type, không trường nội bộ", () => {
    const body = { type: "/p/x", title: "t", status: 400, detail: "d", instance: "urn:uuid:1" };
    const good = res({
      status: 400,
      headers: { "content-type": "application/problem+json", "cache-control": "no-store" },
      body: JSON.stringify(body),
    });
    assert.deepEqual(P.checkProblem(good, 400), []);
    assert.ok(P.checkProblem({ ...good, body: JSON.stringify({ ...body, stack: "x" }) }, 400).length > 0);
    assert.ok(P.checkProblem({ ...good, headers: { "content-type": "text/html" } }, 400).length > 0);
    assert.ok(P.checkProblem({ ...good, body: "{" }, 400).length > 0);
    const leaky = JSON.stringify({ ...body, detail: "Error: x\n    at run (/app/lib/a.ts:1:2)" });
    assert.ok(P.checkProblem({ ...good, body: leaky }, 400).some((e: string) => e.startsWith("rò")));
    assert.ok(P.checkProblem({ ...good, status: 500 }, 400).length > 0, "status không khớp");
  });
});

describe("chuyển hướng, đường dẫn, source map", () => {
  const base = "http://127.0.0.1:3200";
  test("open redirect", () => {
    const r = (location: string, status = 307) => res({ status, headers: { location } });
    assert.deepEqual(P.checkRedirectTarget(r("/app/login"), base), []);
    assert.deepEqual(P.checkRedirectTarget(r("/evil.test"), base), []); // đường dẫn cùng nguồn
    assert.ok(P.checkRedirectTarget(r("https://evil.test/x"), base).length > 0);
    assert.ok(P.checkRedirectTarget(r("//evil.test"), base).length > 0);
    assert.ok(P.checkRedirectTarget(r("http://localhost:9999/"), base).length > 0);
    assert.deepEqual(
      P.checkRedirectTarget(r("http://localhost:3200/app/login"), base, {
        allowedOrigins: ["http://localhost:3200"],
      }),
      [],
    );
    assert.deepEqual(P.checkRedirectTarget(res({ status: 200 }), base), []);
  });
  test("đường dẫn không phục vụ + source map", () => {
    assert.deepEqual(P.checkNotServed(res({ status: 404 })), []);
    assert.ok(P.checkNotServed(res({ status: 200, body: "DATABASE_URL=postgres://x" })).length > 0);
    assert.ok(P.checkNotServed(res({ status: 200, body: "hello" })).length > 0);
    assert.ok(P.checkNotServed(res({ status: 302, headers: { location: "/app/login" } })).length > 0);
    assert.deepEqual(
      P.checkNotServed(res({ status: 302, headers: { location: "/app/login" } }), {
        allowRedirectToLogin: true,
      }),
      [],
    );
    assert.deepEqual(P.checkSourceMapNotPublic(res({ body: "x()" }), res({ status: 404 })), []);
    assert.ok(
      P.checkSourceMapNotPublic(res({ body: "x()\n//# sourceMappingURL=a.js.map" }), res({ status: 404 }))
        .length > 0,
    );
    assert.ok(
      P.checkSourceMapNotPublic(res({ body: "x()" }), res({ status: 200, body: '{"sourcesContent":[]}' }))
        .length > 0,
    );
  });
});

describe("giới hạn tần suất, idempotency, CSRF, BOLA", () => {
  test("rate limit", () => {
    const ok = [
      res({ status: 201 }),
      res({ status: 201 }),
      res({ status: 429, headers: { "retry-after": "30" } }),
    ];
    assert.deepEqual(P.checkRateLimited(ok, { expectBeforeLimit: 2 }), []);
    assert.ok(P.checkRateLimited([res(), res()]).length > 0, "không có 429");
    assert.ok(P.checkRateLimited([res({ status: 429 })]).length > 0, "thiếu Retry-After");
    assert.ok(P.checkRateLimited([res({ status: 429, headers: { "retry-after": "0" } })]).length > 0);
    assert.ok(P.checkRateLimited(ok, { expectBeforeLimit: 5 }).length > 0, "chặn quá sớm");
    assert.ok(P.checkRateLimited([...ok, res({ status: 500 })]).length > 0);
  });
  test("idempotency", () => {
    const first = res({ status: 201, body: '{"id":"1"}' });
    const replay = res({ status: 201, body: '{"id":"1"}', headers: { "idempotent-replayed": "true" } });
    const mk = (o = {}) => ({
      first,
      replay,
      reused: res({ status: 422 }),
      missing: res({ status: 400 }),
      ...o,
    });
    assert.deepEqual(P.checkIdempotency(mk()), []);
    assert.ok(P.checkIdempotency(mk({ replay: res({ status: 201, body: '{"id":"2"}' }) })).length > 0);
    assert.ok(P.checkIdempotency(mk({ reused: res({ status: 201 }) })).length > 0);
    assert.ok(P.checkIdempotency(mk({ missing: res({ status: 201 }) })).length > 0);
    assert.ok(P.checkIdempotency(mk({ concurrent: [first, first] })).length > 0, "hai lần chạy thật");
    assert.deepEqual(P.checkIdempotency(mk({ concurrent: [first, replay, replay] })), []);
  });
  test("CSRF, CORS, BOLA", () => {
    assert.deepEqual(P.checkCsrfRejected(res({ status: 403, body: '{"code":"CSRF"}' })), []);
    assert.ok(P.checkCsrfRejected(res({ status: 201 })).length > 0);
    assert.ok(P.checkCsrfRejected(res({ status: 403, body: '{"code":"FORBIDDEN"}' })).length > 0);
    assert.ok(
      P.checkCors(res({ headers: { "access-control-allow-origin": "*" } }), "https://evil.test").length > 0,
    );
    assert.ok(
      P.checkCors(
        res({ headers: { "access-control-allow-origin": "https://evil.test" } }),
        "https://evil.test",
      ).length > 0,
    );
    assert.deepEqual(P.checkCors(res(), "https://evil.test"), []);
    assert.deepEqual(P.checkDenied(res({ status: 404 }), ["bí mật"]), []);
    assert.ok(P.checkDenied(res({ status: 200, body: "bí mật" }), ["bí mật"]).length >= 2);
  });
});

describe("báo cáo", () => {
  test("che bí mật; nhóm FAIL khi có check đỏ hoặc rỗng; báo cáo có nhãn và mục Không chứng minh", () => {
    const r = P.redact(
      `cookie: xc_session=abcdef123456; csrf_token":"${"Z".repeat(30)}" nonce-AAAAAAAAAAAAAAAA`,
    );
    assert.ok(!r.includes("abcdef123456") && !r.includes("ZZZZZZZZZZ") && !r.includes("AAAAAAAAAAAAAAAA"));
    const ok = { name: "a", ok: true, errors: [], evidence: "e" };
    assert.equal(P.groupResult("X", "t", [], [ok]).status, "PASS");
    assert.equal(P.groupResult("X", "t", [], [ok, { ...ok, ok: false, errors: ["l"] }]).status, "FAIL");
    assert.equal(P.groupResult("X", "t", [], []).status, "FAIL");
    const md = P.renderReport(
      {
        date: "2026-10-19",
        commit: "abc",
        env: { os: "o", cpus: "c", memGiB: 1, node: "n", next: "x", psql: null },
        port: 1,
        browser: "b",
        checkTotal: 1,
        requestTotal: 2,
        notProven: ["Không có TLS thật"],
      },
      [P.groupResult("DAST-A", "Header", ["R"], [ok])],
    );
    assert.ok(
      md.includes("faithful-fixture") && md.includes("## Không chứng minh") && md.includes("**PASS**"),
    );
  });
});
