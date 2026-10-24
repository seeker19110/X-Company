import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, test } from "node:test";
import {
  base32Decode,
  base32Encode,
  hotp,
  normalizeCode,
  otpauthUri,
  totp,
  totpStep,
  verifyTotp,
} from "../../lib/identity/totp.pure.ts";

const RFC_SECRET = Buffer.from("12345678901234567890", "ascii");

describe("TOTP thuần (RFC 4226 / RFC 6238, AUD-SEC-002)", () => {
  test("HOTP: vector RFC 4226 Phụ lục D (đếm 0..9)", () => {
    const want = [
      "755224",
      "287082",
      "359152",
      "969429",
      "338314",
      "254676",
      "287922",
      "162583",
      "399871",
      "520489",
    ];
    want.forEach((code, i) => assert.equal(hotp(RFC_SECRET, i), code, `count=${i}`));
  });

  test("TOTP SHA1 8 chữ số: vector RFC 6238 Phụ lục B", () => {
    const cases: [number, string][] = [
      [59, "94287082"],
      [1111111109, "07081804"],
      [1111111111, "14050471"],
      [1234567890, "89005924"],
      [2000000000, "69279037"],
      [20000000000, "65353130"],
    ];
    for (const [t, code] of cases) assert.equal(totp(RFC_SECRET, t * 1000, 8), code, `T=${t}`);
    // 6 chữ số = 6 chữ số cuối của cùng giá trị (cùng phép mod).
    assert.equal(totp(RFC_SECRET, 59_000), "287082");
  });

  test("base32: khứ hồi mọi độ dài 0..40 byte; vector RFC 4648 (không padding); chữ thường/khoảng trắng; ký tự lạ → null", () => {
    for (let n = 0; n <= 40; n++) {
      const b = randomBytes(n);
      assert.deepEqual(base32Decode(base32Encode(b)), b, `n=${n}`);
    }
    const vec: [string, string][] = [
      ["", ""],
      ["f", "MY"],
      ["fo", "MZXQ"],
      ["foo", "MZXW6"],
      ["foob", "MZXW6YQ"],
      ["fooba", "MZXW6YTB"],
      ["foobar", "MZXW6YTBOI"],
    ];
    for (const [plain, enc] of vec) {
      assert.equal(base32Encode(Buffer.from(plain)), enc);
      assert.equal(base32Decode(enc)!.toString(), plain);
    }
    assert.equal(base32Decode("mzxw 6ytb-oi======")!.toString(), "foobar");
    assert.equal(base32Decode("MZXW1"), null, "1 không thuộc bảng chữ base32");
    assert.equal(base32Encode(RFC_SECRET), "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });

  test("mã sai độ dài / không phải số → không hợp lệ", () => {
    const now = 1_700_000_000_000;
    const good = totp(RFC_SECRET, now);
    assert.equal(normalizeCode(` ${good.slice(0, 3)} ${good.slice(3)} `), good);
    for (const bad of ["", "12345", "1234567", "12a456", "１２３４５６", "-12345", "12345.", "+123456"])
      assert.equal(verifyTotp(RFC_SECRET, bad, now), null, JSON.stringify(bad));
  });

  test("cửa sổ: ±1 bước chấp nhận (trả bước khớp), ±2 từ chối", () => {
    const now = 1_700_000_015_000;
    const cur = totpStep(now);
    for (const d of [-1, 0, 1]) {
      const code = hotp(RFC_SECRET, cur + d);
      assert.equal(verifyTotp(RFC_SECRET, code, now), cur + d, `lệch ${d}`);
    }
    for (const d of [-2, 2]) assert.equal(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, cur + d), now), null);
  });

  test("chống phát lại: bước ≤ afterStep không được chấp nhận; bước sau vẫn được", () => {
    const now = 1_700_000_015_000;
    const cur = totpStep(now);
    const code = hotp(RFC_SECRET, cur);
    assert.equal(verifyTotp(RFC_SECRET, code, now, { afterStep: cur }), null);
    assert.equal(verifyTotp(RFC_SECRET, code, now, { afterStep: cur - 1 }), cur);
    assert.equal(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, cur + 1), now, { afterStep: cur }), cur + 1);
    assert.equal(verifyTotp(RFC_SECRET, code, now, { afterStep: null }), cur);
  });

  test("biên thời gian: đúng ranh giới bước; counter âm bị từ chối", () => {
    assert.equal(totpStep(29_999), 0);
    assert.equal(totpStep(30_000), 1);
    assert.throws(() => hotp(RFC_SECRET, -1), RangeError);
    // Gần epoch: bước -1 không tồn tại → chỉ xét 0 và 1.
    assert.equal(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, 0), 1000), 0);
  });

  test("otpauth URI đúng định dạng Key Uri", () => {
    const raw = otpauthUri("JBSWY3DPEHPK3PXP", "hr@x.test");
    assert.ok(raw.startsWith("otpauth://totp/X-Company:hr%40x.test?"), raw);
    const u = new URL(raw);
    assert.equal(u.searchParams.get("secret"), "JBSWY3DPEHPK3PXP");
    assert.equal(u.searchParams.get("issuer"), "X-Company");
    assert.equal(u.searchParams.get("algorithm"), "SHA1");
    assert.equal(u.searchParams.get("digits"), "6");
    assert.equal(u.searchParams.get("period"), "30");
  });
});
