// check:docs: bộ dò số điện thoại trong fixture không báo oan đoạn số nằm trong chuỗi hex (chữ ký SigV4 của T-116),
// vẫn bắt số di động VN đứng riêng (0…, 84…, +84…).
import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import * as mod from "../../scripts/lib/fixture-phone.mjs";

const { phoneMatches } = mod as { phoneMatches: (t: string) => string[] };
// Ghép chuỗi để chính tệp test này không chứa số dạng thật.
const real = ["09", "12345678"].join("");

test("số đứng riêng / trong chuỗi / sau dấu câu → bắt; dạng 84 và +84 → bắt", () => {
  assert.deepEqual(phoneMatches(`sdt: "${real}", (${real})`), [real, real]);
  assert.deepEqual(phoneMatches(`tel:+84${real.slice(1)} 84${real.slice(1)}`), [
    `+84${real.slice(1)}`,
    `84${real.slice(1)}`,
  ]);
});

test("đoạn số kẹp giữa chữ hex (chữ ký, sha256) hay giữa chữ số dài hơn → không bắt", () => {
  assert.deepEqual(phoneMatches(`9c3e54cc${real}c21bb1`), []);
  assert.deepEqual(phoneMatches(`a${real}`), []);
  assert.deepEqual(phoneMatches(`${real}f`), []);
  assert.deepEqual(phoneMatches(`1${real}`), []);
  assert.deepEqual(phoneMatches(`${real}1`), []);
});
