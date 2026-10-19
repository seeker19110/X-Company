// AUD-XFEAT-001: giới hạn kích thước body phải chặn khi ĐỌC (request chunked không có Content-Length), không chỉ nhìn header.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readCapped, readFormCapped, readJson } from "../../lib/http/index.ts";
import { requestHash } from "../../lib/http/idempotency.ts";
import { AppError } from "../../lib/nen/app-error.ts";
import { kb, mb } from "../../lib/nen/units.ts";

const CHUNK = mb(1);
/** Body stream `total` byte, không Content-Length; đếm số byte thực sự bị kéo ra khỏi nguồn. */
function chunked(total: number, headers: Record<string, string> = {}) {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (sent >= total) return ctrl.close();
      const n = Math.min(CHUNK, total - sent);
      sent += n;
      ctrl.enqueue(new Uint8Array(n).fill(0x61));
    },
  });
  const req = new Request("http://x.test/api/app/x", {
    method: "POST",
    body: stream,
    headers,
    // @ts-expect-error — Node/undici: body stream cần duplex
    duplex: "half",
  });
  return { req, pulled: () => sent };
}
const isTooLarge = (e: unknown) =>
  e instanceof AppError && e.code === "PAYLOAD_TOO_LARGE" && e.status === 413;

describe("body có trần khi đọc", () => {
  test("readJson: 64 MiB chunked → 413 và không kéo quá trần + vài chunk", async () => {
    const { req, pulled } = chunked(mb(64));
    await assert.rejects(readJson(req, kb(16)), isTooLarge);
    assert.ok(pulled() <= kb(16) + 4 * CHUNK, `đã kéo ${pulled()} byte`);
  });
  test("readJson: body nhỏ vẫn đọc được; rỗng → {}", async () => {
    assert.deepEqual(await readJson(new Request("http://x.test/", { method: "POST", body: '{"a":1}' })), {
      a: 1,
    });
    assert.deepEqual(await readJson(new Request("http://x.test/", { method: "POST" })), {});
  });
  test("readCapped: đúng bằng trần qua, trần+1 bị chặn", async () => {
    const mk = (n: number) =>
      new Request("http://x.test/", { method: "POST", body: new Uint8Array(n).fill(1) });
    assert.equal((await readCapped(mk(100), 100)).byteLength, 100);
    await assert.rejects(readCapped(mk(101), 100), isTooLarge);
  });
  test("readFormCapped: multipart chunked quá trần → 413", async () => {
    const { req, pulled } = chunked(mb(64), { "content-type": "multipart/form-data; boundary=zz" });
    await assert.rejects(readFormCapped(req, mb(1)), isTooLarge);
    assert.ok(pulled() <= mb(1) + 4 * CHUNK);
  });
  test("requestHash: body chunked quá trần băm → 413, không đọc hết", async () => {
    const { req, pulled } = chunked(mb(64));
    await assert.rejects(requestHash(req), isTooLarge);
    assert.ok(pulled() <= mb(21) + 4 * CHUNK);
  });
});
