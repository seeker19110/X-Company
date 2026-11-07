// Đăng ký kho tệp cho tiến trình (T-116, D-073): FILE_STORAGE=disk (mặc định) → không làm gì (lib/files/storage.ts tự dùng đĩa);
// s3 → kho đối tượng S3-compatible qua adapters/s3-http.ts. Gọi ở điểm vào của tiến trình phục vụ (instrumentation.ts). Cấu hình đọc
// lại mỗi lời gọi từ env (thiếu/sai đã bị chặn lúc khởi động bởi lib/nen/startup.ts — requiredWhen FILE_STORAGE=s3).
import { objectStorage, setStorage } from "../lib/files/storage.ts";
import { env } from "../lib/nen/env.ts";
import { s3Transport, type S3Config } from "./s3-http.ts";

/** Cấu hình S3 từ env (ném EnvError nêu TÊN biến khi thiếu — không in giá trị). */
export function s3ConfigFromEnv(): S3Config {
  const need = <T>(name: string, v: T | undefined): T => {
    if (v === undefined) throw new Error(`thiếu ${name} (FILE_STORAGE=s3)`);
    return v;
  };
  return {
    endpoint: need("S3_ENDPOINT", env("S3_ENDPOINT")),
    bucket: need("S3_BUCKET", env("S3_BUCKET")),
    region: env("S3_REGION"),
    accessKeyId: need("S3_ACCESS_KEY_ID", env("S3_ACCESS_KEY_ID")),
    secretAccessKey: need("S3_SECRET_ACCESS_KEY", env("S3_SECRET_ACCESS_KEY")),
  };
}

export function registerStorage(): void {
  if (env("FILE_STORAGE") !== "s3") return;
  s3ConfigFromEnv(); // fail sớm lúc khởi động nếu thiếu
  setStorage(objectStorage(s3Transport(s3ConfigFromEnv)));
}
