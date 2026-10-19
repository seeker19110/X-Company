// i18n-ignore-file: lỗi toàn vẹn/cấu hình cho vận hành (không tới người dùng cuối)
// Mã hoá tệp tải lên theo luồng (T-048) — phong bì khoá (envelope encryption): mỗi tệp một khoá dữ liệu (DEK) ngẫu nhiên 32 byte,
// DEK được BỌC bằng khoá chủ hiện hành (khoá đầu của DATA_ENCRYPTION_KEYS) và ghi ở đầu tệp; nội dung mã hoá AES-256-GCM theo
// khối 64 KiB. Xoay khoá chủ chỉ cần bọc lại DEK (đầu tệp), không mã hoá lại nội dung.
//
// Định dạng (phiên bản 1):
//   MAGIC(8) | idLen(1) | keyId | wrapIv(12) | wrapTag(16) | wrappedDek(32) | { flag(1) | ctLen(u32 BE) | ct | tag(16) }…
//   flag = 1 ở khối CUỐI (cắt cụt bị phát hiện); IV khối = 8 byte đếm khối + 4 byte 0 (DEK duy nhất theo tệp nên IV không lặp);
//   AAD khối = "xc/file/v1|<khoá lưu>|<số khối>|<flag>" → tráo khối, đảo thứ tự, cắt cụt, tráo tệp sang khoá lưu khác đều lỗi.
//   AAD bọc DEK = "xc/file-dek/v1|<khoá lưu>|<keyId>".
// Tệp cũ (không có MAGIC) là bản rõ cũ: đọc được như trước (cờ phiên bản = có/không MAGIC); tệp mới luôn mã hoá.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { kb } from "../nen/units.ts";
import { CryptoError, keyring, type Keyring } from "./index.ts";

export const FILE_MAGIC = Buffer.from("XCFILE\u0000\u0001", "latin1");
export const FILE_CHUNK_BYTES = kb(64);
const IV = 12;
const TAG = 16;
const DEK = 32;

export interface FileContext {
  /** Khoá lưu của tệp (`xx/<40 hex>`), gắn vào AAD để không tráo bản mã sang tệp khác. */
  storageKey: string;
}

const wrapAad = (ctx: FileContext, keyId: string) => Buffer.from(`xc/file-dek/v1|${ctx.storageKey}|${keyId}`);
const chunkAad = (ctx: FileContext, index: number, final: boolean) =>
  Buffer.from(`xc/file/v1|${ctx.storageKey}|${index}|${final ? 1 : 0}`);
const chunkIv = (index: number) => {
  const iv = Buffer.alloc(IV);
  iv.writeBigUInt64BE(BigInt(index), 0);
  return iv;
};

/** Đầu tệp có MAGIC → tệp mã hoá (phiên bản 1). */
export function isEncryptedFile(head: Buffer): boolean {
  return head.length >= FILE_MAGIC.length && head.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC);
}

function buildHeader(keyId: string, wrapIv: Buffer, wrapTag: Buffer, wrapped: Buffer): Buffer {
  const id = Buffer.from(keyId, "utf8");
  return Buffer.concat([FILE_MAGIC, Buffer.from([id.length]), id, wrapIv, wrapTag, wrapped]);
}

export function wrapDek(dek: Buffer, ctx: FileContext, ring: Keyring): Buffer {
  const iv = randomBytes(IV);
  const c = createCipheriv("aes-256-gcm", ring.current.key, iv, { authTagLength: TAG });
  c.setAAD(wrapAad(ctx, ring.current.id));
  const wrapped = Buffer.concat([c.update(dek), c.final()]);
  return buildHeader(ring.current.id, iv, c.getAuthTag(), wrapped);
}

export interface FileHeader {
  keyId: string;
  /** Số byte của đầu tệp (nội dung mã hoá bắt đầu từ đây). */
  length: number;
  dek: Buffer;
}

/** Đọc + mở khoá đầu tệp từ các byte đầu (cần ≥ độ dài đầu; đủ nếu đưa 128 byte). */
export function openHeader(head: Buffer, ctx: FileContext, ring: Keyring): FileHeader {
  if (!isEncryptedFile(head)) throw new CryptoError("BAD_ENVELOPE", "tệp không phải định dạng mã hoá");
  const idLen = head[FILE_MAGIC.length];
  if (idLen === undefined || idLen === 0) throw new CryptoError("BAD_ENVELOPE", "đầu tệp mã hoá bị cụt");
  const idStart = FILE_MAGIC.length + 1;
  const total = idStart + idLen + IV + TAG + DEK;
  if (head.length < total) throw new CryptoError("BAD_ENVELOPE", "đầu tệp mã hoá bị cụt");
  const keyId = head.subarray(idStart, idStart + idLen).toString("utf8");
  const key = ring.byId.get(keyId);
  if (!key)
    throw new CryptoError("KEY_UNKNOWN", `không có khoá mã hoá id "${keyId}" trong DATA_ENCRYPTION_KEYS`);
  const o = idStart + idLen;
  try {
    const d = createDecipheriv("aes-256-gcm", key, head.subarray(o, o + IV), { authTagLength: TAG });
    d.setAAD(wrapAad(ctx, keyId));
    d.setAuthTag(head.subarray(o + IV, o + IV + TAG));
    const dek = Buffer.concat([d.update(head.subarray(o + IV + TAG, total)), d.final()]);
    return { keyId, length: total, dek };
  } catch {
    throw new CryptoError(
      "AUTH_FAILED",
      "mở khoá tệp thất bại: đầu tệp bị sửa, bị tráo sang khoá lưu khác hoặc sai khoá",
    );
  }
}

