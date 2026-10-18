// QR động (SPEC-attendance): token = base64url(payload).base64url(HMAC-SHA256), khoá theo kid để xoay vòng.
// Khoá ký: QR_SIGNING_KEYS = "kid1:secret1,kid2:secret2" (kid đầu tiên dùng để ký; các kid khác chỉ để kiểm).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { AppError } from "../nen/app-error.ts";

export interface QrPayload {
  v: 1;
  kid: string;
  cid: string; // company
  ws: string; // worksite
  iat: number; // epoch giây
  ttl: number; // giây
  n: string; // nonce
}

function keys(): Map<string, Buffer> {
  const raw = process.env.QR_SIGNING_KEYS ?? "";
  const m = new Map<string, Buffer>();
  for (const part of raw.split(",")) {
    const i = part.indexOf(":");
    if (i <= 0) continue;
    const secret = part.slice(i + 1).trim();
    if (Buffer.byteLength(secret) < 32) throw new Error("Khoá QR phải ≥ 32 byte");
    m.set(part.slice(0, i).trim(), Buffer.from(secret));
  }
  if (m.size === 0) throw new Error("Thiếu QR_SIGNING_KEYS");
  return m;
}

const sign = (key: Buffer, body: string) => createHmac("sha256", key).update(body).digest();

export function issueQr(
  companyId: string,
  worksiteId: string,
  ttlSec: number,
  now: Date = new Date(),
): string {
  const [kid, key] = keys().entries().next().value as [string, Buffer];
  const payload: QrPayload = {
    v: 1,
    kid,
    cid: companyId,
    ws: worksiteId,
    iat: Math.floor(now.getTime() / 1000),
    ttl: ttlSec,
    n: randomBytes(8).toString("base64url"),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(key, body).toString("base64url")}`;
}

/** Kiểm chữ ký (luôn) — trả payload; hết hạn kiểm riêng bằng `qrExpired` vì thời điểm so sánh tuỳ nguồn. */
export function verifyQrSignature(token: string): QrPayload {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined || token.length > 1000)
    throw new AppError("QR_INVALID", 422, "Mã QR không hợp lệ");
  let payload: QrPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as QrPayload;
  } catch {
    throw new AppError("QR_INVALID", 422, "Mã QR không hợp lệ");
  }
  const key = typeof payload?.kid === "string" ? keys().get(payload.kid) : undefined;
  const given = Buffer.from(sig, "base64url");
  const expected = key ? sign(key, body) : Buffer.alloc(32);
  if (!key || given.length !== expected.length || !timingSafeEqual(given, expected) || payload.v !== 1)
    throw new AppError("QR_INVALID", 422, "Mã QR không hợp lệ");
  return payload;
}

export function qrExpired(p: QrPayload, at: Date, leewaySec: number): boolean {
  const t = at.getTime() / 1000;
  return t > p.iat + p.ttl + leewaySec || t < p.iat - leewaySec;
}
