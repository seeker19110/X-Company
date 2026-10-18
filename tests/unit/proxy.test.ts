import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { NextRequest } from "next/server";
import { proxy, securityHeaders } from "../../proxy.ts";
import { setTestEnv } from "../helpers/fixtures.ts";

setTestEnv(); // proxy đọc APP_ORIGIN qua module env (thiếu = lỗi cấu hình, không im lặng)

describe("proxy: header bảo mật + chuyển hướng /app", () => {
  test("CSP có nonce, không unsafe-inline cho script, chặn nhúng khung; HSTS chỉ khi https", () => {
    const h = securityHeaders("abc", { dev: false, https: true });
    assert.match(h["content-security-policy"]!, /script-src 'self' 'nonce-abc' 'strict-dynamic'(;|$)/);
    assert.match(h["content-security-policy"]!, /frame-ancestors 'none'/);
    assert.match(h["content-security-policy"]!, /object-src 'none'/);
    assert.ok(!/script-src[^;]*unsafe-inline/.test(h["content-security-policy"]!));
    assert.equal(h["x-content-type-options"], "nosniff");
    assert.ok(h["strict-transport-security"]);
    assert.equal(securityHeaders("x", { dev: false, https: false })["strict-transport-security"], undefined);
    assert.match(
      securityHeaders("x", { dev: true, https: false })["content-security-policy"]!,
      /'unsafe-eval'/,
    );
  });

  test("/app chưa có cookie phiên → chuyển /app/login; /app/login và trang công khai đi tiếp kèm header", () => {
    const r = proxy(new NextRequest("http://xc.test/app/today?x=1"));
    assert.equal(r.status, 307);
    assert.equal(r.headers.get("location"), "http://xc.test/app/login");
    const login = proxy(new NextRequest("http://xc.test/app/login"));
    assert.equal(login.status, 200);
    assert.match(login.headers.get("content-security-policy") ?? "", /nonce-/);
    const withCookie = proxy(
      new NextRequest("http://xc.test/app/today", { headers: { cookie: "xc_session=abc" } }),
    );
    assert.equal(withCookie.status, 200);
    const pub = proxy(new NextRequest("http://xc.test/dich-vu"));
    assert.equal(pub.headers.get("x-frame-options"), "DENY");
  });
});
