// Chữ ký AWS Signature Version 4 tự viết (adapters/s3-http.ts, T-116/D-073) đối chiếu vector CHÍNH THỨC của bộ
// "AWS Signature Version 4 test suite" — bản sao trong botocore: https://github.com/boto/botocore/tree/develop/tests/unit/auth/aws4_testsuite
// (tra 2026-11-06; tệp <ca>.req/.creq/.authz; thông tin xác thực ví dụ AKIDEXAMPLE/wJalr…EXAMPLEKEY, vùng us-east-1, dịch vụ "service",
// thời điểm 20150830T123600Z — botocore tests/unit/auth/test_sigv4.py). Trang ví dụ S3 "GET Object" của tài liệu AWS
// (sig-v4-header-based-auth.html) nay chuyển hướng về trang chủ API Reference, không tải được để đối chiếu → không dùng (chưa xác minh).
// Chữ ký với máy chủ thật (kể cả x-amz-content-sha256 của S3) kiểm ở tests/db/files-contract.test.ts (rclone serve s3 kiểm chữ ký V4).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import { amzDateOf, s3Transport, signV4, uriEncode, type S3Config } from "../../adapters/s3-http.ts";

const CREDS = { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" };
const DATE = new Date(Date.UTC(2015, 7, 30, 12, 36, 0));
const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const UNRESERVED = "-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

interface Vector {
  name: string;
  method: string;
  path: string;
  query?: [string, string][];
  headers?: Record<string, string>;
  body?: string;
  creq: string;
  signedHeaders: string;
  signature: string;
}

const VECTORS: Vector[] = [
  {
    name: "get-vanilla",
    method: "GET",
    path: "/",
    creq: `GET\n/\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n${EMPTY}`,
    signedHeaders: "host;x-amz-date",
    signature: "5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
  },
  {
    name: "get-vanilla-query-order-key-case",
    method: "GET",
    path: "/",
    query: [
      ["Param2", "value2"],
      ["Param1", "value1"],
    ],
    creq: `GET\n/\nParam1=value1&Param2=value2\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n${EMPTY}`,
    signedHeaders: "host;x-amz-date",
    signature: "b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500",
  },
  {
    name: "get-unreserved",
    method: "GET",
    path: `/${UNRESERVED}`,
    creq: `GET\n/${UNRESERVED}\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n${EMPTY}`,
    signedHeaders: "host;x-amz-date",
    signature: "07ef7494c76fa4850883e2b006601f940f8a34d404d0cfa977f52a65bbf5f24f",
  },
  {
    name: "get-vanilla-query-unreserved",
    method: "GET",
    path: "/",
    query: [[UNRESERVED, UNRESERVED]],
    creq: `GET\n/\n${UNRESERVED}=${UNRESERVED}\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n${EMPTY}`,
    signedHeaders: "host;x-amz-date",
    signature: "9c3e54bfcdf0b19771a7f523ee5669cdf59bc7cc0884027167c21bb143a40197",
  },
  {
    name: "get-utf8 (đường dẫn Unicode)",
    method: "GET",
    path: "/ሴ",
    creq: `GET\n/%E1%88%B4\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n${EMPTY}`,
    signedHeaders: "host;x-amz-date",
    signature: "8318018e0b0f223aa2bbf98705b62bb787dc9c0e678f255a891fd03141be5d85",
  },
  {
    name: "get-vanilla-utf8-query (query Unicode)",
    method: "GET",
    path: "/",
    query: [["ሴ", "bar"]],
    creq: `GET\n/\n%E1%88%B4=bar\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n${EMPTY}`,
    signedHeaders: "host;x-amz-date",
    signature: "2cdec8eed098649ff3a119c94853b13c643bcf08f8b0a1d91e12c9027818dd04",
  },
  {
    name: "get-header-value-trim (gộp khoảng trắng)",
    method: "GET",
    path: "/",
    headers: { "My-Header1": " value1", "My-Header2": '"a   b   c"' },
    creq: `GET\n/\n\nhost:example.amazonaws.com\nmy-header1:value1\nmy-header2:"a b c"\nx-amz-date:20150830T123600Z\n\nhost;my-header1;my-header2;x-amz-date\n${EMPTY}`,
    signedHeaders: "host;my-header1;my-header2;x-amz-date",
    signature: "acc3ed3afb60bb290fc8d2dd0098b9911fcaa05412b367055dee359757a9c736",
  },
  {
    name: "post-x-www-form-urlencoded (thân có hash)",
    method: "POST",
    path: "/",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "Param1=value1",
    creq: `POST\n/\n\ncontent-type:application/x-www-form-urlencoded\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\ncontent-type;host;x-amz-date\n9095672bbd1f56dfc5b65f3e153adc8731a4a654192329106275f4c7b24d0b6e`,
    signedHeaders: "content-type;host;x-amz-date",
    signature: "ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a",
  },
];

describe("SigV4: vector chính thức của AWS Signature Version 4 test suite", () => {
  for (const v of VECTORS)
    test(v.name, () => {
      const r = signV4({
        method: v.method,
        host: "example.amazonaws.com",
        path: v.path,
        query: v.query,
        headers: v.headers,
        payloadHash: createHash("sha256")
          .update(v.body ?? "")
          .digest("hex"),
        region: "us-east-1",
        service: "service",
        date: DATE,
        credentials: CREDS,
      });
      assert.equal(r.canonicalRequest, v.creq);
      assert.equal(
        r.authorization,
        `AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=${v.signedHeaders}, Signature=${v.signature}`,
      );
    });

  test("amzDate: UTC, bỏ mili giây; uriEncode: !'()* và / được mã hoá (trừ khi giữ /)", () => {
    assert.equal(amzDateOf(new Date("2026-11-06T01:02:03.999Z")), "20261106T010203Z");
    assert.equal(uriEncode("a/b !'()*"), "a%2Fb%20%21%27%28%29%2A");
    assert.equal(uriEncode("a/b c", true), "a/b%20c");
  });
});

describe("s3Transport: yêu cầu gửi đi (fetch giả)", () => {
  const cfg: S3Config = {
    endpoint: "http://127.0.0.1:9000",
    bucket: "xc-files",
    region: "us-east-1",
    accessKeyId: "AKTEST",
    secretAccessKey: "secret-secret-secret",
  };
  const calls: { url: string; init: RequestInit }[] = [];
  const reply = (status: number, body?: string) => {
    calls.length = 0;
    return (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(body ?? null, { status });
    }) as typeof fetch;
  };
  const now = () => new Date("2026-11-06T00:00:00Z");

  test("PUT: path-style, payload ký (x-amz-content-sha256 = sha256 thân), không theo chuyển hướng, có timeout", async () => {
    const t = s3Transport(() => cfg, reply(200), now);
    const body = Buffer.from("xin chào");
    await t.putObject("ab/" + "a".repeat(40), body);
    const [c] = calls;
    assert.equal(c?.url, `http://127.0.0.1:9000/xc-files/ab/${"a".repeat(40)}`);
    assert.equal(c?.init.method, "PUT");
    assert.equal(c?.init.redirect, "error");
    assert.ok(c?.init.signal instanceof AbortSignal);
    const h = c?.init.headers as Record<string, string>;
    assert.equal(h["x-amz-content-sha256"], createHash("sha256").update(body).digest("hex"));
    assert.equal(h["x-amz-date"], "20261106T000000Z");
    assert.match(
      h.authorization ?? "",
      /^AWS4-HMAC-SHA256 Credential=AKTEST\/20261106\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    assert.doesNotMatch(JSON.stringify(h), /secret-secret-secret/);
  });

  test("GET 404 → null; DELETE 204/404 → xong (idempotent); lỗi khác → S3Error nêu mã, không lộ khoá bí mật", async () => {
    assert.equal(await s3Transport(() => cfg, reply(404), now).getObject("ab/x"), null);
    await s3Transport(() => cfg, reply(204), now).deleteObject("ab/x");
    await s3Transport(() => cfg, reply(404), now).deleteObject("ab/x");
    await assert.rejects(
      s3Transport(() => cfg, reply(403, "<Error><Code>SignatureDoesNotMatch</Code></Error>"), now).getObject(
        "ab/x",
      ),
      (e: Error) => {
        assert.equal(e.name, "S3Error");
        assert.match(e.message, /GetObject thất bại \(HTTP 403, SignatureDoesNotMatch\)/);
        assert.doesNotMatch(e.message, /secret-secret-secret/);
        return true;
      },
    );
    await assert.rejects(s3Transport(() => cfg, reply(500), now).putObject("ab/x", Buffer.alloc(1)), {
      name: "S3Error",
      status: 500,
    });
  });

  test("lỗi mạng → lỗi nêu thao tác (giữ cause), không lộ khoá bí mật", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await assert.rejects(s3Transport(() => cfg, down, now).getObject("ab/x"), (e: Error) => {
      assert.match(e.message, /GetObject không kết nối được/);
      assert.ok(e.cause instanceof TypeError);
      return true;
    });
  });
});
