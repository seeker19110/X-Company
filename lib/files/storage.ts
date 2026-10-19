// Kho tệp private qua adapter (D-005): mặc định đĩa cục bộ FILE_STORAGE_DIR; production thay bằng S3-compatible.
// Khoá ngẫu nhiên, không chứa tên gốc; không có URL công khai — tải về chỉ qua route kiểm quyền.
// Mã hoá lúc lưu (T-048): tệp MỚI ghi đĩa mã hoá AES-256-GCM theo luồng, khoá dữ liệu theo tệp bọc bằng khoá chủ (lib/crypto/file.ts);
// khi phục vụ thì giải mã. Tệp CŨ (không có đầu phiên bản) là bản rõ và vẫn đọc được tới khi chạy `npm run -s crypto:rotate`.
import { randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
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

export interface Storage {
  put(data: Buffer): Promise<string>;
  get(key: string): Promise<Buffer>;
  /** Xoá bù blob mồ côi (khi giao dịch DB lỗi sau lúc ghi kho). Không có tệp → bỏ qua. */
  remove(key: string): Promise<void>;
}

export const STORAGE_KEY_RE = /^[0-9a-f]{2}\/[0-9a-f]{40}$/;
const KEY_RE = STORAGE_KEY_RE;

export function diskStorage(
  root: string = env("FILE_STORAGE_DIR") ??
    path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "files"),
): Storage {
  const fileOf = (key: string) => {
    if (!KEY_RE.test(key)) throw new Error("Khoá tệp không hợp lệ");
    return path.join(/* turbopackIgnore: true */ root, key);
  };
  return {
    async put(data) {
      const id = randomBytes(20).toString("hex");
      const key = `${id.slice(0, 2)}/${id}`;
      await mkdir(path.join(/* turbopackIgnore: true */ root, id.slice(0, 2)), {
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
      const fh = await open(/* turbopackIgnore: true */ file, "r");
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

let current: Storage | undefined;
export function getStorage(): Storage {
  current ??= diskStorage();
  return current;
}
export function setStorage(s: Storage | undefined): void {
  current = s;
}
