// i18n-ignore-file: lỗi kho đối tượng cho người vận hành (không tới người dùng cuối; route bọc thành lỗi 500 chung)
// Phần MẠNG của kho tệp S3-compatible (T-116, D-073), tách khỏi lib/ vì lib/ không chứa client mạng (DB-TX-003): lib/files/storage.ts
// chỉ biết `ObjectTransport` + mã hoá; ở đây là chữ ký AWS Signature Version 4 tự viết bằng `node:crypto` và `fetch` (không phụ thuộc
// runtime mới). Chỉ ba thao tác PUT/GET/DELETE Object, kiểu đường dẫn (path-style: `<endpoint>/<bucket>/<khoá>`) — rclone/SeaweedFS/
// MinIO và đa số nhà cung cấp S3-compatible nhận; AWS S3 vẫn nhận path-style nhưng khuyến nghị virtual-hosted (cân nhắc khi chọn nhà
// cung cấp ở G7, D-005). Payload luôn KÝ (x-amz-content-sha256 = sha256 thân), không dùng UNSIGNED-PAYLOAD.
// TLS: kho CA hệ thống (+ NODE_EXTRA_CA_CERTS cho CA riêng) — KHÔNG có tuỳ chọn tắt kiểm chứng chứng chỉ. Không theo chuyển hướng
// (redirect: "error"). Khoá bí mật chỉ dùng để ký, không vào lỗi/log.
//
// Kiểm chữ ký: tests/unit/s3-sigv4.test.ts chạy vector của bộ "AWS Signature Version 4 test suite" (bản trong botocore
// tests/unit/auth/aws4_testsuite, tra 2026-11-06) + contract test với máy chủ thật (rclone serve s3 kiểm chữ ký V4).
import { createHash, createHmac } from "node:crypto";
import type { ObjectTransport } from "../lib/files/storage.ts";
import { mb, secondsToMs } from "../lib/nen/units.ts";

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface SigV4Request {
  method: string;
  /** host[:cổng] đúng như header Host sẽ gửi. */
  host: string;
  /** Đường dẫn ĐÃ GIẢI MÃ (vd `/bucket/ab/ab12…`); được mã hoá RFC 3986 từng đoạn, giữ `/`. */
  path: string;
  query?: ReadonlyArray<readonly [string, string]>;
  /** Header cần ký thêm (ngoài host, x-amz-date). Tên không phân biệt hoa thường. */
  headers?: Readonly<Record<string, string>>;
  /** Hex sha256 của thân (S3: cũng gửi trong x-amz-content-sha256). */
  payloadHash: string;
  region: string;
  service: string;
  date: Date;
  credentials: SigV4Credentials;
}

export interface SigV4Result {
  authorization: string;
  amzDate: string;
  canonicalRequest: string;
  stringToSign: string;
}

const sha256Hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data, "utf8").digest();

/** Mã hoá URI theo SigV4: giữ nguyên A-Z a-z 0-9 - _ . ~ ; còn lại %XX (UTF-8, chữ hoa). */
export function uriEncode(s: string, keepSlash = false): string {
  const out = encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return keepSlash ? out.replace(/%2F/g, "/") : out;
}

/** `20150830T123600Z` (UTC). */
export const amzDateOf = (d: Date): string =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

/** Giá trị header chuẩn hoá: bỏ khoảng trắng đầu/cuối, gộp chuỗi khoảng trắng liên tiếp thành một. */
const canonicalValue = (v: string) => v.trim().replace(/\s+/g, " ");

export function signV4(r: SigV4Request): SigV4Result {
  const amzDate = amzDateOf(r.date);
  const day = amzDate.slice(0, 8);
  const headers = new Map<string, string>();
  for (const [k, v] of Object.entries(r.headers ?? {})) headers.set(k.toLowerCase(), canonicalValue(v));
  headers.set("host", canonicalValue(r.host));
  headers.set("x-amz-date", amzDate);
  const names = [...headers.keys()].sort();
  const signedHeaders = names.join(";");
  const query = [...(r.query ?? [])]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonicalRequest = [
    r.method.toUpperCase(),
    uriEncode(r.path, true),
    query,
    names.map((n) => `${n}:${headers.get(n)}\n`).join(""),
    signedHeaders,
    r.payloadHash,
  ].join("\n");
  const scope = `${day}/${r.region}/${r.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${r.credentials.secretAccessKey}`, day);
  const kSigning = hmac(hmac(hmac(kDate, r.region), r.service), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${r.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    amzDate,
    canonicalRequest,
    stringToSign,
  };
}

