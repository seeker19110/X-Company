// Kho tệp private qua adapter (D-005): mặc định đĩa cục bộ FILE_STORAGE_DIR; nhiều bản sao dùng kho đối tượng S3-compatible
// (FILE_STORAGE=s3, T-116/D-073): `objectStorage` ở đây giữ phần khoá + mã hoá; phần MẠNG (SigV4 + fetch) ở adapters/s3-http.ts,
// đăng ký bằng adapters/register-storage.ts (lib/ không chứa client mạng — DB-TX-003). Mọi backend chạy cùng contract test
// (tests/db/files-contract.test.ts).
// Khoá ngẫu nhiên, không chứa tên gốc; không có URL công khai — tải về chỉ qua route kiểm quyền.
// Mã hoá lúc lưu (T-048): tệp MỚI ghi đĩa mã hoá AES-256-GCM theo luồng, khoá dữ liệu theo tệp bọc bằng khoá chủ (lib/crypto/file.ts);
// khi phục vụ thì giải mã. Tệp CŨ (không có đầu phiên bản) là bản rõ và vẫn đọc được tới khi chạy `npm run -s crypto:rotate`.
import { randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readFile, unlink, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  collect,
  decryptFileStream,
  encryptFileStream,
  FILE_MAGIC,
  isEncryptedFile,
} from "../crypto/file.ts";
import { env } from "../nen/env.ts";
import { log } from "../nen/log.ts";

export interface Storage {
  put(data: Buffer): Promise<string>;
  /** Không có tệp → `StorageNotFoundError` (mọi backend). Khoá sai dạng → lỗi "Khoá tệp không hợp lệ". */
  get(key: string): Promise<Buffer>;
  /** Xoá bù blob mồ côi (khi giao dịch DB lỗi sau lúc ghi kho). Không có tệp → bỏ qua. */
  remove(key: string): Promise<void>;
}

export const STORAGE_KEY_RE = /^[0-9a-f]{2}\/[0-9a-f]{40}$/;
const KEY_RE = STORAGE_KEY_RE;

/** Không có tệp với khoá này — mọi backend ném cùng lỗi (`code: "ENOENT"` như lỗi đĩa của hệ điều hành). */
export class StorageNotFoundError extends Error {
  readonly code = "ENOENT";
  constructor() {
    // i18n-ignore: thông điệp cho vận hành/lập trình viên (route bọc thành lỗi 500 chung, không tới người dùng)
    super("Không có tệp với khoá này trong kho");
    this.name = "StorageNotFoundError";
  }
}

function checkedKey(key: string): string {
  if (!KEY_RE.test(key)) throw new Error("Khoá tệp không hợp lệ");
  return key;
}

/** Khoá mới: 160 bit ngẫu nhiên, không chứa tên gốc (`xx/<40 hex>`; hai ký tự đầu là thư mục con/tiền tố). */
function newKey(): { key: string; prefix: string } {
  const id = randomBytes(20).toString("hex");
  return { key: `${id.slice(0, 2)}/${id}`, prefix: id.slice(0, 2) };
}

export function diskStorage(
  root: string = env("FILE_STORAGE_DIR") ??
    path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "files"),
): Storage {
  const fileOf = (key: string) => path.join(/* turbopackIgnore: true */ root, checkedKey(key));
  return {
    async put(data) {
      const { key, prefix } = newKey();
      await mkdir(path.join(/* turbopackIgnore: true */ root, prefix), {
        recursive: true,
        mode: 0o700,
      });
      const file = fileOf(key);
      try {
        await pipeline(
          Readable.from(encryptFileStream([data], { storageKey: key })),
          createWriteStream(/* turbopackIgnore: true */ file, { mode: 0o600, flags: "wx" }),
        );
      } catch (err) {
        // Thiếu khoá / lỗi ghi: không để lại tệp dở dang (cờ wx: tệp thuộc về lần ghi này).
        try {
          await unlink(/* turbopackIgnore: true */ file);
        } catch (e) {
          if ((e as { code?: string }).code !== "ENOENT") throw e;
        }
        throw err;
      }
      return key;
    },
    // async: khoá sai phải thành promise bị từ chối (không ném đồng bộ ra khỏi lời gọi không `await`).
    async get(key) {
      const file = fileOf(key);
      let fh: FileHandle;
      try {
        fh = await open(/* turbopackIgnore: true */ file, "r");
      } catch (err) {
        if ((err as { code?: string }).code === "ENOENT") throw new StorageNotFoundError();
        throw err;
      }
      const head = Buffer.alloc(FILE_MAGIC.length);
      try {
        const { bytesRead } = await fh.read(head, 0, head.length, 0);
        if (!isEncryptedFile(head.subarray(0, bytesRead))) return await readFile(fh); // tệp cũ: bản rõ
      } finally {
        await fh.close();
      }
      return collect(
        decryptFileStream(createReadStream(/* turbopackIgnore: true */ file), { storageKey: key }),
      );
    },
    async remove(key) {
      try {
        await unlink(/* turbopackIgnore: true */ fileOf(key));
      } catch (err) {
        if ((err as { code?: string }).code !== "ENOENT") throw err;
      }
    },
  };
}

