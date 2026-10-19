// i18n-ignore-file: lỗi cấu hình/toàn vẹn dữ liệu cho vận hành (không tới người dùng cuối; route bọc thành lỗi 500 chung)
// Mã hoá dữ liệu lúc lưu tầng ứng dụng (T-048; BASE-SEC-013, DB-SEC-009, CMP-PRIV-007) — chỉ dùng `node:crypto`, không phụ thuộc ngoài.
//
//  - Trường: AES-256-GCM, IV ngẫu nhiên 12 byte MỖI LẦN mã hoá, AAD = "bảng.cột + id dòng" → bản mã bị tráo sang dòng/cột khác
//    sẽ không giải mã được (phát hiện bằng thẻ xác thực).
//  - Phong bì có phiên bản: `v1:<keyId>:<iv>:<tag>:<ct>` (base64url từng phần). keyId cho biết khoá nào đã mã hoá.
//  - Bộ khoá từ env DATA_ENCRYPTION_KEYS ("id:khoá32byte-base64,…"): khoá ĐẦU mã hoá, các khoá sau chỉ giải mã → xoay khoá
//    không dừng hệ thống (thêm khoá mới lên đầu → chạy `npm run -s crypto:rotate` → bỏ khoá cũ khi không còn dòng nào dùng).
//  - Chỉ mục mù (`blindIndex`): HMAC-SHA256 chuẩn hoá NFC + chữ thường, khoá RIÊNG DATA_INDEX_KEY, gắn ngữ cảnh cột để cùng một
//    giá trị ở hai cột cho hai chỉ mục khác nhau (không nối được chéo bảng). Dùng cho tìm/duy nhất mà không lộ bản rõ.
//  - Thiếu khoá ở production → `env()` ném EnvError ngay (fail-closed, startup.ts thoát ≠ 0). Dev/test: khoá thử dẫn xuất lúc
//    chạy từ nhãn cố định (KHÔNG phải khoá thật, không có literal khoá trong mã).
// Khoá và bản rõ không bao giờ vào thông báo lỗi/log.
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { env } from "../nen/env.ts";

export type CryptoErrorCode = "BAD_ENVELOPE" | "KEY_UNKNOWN" | "AUTH_FAILED" | "BAD_CONTEXT";

/** Lỗi mã hoá: chỉ mã + mô tả chung (có thể nêu keyId — không phải bí mật), không bao giờ có khoá/bản rõ. */
export class CryptoError extends Error {
  constructor(
    readonly code: CryptoErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CryptoError";
  }
}

export const ENVELOPE_VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface Keyring {
  /** Khoá hiện hành (khoá đầu trong cấu hình): dùng để mã hoá. */
  current: { id: string; key: Buffer };
  /** Mọi khoá (kể cả hiện hành) theo id: dùng để giải mã. */
  byId: ReadonlyMap<string, Buffer>;
}

/** Khoá thử cho dev/test: dẫn xuất từ nhãn, không phải khoá thật; production không bao giờ rơi vào nhánh này. */
function devKey(label: string): Buffer {
  return createHmac("sha256", "x-company/dev-only/not-a-secret").update(label).digest();
}

let ringCache: { raw: string | undefined; ring: Keyring } | undefined;

/** Bộ khoá hiện hành từ env (thiếu ở production → EnvError). Cache theo giá trị env để test đổi biến vẫn đúng. */
export function keyring(): Keyring {
  const raw = env("DATA_ENCRYPTION_KEYS");
  if (ringCache !== undefined && ringCache.raw === raw) return ringCache.ring;
  const byId = new Map<string, Buffer>();
  let current: { id: string; key: Buffer } | undefined;
  if (raw === undefined) {
    current = { id: "dev", key: devKey("data-encryption-key:v1") };
    byId.set(current.id, current.key);
  } else {
    for (const part of raw.split(",")) {
      const p = part.trim();
      const i = p.indexOf(":");
      const id = p.slice(0, i);
      const key = Buffer.from(p.slice(i + 1), "base64");
      byId.set(id, key);
      current ??= { id, key };
    }
  }
  const ring: Keyring = { current: current!, byId };
  ringCache = { raw, ring };
  return ring;
}

function indexKey(): Buffer {
  const raw = env("DATA_INDEX_KEY");
  return raw === undefined ? devKey("data-index-key:v1") : Buffer.from(raw, "base64");
}

/** Ngữ cảnh gắn vào AAD: bảng, cột và id dòng (uuid/số dạng chuỗi). */
export interface FieldContext {
  table: string;
  column: string;
  rowId: string;
}

const b64u = (b: Buffer) => b.toString("base64url");
const SEGMENT = /^[A-Za-z0-9_.-]+$/;

