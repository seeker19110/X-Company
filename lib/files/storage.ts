// Kho tệp private qua adapter (D-005): mặc định đĩa cục bộ FILE_STORAGE_DIR; production thay bằng S3-compatible.
// Khoá ngẫu nhiên, không chứa tên gốc; không có URL công khai — tải về chỉ qua route kiểm quyền.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../nen/env.ts";

export interface Storage {
  put(data: Buffer): Promise<string>;
  get(key: string): Promise<Buffer>;
  /** Xoá bù blob mồ côi (khi giao dịch DB lỗi sau lúc ghi kho). Không có tệp → bỏ qua. */
  remove(key: string): Promise<void>;
}

const KEY_RE = /^[0-9a-f]{2}\/[0-9a-f]{40}$/;

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
      await writeFile(/* turbopackIgnore: true */ fileOf(key), data, { mode: 0o600, flag: "wx" });
      return key;
    },
    get: (key) => readFile(/* turbopackIgnore: true */ fileOf(key)),
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
