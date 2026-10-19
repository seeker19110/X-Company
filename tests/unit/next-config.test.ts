// next.config.ts: rewrite cho đường dẫn %-mã hoá hỏng (DAST phát hiện: Next tự lưu trữ trả 500). Biểu thức phải khớp CHÍNH XÁC
// những chuỗi `decodeURIComponent` ném lỗi — đường dẫn hợp lệ (kể cả slug tiếng Việt) tuyệt đối không được bị chuyển đi.
import assert from "node:assert/strict";
import { randomBytes, randomInt } from "node:crypto";
import { describe, test } from "node:test";
import nextConfig, { API_HSTS, MALFORMED_PATH_RE } from "../../next.config.ts";
import { securityHeaders } from "../../proxy.ts";

const re = new RegExp(`^${MALFORMED_PATH_RE}$`, "su");
const matches = (s: string) => re.test(s);
const throwsOnDecode = (s: string) => {
  try {
    decodeURIComponent(s);
    return false;
  } catch {
    return true;
  }
};
// Biểu thức chỉ khớp phần KHÔNG hợp lệ; `.*` ở cuối nghĩa là nếu khớp thì phần còn lại là bất kỳ.
const flagged = (s: string) => matches(s);

const pct = (bytes: number[]) =>
  bytes.map((b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`).join("");

describe("MALFORMED_PATH_RE", () => {
  test("các ca cụ thể: hỏng bị bắt, hợp lệ được qua", () => {
    for (const bad of [
      "%E0%A4%A",
      "%ZZ",
      "a%",
      "%",
      "%C0%80",
      "%ED%A0%80",
      "%F4%90%80%80",
      "%80",
      "x%C1%BF",
      "%E0%80%80",
      "%F0%80%80%80",
    ])
      assert.equal(flagged(bad), true, bad);
    for (const ok of [
      "",
      "dich-vu",
      "dich-vu/tu-van",
      "%E1%BB%9Fa",
      "%E0%A4%A4",
      "%F0%9F%98%80",
      "a%20b",
      "%2F%2e%2E",
      "%e1%bb%9f",
      "tiếng-việt",
    ])
      assert.equal(flagged(ok), false, ok);
  });

  test("thuộc tính: trùng khớp với decodeURIComponent trên chuỗi byte ngẫu nhiên (đủ mọi byte dẫn và byte tiếp nối)", () => {
    let mismatches = 0;
    let badSeen = 0;
    for (let i = 0; i < 40_000; i++) {
      const n = randomInt(1, 6);
      // Thiên về byte có ý nghĩa với UTF-8 (dẫn/tiếp nối/biên) để phủ các nhánh.
      const pool = [
        0x00, 0x41, 0x7f, 0x80, 0x8f, 0x90, 0x9f, 0xa0, 0xbf, 0xc0, 0xc1, 0xc2, 0xdf, 0xe0, 0xe1, 0xec, 0xed,
        0xee, 0xef, 0xf0, 0xf1, 0xf3, 0xf4, 0xf5, 0xff,
      ];
      const bytes = Array.from(randomBytes(n), (b) => (b % 3 === 0 ? b : pool[randomInt(pool.length)]!));
      let s = pct(bytes);
      if (i % 7 === 0) s = s.slice(0, -1); // cắt dở một chuỗi %XX
      if (flagged(s) !== throwsOnDecode(s)) mismatches += 1;
      if (throwsOnDecode(s)) badSeen += 1;
    }
    assert.equal(mismatches, 0);
    assert.ok(badSeen > 5_000, `phải có đủ ca hỏng để phép thử có nghĩa (thấy ${badSeen})`);
  });

  test("vét cạn mọi chuỗi 1–2 byte và biên của chuỗi 3–4 byte", () => {
    let bad = 0;
    const check = (s: string) => {
      assert.equal(flagged(s), throwsOnDecode(s), s);
      if (throwsOnDecode(s)) bad += 1;
    };
    for (let a = 0; a < 256; a++) {
      check(pct([a]));
      for (let b = 0; b < 256; b++) check(pct([a, b]));
    }
    for (const lead of [0xe0, 0xe1, 0xec, 0xed, 0xee, 0xef])
      for (let b = 0x7f; b <= 0xc0; b++) for (const c of [0x7f, 0x80, 0xbf, 0xc0]) check(pct([lead, b, c]));
    for (const lead of [0xf0, 0xf1, 0xf3, 0xf4, 0xf5])
      for (let b = 0x7f; b <= 0xc0; b++) for (const c of [0x80, 0xbf]) check(pct([lead, b, c, 0x80]));
    assert.ok(bad > 100);
  });

  test("tiếng Việt mã hoá hợp lệ (mọi ký tự có dấu) không bao giờ bị bắt", () => {
    const vi = "àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ";
    for (const ch of vi + vi.toUpperCase()) assert.equal(flagged(encodeURIComponent(ch)), false, ch);
  });

  test("next.config có rewrite beforeFiles dùng đúng biểu thức", async () => {
    const r = (await nextConfig.rewrites?.()) as { beforeFiles: { source: string; destination: string }[] };
    assert.equal(r.beforeFiles.length, 1);
    assert.ok(r.beforeFiles[0]!.source.includes(MALFORMED_PATH_RE));
    assert.equal(r.beforeFiles[0]!.destination, "/khong-hop-le");
  });

  test("header API: nosniff + HSTS, HSTS trùng giá trị của proxy.ts", async () => {
    const h = await nextConfig.headers?.();
    const api = h?.find((x) => x.source === "/api/:path*");
    assert.ok(api, "phải có khối header cho /api/:path*");
    const get = (k: string) => api.headers.find((x) => x.key.toLowerCase() === k)?.value;
    assert.equal(get("x-content-type-options"), "nosniff");
    assert.equal(get("strict-transport-security"), API_HSTS);
    assert.equal(securityHeaders("n", { dev: false, https: true })["strict-transport-security"], API_HSTS);
  });
});
