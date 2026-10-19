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
// Phiên bản 2 (KMS_PROVIDER=transit, T-052): MAGIC2(8) | wrappedLen(u16 BE) | wrapped(utf8, `vault:vN:…`) | khối như v1. DEK của tệp vẫn
// sinh cục bộ theo từng tệp (IV khối là bộ đếm nên mỗi tệp cần DEK riêng) nhưng được bọc bằng khoá chủ trong KMS; mở tệp = một lời gọi
// `decrypt` (có cache TTL ngắn). Tráo đầu tệp sang tệp khác bị phát hiện ở khối đầu (AAD khối gắn khoá lưu).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { kb } from "../nen/units.ts";
import { CryptoError, keyring, type Keyring } from "./index.ts";
import { keyProvider } from "./kms.ts";

export const FILE_MAGIC = Buffer.from("XCFILE\u0000\u0001", "latin1");
export const FILE_MAGIC_V2 = Buffer.from("XCFILE\u0000\u0002", "latin1");
const WRAPPED_MAX = 512;
/** Số byte đầu tệp đủ chứa đầu v1 hoặc v2 lớn nhất (đọc trước khi mở khoá). */
export const FILE_HEAD_MAX_BYTES = FILE_MAGIC.length + 2 + WRAPPED_MAX;
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
  if (head.length < FILE_MAGIC.length) return false;
  const m = head.subarray(0, FILE_MAGIC.length);
  return m.equals(FILE_MAGIC) || m.equals(FILE_MAGIC_V2);
}

const isV2File = (head: Buffer): boolean =>
  head.length >= FILE_MAGIC_V2.length && head.subarray(0, FILE_MAGIC_V2.length).equals(FILE_MAGIC_V2);

const needKms = (ring: Keyring) => {
  if (ring.kms === undefined)
    throw new CryptoError(
      "KEY_UNKNOWN",
      "tệp được mã hoá bằng KMS (v2) nhưng KMS_PROVIDER không phải transit",
    );
  return ring.kms;
};

function buildHeaderV2(wrapped: string): Buffer {
  const w = Buffer.from(wrapped, "utf8");
  const len = Buffer.alloc(2);
  len.writeUInt16BE(w.length);
  return Buffer.concat([FILE_MAGIC_V2, len, w]);
}

/** Đầu tệp v2: độ dài + chuỗi KMS đã bọc + phiên bản khoá chủ (đọc từ chuỗi). Cần đủ byte đầu. */
function parseHeaderV2(head: Buffer): { length: number; wrapped: string; version: number } {
  const o = FILE_MAGIC_V2.length;
  if (head.length < o + 2) throw new CryptoError("BAD_ENVELOPE", "đầu tệp mã hoá bị cụt");
  const n = head.readUInt16BE(o);
  if (n === 0 || n > WRAPPED_MAX || head.length < o + 2 + n)
    throw new CryptoError("BAD_ENVELOPE", "đầu tệp mã hoá (KMS) bị cụt hoặc sai độ dài");
  const wrapped = head.subarray(o + 2, o + 2 + n).toString("utf8");
  const m = /^vault:v([1-9][0-9]{0,8}):/.exec(wrapped);
  if (!m) throw new CryptoError("BAD_ENVELOPE", "đầu tệp mã hoá (KMS) sai định dạng chuỗi bọc");
  return { length: o + 2 + n, wrapped, version: Number(m[1]) };
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

/** Mở đầu tệp v1 hoặc v2 (v2 qua KMS). `ring` phải là bộ khoá của nhà cung cấp (có `kms` nếu v2). */
export async function openHeaderAsync(head: Buffer, ctx: FileContext, ring: Keyring): Promise<FileHeader> {
  if (!isV2File(head)) return openHeader(head, ctx, ring);
  const h = parseHeaderV2(head);
  try {
    return { keyId: `kms:${h.version}`, length: h.length, dek: await needKms(ring).unwrap(h.wrapped) };
  } catch (err) {
    if (err instanceof CryptoError) throw err;
    throw new CryptoError("AUTH_FAILED", "mở khoá tệp (KMS) thất bại");
  }
}

/**
 * Bọc lại DEK của tệp theo khoá chủ MỚI NHẤT (xoay khoá, không đụng nội dung): v2 → `rewrap` qua KMS (DEK không hiện ra ở đây);
 * v1 → khi có KMS thì chuyển sang v2 (mở bằng khoá env cũ, bọc bằng KMS), không có KMS thì như `rewrapHeader`.
 * `targetVersion`: phiên bản khoá chủ mới nhất của KMS (v2 đã ở phiên bản đó thì `changed=false`).
 */
export async function rewrapHeaderAsync(
  head: Buffer,
  ctx: FileContext,
  ring: Keyring,
  targetVersion?: number,
): Promise<{ header: Buffer; oldLength: number; changed: boolean }> {
  if (isV2File(head)) {
    const h = parseHeaderV2(head);
    if (targetVersion !== undefined && h.version >= targetVersion)
      return { header: head.subarray(0, h.length), oldLength: h.length, changed: false };
    const re = await needKms(ring).rewrap(h.wrapped);
    return { header: buildHeaderV2(re.wrapped), oldLength: h.length, changed: re.version !== h.version };
  }
  if (ring.kms === undefined) return rewrapHeader(head, ctx, ring);
  const h = openHeader(head, ctx, ring);
  const { wrapped } = await ring.kms.wrap(h.dek);
  return { header: buildHeaderV2(wrapped), oldLength: h.length, changed: true };
}

type Source = AsyncIterable<Buffer> | Iterable<Buffer>;

/** Mã hoá luồng: phát ra đầu tệp rồi từng khối đã mã hoá. Nguồn rỗng → một khối cuối rỗng. */
export async function* encryptFileStream(
  source: Source,
  ctx: FileContext,
  ringIn?: Keyring,
): AsyncGenerator<Buffer> {
  const ring = ringIn ?? (await keyProvider().ringForWrite());
  const dek = randomBytes(DEK);
  yield ring.kms !== undefined ? buildHeaderV2((await ring.kms.wrap(dek)).wrapped) : wrapDek(dek, ctx, ring);
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
  ringIn?: Keyring,
): AsyncGenerator<Buffer> {
  const ring = ringIn ?? (await keyProvider().ringForRead([]));
  const r = new Reader(source);
  // Đầu tệp có độ dài biến thiên (v1: idLen; v2: wrappedLen): đọc phần cố định rồi phần còn lại.
  const magic = await r.take(FILE_MAGIC.length);
  let header: FileHeader;
  if (isV2File(magic)) {
    const lenBuf = await r.take(2);
    if (lenBuf.length < 2) throw truncated();
    const rest = await r.take(lenBuf.readUInt16BE(0) <= WRAPPED_MAX ? lenBuf.readUInt16BE(0) : 0);
    header = await openHeaderAsync(Buffer.concat([magic, lenBuf, rest]), ctx, ring);
  } else {
    const idLenBuf = await r.take(1);
    const idLen = idLenBuf[0];
    if (magic.length < FILE_MAGIC.length || idLen === undefined) throw truncated();
    const rest = await r.take(idLen + IV + TAG + DEK);
    header = openHeader(Buffer.concat([magic, idLenBuf, rest]), ctx, ring);
  }
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