/** Bọc lại DEK bằng khoá hiện hành (xoay khoá chủ): trả đầu tệp mới + độ dài đầu cũ để sao nội dung phần còn lại. */
export function rewrapHeader(
  head: Buffer,
  ctx: FileContext,
  ring: Keyring = keyring(),
): { header: Buffer; oldLength: number; changed: boolean } {
  const h = openHeader(head, ctx, ring);
  if (h.keyId === ring.current.id)
    return { header: head.subarray(0, h.length), oldLength: h.length, changed: false };
  return { header: wrapDek(h.dek, ctx, ring), oldLength: h.length, changed: true };
}

type Source = AsyncIterable<Buffer> | Iterable<Buffer>;

/** Mã hoá luồng: phát ra đầu tệp rồi từng khối đã mã hoá. Nguồn rỗng → một khối cuối rỗng. */
export async function* encryptFileStream(
  source: Source,
  ctx: FileContext,
  ring: Keyring = keyring(),
): AsyncGenerator<Buffer> {
  const dek = randomBytes(DEK);
  yield wrapDek(dek, ctx, ring);
  let index = 0;
  const seal = (block: Buffer, final: boolean): Buffer => {
    const c = createCipheriv("aes-256-gcm", dek, chunkIv(index), { authTagLength: TAG });
    c.setAAD(chunkAad(ctx, index, final));
    const ct = Buffer.concat([c.update(block), c.final()]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(ct.length);
    index += 1;
    return Buffer.concat([Buffer.from([final ? 1 : 0]), len, ct, c.getAuthTag()]);
  };
  let pending: Buffer = Buffer.alloc(0);
  for await (const part of source) {
    pending = Buffer.concat([pending, part]);
    while (pending.length > FILE_CHUNK_BYTES) {
      yield seal(pending.subarray(0, FILE_CHUNK_BYTES), false);
      pending = pending.subarray(FILE_CHUNK_BYTES);
    }
  }
  yield seal(pending, true);
}

/** Bộ đọc đủ-n-byte trên luồng (không giữ cả tệp). */
class Reader {
  private buf: Buffer = Buffer.alloc(0);
  private done = false;
  private readonly it: AsyncIterator<Buffer> | Iterator<Buffer>;
  constructor(source: Source) {
    this.it =
      Symbol.asyncIterator in source
        ? (source as AsyncIterable<Buffer>)[Symbol.asyncIterator]()
        : (source as Iterable<Buffer>)[Symbol.iterator]();
  }
  /** Đúng n byte, hoặc ít hơn nếu hết luồng (n = 0 luôn trả rỗng). */
  async take(n: number): Promise<Buffer> {
    while (this.buf.length < n && !this.done) {
      const r = await this.it.next();
      if (r.done) this.done = true;
      else this.buf = Buffer.concat([this.buf, r.value]);
    }
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(out.length);
    return out;
  }
}

const truncated = () => new CryptoError("AUTH_FAILED", "tệp mã hoá bị cắt cụt hoặc thiếu khối cuối");

/**
 * Giải mã luồng: mỗi khối được xác thực TRƯỚC khi phát ra; luồng hết mà chưa gặp khối cuối → lỗi (cắt cụt). Tệp không có
 * MAGIC (tệp cũ) → `legacy: pass-through` do người gọi quyết định bằng `isEncryptedFile` trước khi gọi.
 */
export async function* decryptFileStream(
  source: Source,
  ctx: FileContext,
  ring: Keyring = keyring(),
): AsyncGenerator<Buffer> {
  const r = new Reader(source);
  // Đầu tệp có độ dài biến thiên (idLen): đọc phần cố định rồi phần còn lại.
  const fixed = await r.take(FILE_MAGIC.length + 1);
  const idLen = fixed[FILE_MAGIC.length];
  if (fixed.length < FILE_MAGIC.length + 1 || idLen === undefined) throw truncated();
  const rest = await r.take(idLen + IV + TAG + DEK);
  const header = openHeader(Buffer.concat([fixed, rest]), ctx, ring);
  let index = 0;
  for (;;) {
    const meta = await r.take(5);
    if (meta.length < 5) throw truncated();
    const final = meta[0] === 1;
    if (meta[0] !== 0 && meta[0] !== 1)
      throw new CryptoError("BAD_ENVELOPE", "khối tệp mã hoá sai định dạng");
    const ctLen = meta.readUInt32BE(1);
    if (ctLen > FILE_CHUNK_BYTES) throw new CryptoError("BAD_ENVELOPE", "khối tệp mã hoá quá lớn");
    const body = await r.take(ctLen + TAG);
    if (body.length < ctLen + TAG) throw truncated();
    try {
      const d = createDecipheriv("aes-256-gcm", header.dek, chunkIv(index), { authTagLength: TAG });
      d.setAAD(chunkAad(ctx, index, final));
      d.setAuthTag(body.subarray(ctLen));
      yield Buffer.concat([d.update(body.subarray(0, ctLen)), d.final()]);
    } catch (err) {
      if (err instanceof CryptoError) throw err;
      throw new CryptoError(
        "AUTH_FAILED",
        "giải mã khối tệp thất bại: bản mã bị sửa, bị tráo hoặc sai thứ tự",
      );
    }
    index += 1;
    if (final) {
      if ((await r.take(1)).length > 0)
        throw new CryptoError("AUTH_FAILED", "tệp mã hoá có dữ liệu thừa sau khối cuối");
      return;
    }
  }
}

/** Tiện ích Buffer ↔ Buffer (kiểm thử, tệp nhỏ). */
export async function collect(gen: AsyncIterable<Buffer>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const p of gen) parts.push(p);
  return Buffer.concat(parts);
}