/** AAD cố định theo (bảng.cột, id dòng) — đổi một trong hai là giải mã thất bại. */
export function fieldAad(ctx: FieldContext): Buffer {
  if (!SEGMENT.test(ctx.table) || !SEGMENT.test(ctx.column) || ctx.rowId === "" || ctx.rowId.includes("|"))
    throw new CryptoError("BAD_CONTEXT", "ngữ cảnh mã hoá không hợp lệ (bảng/cột/id dòng)");
  return Buffer.from(`xc/${ENVELOPE_VERSION}|${ctx.table}.${ctx.column}|${ctx.rowId}`, "utf8");
}

/** Mã hoá một chuỗi bằng khoá hiện hành. Bản mã khác nhau mỗi lần (IV ngẫu nhiên). */
export function encryptField(ctx: FieldContext, plaintext: string, ring: Keyring = keyring()): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", ring.current.key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(fieldAad(ctx));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [ENVELOPE_VERSION, ring.current.id, b64u(iv), b64u(cipher.getAuthTag()), b64u(ct)].join(":");
}

export interface ParsedEnvelope {
  keyId: string;
  iv: Buffer;
  tag: Buffer;
  ct: Buffer;
}

export function parseEnvelope(envelope: string): ParsedEnvelope {
  const parts = envelope.split(":");
  if (parts.length !== 5 || parts[0] !== ENVELOPE_VERSION || parts[1] === "")
    throw new CryptoError("BAD_ENVELOPE", "phong bì mã hoá sai định dạng hoặc phiên bản không hỗ trợ");
  const iv = Buffer.from(parts[2]!, "base64url");
  const tag = Buffer.from(parts[3]!, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES)
    throw new CryptoError("BAD_ENVELOPE", "phong bì mã hoá sai độ dài IV/thẻ xác thực");
  return { keyId: parts[1]!, iv, tag, ct: Buffer.from(parts[4]!, "base64url") };
}

/** Giải mã; sai AAD (tráo dòng/cột), bản mã bị sửa hoặc sai khoá → CryptoError("AUTH_FAILED"). */
export function decryptField(ctx: FieldContext, envelope: string, ring: Keyring = keyring()): string {
  const p = parseEnvelope(envelope);
  const key = ring.byId.get(p.keyId);
  if (!key)
    throw new CryptoError("KEY_UNKNOWN", `không có khoá mã hoá id "${p.keyId}" trong DATA_ENCRYPTION_KEYS`);
  try {
    const d = createDecipheriv("aes-256-gcm", key, p.iv, { authTagLength: TAG_BYTES });
    d.setAAD(fieldAad(ctx));
    d.setAuthTag(p.tag);
    return Buffer.concat([d.update(p.ct), d.final()]).toString("utf8");
  } catch (err) {
    if (err instanceof CryptoError) throw err;
    throw new CryptoError("AUTH_FAILED", "giải mã thất bại: bản mã bị sửa, bị tráo dòng/cột hoặc sai khoá");
  }
}

/** null/undefined → null (cột cho phép NULL); chuỗi rỗng vẫn được mã hoá (khác NULL). */
export function encryptOptional(ctx: FieldContext, plaintext: string | null | undefined): string | null {
  return plaintext === null || plaintext === undefined ? null : encryptField(ctx, plaintext);
}

export function decryptOptional(ctx: FieldContext, envelope: string | null | undefined): string | null {
  return envelope === null || envelope === undefined ? null : decryptField(ctx, envelope);
}

/** keyId ghi trong phong bì (không giải mã) — dùng để biết dòng nào còn khoá cũ. */
export function envelopeKeyId(envelope: string): string {
  return parseEnvelope(envelope).keyId;
}

/** Chuẩn hoá để so khớp: NFC + bỏ khoảng trắng hai đầu + chữ thường. */
export function normalizeForIndex(value: string): string {
  return value.normalize("NFC").trim().toLowerCase();
}

/** Chuẩn hoá số điện thoại cho chỉ mục: bỏ khoảng trắng, dấu chấm, gạch, ngoặc (giữ `+` và chữ số). */
export function normalizePhone(value: string): string {
  return value.normalize("NFC").replace(/[\s.()-]/g, "");
}

/**
 * Chỉ mục mù: HMAC-SHA256(DATA_INDEX_KEY, "bảng.cột" + giá trị đã chuẩn hoá) dạng base64url. null/rỗng sau chuẩn hoá → null.
 * Cùng giá trị ở hai ngữ cảnh khác nhau cho hai chỉ mục khác nhau. Đổi DATA_INDEX_KEY = phải tính lại mọi chỉ mục (backfill --reindex).
 */
export function blindIndex(context: string, value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const norm = normalizeForIndex(value);
  if (norm === "") return null;
  return createHmac("sha256", indexKey())
    .update(`xc/bidx/${ENVELOPE_VERSION}|${context}|${norm}`, "utf8")
    .digest("base64url");
}