export interface S3Config {
  /** Gốc URL (http(s)://host[:cổng]), không có đường dẫn. */
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** Lỗi kho S3: chỉ thao tác + mã HTTP + mã lỗi S3 (không khoá bí mật, không thân phản hồi thô). */
export class S3Error extends Error {
  constructor(
    readonly op: string,
    readonly status: number,
    readonly s3Code?: string,
  ) {
    super(`kho S3: ${op} thất bại (HTTP ${status}${s3Code === undefined ? "" : `, ${s3Code}`})`);
    this.name = "S3Error";
  }
}

const TIMEOUT_MS = secondsToMs(30);
/** Trần thân GET (tệp ≤ 20 MB + phần mã hoá): máy chủ trả lớn bất thường → từ chối thay vì đọc hết vào bộ nhớ. */
const MAX_OBJECT_BYTES = mb(32);
const EMPTY_SHA256 = sha256Hex("");

async function errorCode(res: Response): Promise<string | undefined> {
  try {
    const m = /<Code>([A-Za-z0-9.]{1,64})<\/Code>/.exec((await res.text()).slice(0, 4096));
    return m?.[1];
  } catch {
    return undefined;
  }
}

/**
 * `cfg` là hàm (đọc lại mỗi lời gọi) để test đổi cấu hình không cần tạo lại. `fetchFn`/`now` tiêm được để test.
 */
export function s3Transport(
  cfg: () => S3Config,
  fetchFn: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): ObjectTransport {
  async function call(op: string, method: string, key: string, body?: Buffer): Promise<Response> {
    const c = cfg();
    const base = new URL(c.endpoint);
    const objectPath = `/${c.bucket}/${key}`;
    const payloadHash = body === undefined ? EMPTY_SHA256 : sha256Hex(body);
    const sig = signV4({
      method,
      host: base.host,
      path: objectPath,
      headers: { "x-amz-content-sha256": payloadHash },
      payloadHash,
      region: c.region,
      service: "s3",
      date: now(),
      credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
    });
    try {
      return await fetchFn(`${base.origin}${uriEncode(objectPath, true)}`, {
        method,
        headers: {
          authorization: sig.authorization,
          "x-amz-date": sig.amzDate,
          "x-amz-content-sha256": payloadHash,
          ...(body === undefined ? {} : { "content-type": "application/octet-stream" }),
        },
        body: body === undefined ? undefined : new Uint8Array(body), // bản sao ArrayBuffer thuần (kiểu BodyInit)
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      // Lỗi mạng/hết giờ: nêu thao tác, giữ lỗi gốc ở `cause` (không chứa khoá bí mật — chữ ký chỉ ở header).
      throw new Error(`kho S3: ${op} không kết nối được`, { cause: err });
    }
  }
  return {
    async putObject(key, body) {
      const res = await call("PutObject", "PUT", key, body);
      if (res.status !== 200) throw new S3Error("PutObject", res.status, await errorCode(res));
      await res.body?.cancel();
    },
    async getObject(key) {
      const res = await call("GetObject", "GET", key);
      if (res.status === 404) {
        await res.body?.cancel();
        return null;
      }
      if (res.status !== 200) throw new S3Error("GetObject", res.status, await errorCode(res));
      const len = Number(res.headers.get("content-length") ?? "0");
      if (len > MAX_OBJECT_BYTES) {
        await res.body?.cancel();
        throw new S3Error("GetObject", res.status, "ObjectTooLarge");
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_OBJECT_BYTES) throw new S3Error("GetObject", res.status, "ObjectTooLarge");
      return buf;
    },
    async deleteObject(key) {
      const res = await call("DeleteObject", "DELETE", key);
      // S3 trả 204 cả khi không có đối tượng; một số máy chủ tương thích trả 404 → coi như đã xoá (idempotent).
      if (res.status !== 204 && res.status !== 200 && res.status !== 404)
        throw new S3Error("DeleteObject", res.status, await errorCode(res));
      await res.body?.cancel();
    },
  };
}