/**
 * Kho đối tượng THÔ (S3-compatible…): chỉ chuyển byte, không biết mã hoá. Hiện thực mạng ở adapters/ (lib/ không có client mạng).
 * `getObject` trả `null` khi không có đối tượng; `deleteObject` khi không có đối tượng → không lỗi (xoá idempotent).
 */
export interface ObjectTransport {
  putObject(key: string, body: Buffer): Promise<void>;
  getObject(key: string): Promise<Buffer | null>;
  deleteObject(key: string): Promise<void>;
}

/**
 * Kho đối tượng liệt kê được (T-126): thêm `listKeys` cho việc VẬN HÀNH duyệt cả kho — sao lưu/khôi phục thử
 * (lib/files/object-backup.ts) và xoay khoá (lib/crypto/rotate.ts `rotateObjects`). Đường phục vụ request không cần liệt kê.
 * Trả MỌI khoá trong kho (kể cả khoá lạ không do ứng dụng tạo — bên gọi tự phân loại), phân trang bên trong.
 */
export interface ObjectInventory extends ObjectTransport {
  listKeys(): AsyncIterable<string>;
}

/**
 * Kho tệp trên kho đối tượng: cùng giao ước và cùng định dạng mã hoá như `diskStorage` — backend chỉ thấy BẢN MÃ (AES-256-GCM theo
 * khối, DEK theo tệp bọc bằng khoá chủ/KMS, AAD gắn khoá lưu → tráo đối tượng sang khoá khác bị phát hiện). Kho đối tượng không có
 * "tệp cũ bản rõ": đối tượng thiếu đầu mã hoá bị từ chối (chặt hơn đĩa). Cả tệp nằm trong bộ nhớ (giao ước Buffer; trần 20 MB ở
 * lib/files); đối tượng ghi bằng MỘT PUT nên không có tệp dở dang.
 */
export function objectStorage(t: ObjectTransport): Storage {
  return {
    async put(data) {
      const { key } = newKey();
      const sealed = await collect(encryptFileStream([data], { storageKey: key }));
      try {
        await t.putObject(key, sealed);
      } catch (err) {
        // Hết thời gian chờ có thể xảy ra SAU khi máy chủ đã ghi: xoá bù (best-effort), lỗi gốc vẫn ném lên.
        try {
          await t.deleteObject(key);
        } catch (e) {
          log.warn("không xoá bù được đối tượng sau khi ghi kho lỗi (có thể còn blob mồ côi)", {
            storage_key: key,
            err: e,
          });
        }
        throw err;
      }
      return key;
    },
    async get(key) {
      const body = await t.getObject(checkedKey(key));
      if (body === null) throw new StorageNotFoundError();
      return collect(decryptFileStream([body], { storageKey: key }));
    },
    async remove(key) {
      await t.deleteObject(checkedKey(key));
    },
  };
}

// Kho đang dùng nằm ở globalThis (không phải biến module), như pool DB (lib/db/index.ts): Next đóng gói instrumentation.ts và từng
// route thành bản sao module RIÊNG — `setStorage` ở instrumentation (adapters/register-storage.ts) đặt vào biến module thì route không
// thấy và lặng lẽ rơi về đĩa cục bộ (e2e 2 bản sao bắt được: tải lên ở B, tải về ở A → 500). Một tiến trình = một kho.
const STORAGE_KEY = Symbol.for("x-company.files.storage");
const shared = globalThis as unknown as { [STORAGE_KEY]?: Storage };

export function getStorage(): Storage {
  shared[STORAGE_KEY] ??= diskStorage();
  return shared[STORAGE_KEY];
}
export function setStorage(s: Storage | undefined): void {
  shared[STORAGE_KEY] = s;
}
