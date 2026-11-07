// T-116 phát hiện (kho tệp): Next đóng gói instrumentation.ts và từng route thành bản module riêng — biến module đặt ở
// instrumentation không tới route. Transport KMS (`setKmsTransport` ở adapters/register-kms.ts) cùng rủi ro: route thấy
// "chưa đăng ký transport" → mọi giải mã lỗi KMS_CONFIG khi KMS_PROVIDER=transit. Transport + client phải dùng chung toàn tiến trình.
import assert from "node:assert/strict";
import { after, test } from "node:test";

Object.assign(process.env, {
  KMS_PROVIDER: "transit",
  KMS_TRANSIT_ADDR: "http://127.0.0.1:1",
  KMS_TRANSIT_TOKEN: "unit-test-kms-token",
});
after(() => {
  for (const k of ["KMS_PROVIDER", "KMS_TRANSIT_ADDR", "KMS_TRANSIT_TOKEN"]) delete process.env[k];
});

type Kms = typeof import("../../lib/crypto/kms.ts");
// Query khác nhau → bộ nạp ESM tạo hai thể hiện module độc lập (giống hai bundle của Next).
const load = (tag: string) => import(`../../lib/crypto/kms.ts?bundle=${tag}`) as Promise<Kms>;
const a = await load("instrumentation");
const b = await load("route");
const transport = { request: async () => ({ status: 500, json: {} }) };

test("transport đăng ký ở một bản module được bản kia thấy; cùng một client (bộ đệm DEK, trần lượt gọi chung)", () => {
  assert.notEqual(a, b, "tiền điều kiện: hai bản module là hai thể hiện khác nhau");
  a.setKmsTransport(transport);
  const pb = b.keyProvider();
  assert.equal(pb, a.keyProvider(), "một client cho cả tiến trình");
});

test("gỡ transport ở một bản → bản kia fail-closed KMS_CONFIG, không dùng client cũ đã đệm", () => {
  a.setKmsTransport(transport);
  b.keyProvider();
  a.setKmsTransport(undefined);
  assert.throws(() => b.keyProvider(), /chưa đăng ký transport KMS/);
});
