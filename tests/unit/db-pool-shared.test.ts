// perf:load phát hiện: Next đóng gói trang SSR và route handler thành các bundle riêng → mỗi bundle một bản `lib/db` và một pool
// riêng (DB_POOL_MAX=10 thành tối đa 20 kết nối). Pool phải dùng chung toàn tiến trình (globalThis) dù module nạp nhiều bản.
import assert from "node:assert/strict";
import { after, test } from "node:test";

process.env.DATABASE_URL = "postgres://u:p@127.0.0.1:1/x";
process.env.SESSION_SECRET ??= "unit-test-session-secret-0123456789abcdef";
process.env.APP_ORIGIN ??= "http://localhost:3000";
process.env.QR_SIGNING_KEYS ??= "k1:unit-test-qr-key-0123456789abcdef0123456789abcdef";

type Db = typeof import("../../lib/db/index.ts");
// Query khác nhau → bộ nạp ESM tạo hai thể hiện module độc lập (giống hai bundle của Next).
const load = (tag: string) => import(`../../lib/db/index.ts?bundle=${tag}`) as Promise<Db>;
const a = await load("a");
const b = await load("b");

after(async () => {
  await a.closePool();
});

test("hai bản module nạp riêng vẫn dùng CHUNG một pool", () => {
  assert.notEqual(a, b, "tiền điều kiện: hai bản module là hai thể hiện khác nhau");
  assert.equal(a.getPool(), b.getPool());
});

test("closePool ở một bản đóng pool chung; lần getPool sau tạo pool mới", async () => {
  const first = a.getPool();
  await b.closePool();
  const second = a.getPool();
  assert.notEqual(first, second);
  assert.equal(second, b.getPool());
});

test("setPool(undefined) ở một bản xoá pool cho mọi bản", () => {
  a.getPool();
  b.setPool(undefined);
  const fresh = a.getPool();
  assert.equal(fresh, b.getPool());
});
