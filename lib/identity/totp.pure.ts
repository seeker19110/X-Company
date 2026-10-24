// TOTP (RFC 6238) trên HOTP (RFC 4226), HMAC-SHA1, bước 30 s, 6 chữ số; base32 RFC 4648 không padding (AUD-SEC-002, D-058).
// Mô-đun thuần: chỉ dùng node:crypto (không DB/HTTP) — dùng chung cho server (lib/identity/mfa.ts), seed/e2e và test.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { msToSeconds } from "../nen/units.ts";

export const TOTP_PERIOD_S = 30;
export const TOTP_DIGITS = 6;
/** Lệch đồng hồ chấp nhận: ±1 bước. */
export const TOTP_WINDOW = 1;
/** Độ dài bí mật: 20 byte (160 bit, bằng đầu ra SHA-1 — RFC 4226 §4 khuyến nghị ≥ 128 bit). */
export const TOTP_SECRET_BYTES = 20;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1; // giữ phần dư, tránh tràn số
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Giải base32 (không phân biệt hoa thường, bỏ khoảng trắng/gạch nối/padding). Ký tự lạ → null. */
export function base32Decode(text: string): Buffer | null {
  const clean = text.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return Buffer.from(out);
}

/** HOTP(K, C) — RFC 4226 §5.3 (cắt động), `digits` chữ số có số 0 đầu. */
export function hotp(secret: Uint8Array, counter: number, digits = TOTP_DIGITS): string {
  if (!Number.isSafeInteger(counter) || counter < 0) throw new RangeError("counter phải là số nguyên ≥ 0");
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(msg).digest();
  const off = mac[mac.length - 1]! & 0x0f;
  const bin =
    ((mac[off]! & 0x7f) << 24) |
    ((mac[off + 1]! & 0xff) << 16) |
    ((mac[off + 2]! & 0xff) << 8) |
    (mac[off + 3]! & 0xff);
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/** Bước thời gian T = floor(unix giây / 30). */
export function totpStep(nowMs: number, period = TOTP_PERIOD_S): number {
  return Math.floor(msToSeconds(nowMs) / period);
}

export function totp(secret: Uint8Array, nowMs: number, digits = TOTP_DIGITS): string {
  return hotp(secret, totpStep(nowMs), digits);
}

/** Mã người dùng gõ: bỏ khoảng trắng; phải đúng `digits` chữ số ASCII. Sai dạng → null. */
export function normalizeCode(code: string, digits = TOTP_DIGITS): string | null {
  const c = code.replace(/\s+/g, "");
  return new RegExp(`^[0-9]{${digits}}$`).test(c) ? c : null;
}

/**
 * Kiểm mã trong cửa sổ ±`window` bước quanh `nowMs`. Chỉ xét bước > `afterStep` (chống phát lại: bước đã dùng không
 * dùng lại được). Trả bước khớp (nhỏ nhất) hoặc null. So bằng timingSafeEqual; luôn duyệt hết cửa sổ.
 */
export function verifyTotp(
  secret: Uint8Array,
  code: string,
  nowMs: number,
  opts: { window?: number; afterStep?: number | null } = {},
): number | null {
  const c = normalizeCode(code);
  if (c === null) return null;
  const window = opts.window ?? TOTP_WINDOW;
  const cur = totpStep(nowMs);
  const given = Buffer.from(c);
  let matched: number | null = null;
  for (let s = cur - window; s <= cur + window; s++) {
    if (s < 0) continue;
    const ok = timingSafeEqual(Buffer.from(hotp(secret, s)), given);
    if (
      ok &&
      matched === null &&
      (opts.afterStep === undefined || opts.afterStep === null || s > opts.afterStep)
    )
      matched = s;
  }
  return matched;
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(TOTP_SECRET_BYTES));
}

/** URI cho ứng dụng xác thực (Key Uri Format): otpauth://totp/X-Company:<email>?secret=…&issuer=X-Company&… */
export function otpauthUri(secretB32: string, account: string, issuer = "X-Company"): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const q = new URLSearchParams({
    secret: secretB32,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_S),
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}
