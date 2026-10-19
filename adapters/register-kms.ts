// i18n-ignore-file: dòng khởi động cho người vận hành (stderr), không tới người dùng cuối
// Đăng ký transport KMS cho tiến trình (T-052): gọi ở điểm vào của MỌI tiến trình dùng lib/crypto — instrumentation.ts (server Next),
// scripts/worker.ts, crypto-rotate/backfill… KMS_PROVIDER=env: không làm gì. transit: kiểm cấu hình (thiếu/sai → thoát 78, fail-closed)
// rồi đăng ký transport `fetch`. Địa chỉ đọc lại mỗi lời gọi từ env (đổi KMS_TRANSIT_ADDR không cần khởi động lại tiến trình test).
import { CryptoError } from "../lib/crypto/index.ts";
import { assertKmsConfig, setKmsTransport, transitConfig } from "../lib/crypto/kms.ts";
import { env } from "../lib/nen/env.ts";
import { fetchTransitTransport } from "./kms-transit-http.ts";

export const EXIT_CONFIG = 78;

export function registerKms(exit: (code: number) => never = (c) => process.exit(c)): void {
  try {
    assertKmsConfig();
  } catch (err) {
    if (err instanceof CryptoError) {
      process.stderr.write(`[khởi động] KMS: ${err.message}\n`);
      return exit(EXIT_CONFIG);
    }
    throw err;
  }
  if (env("KMS_PROVIDER") !== "transit") return;
  setKmsTransport(fetchTransitTransport(() => transitConfig().addr));
}
