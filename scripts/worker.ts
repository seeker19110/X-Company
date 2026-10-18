// npm run worker — relay outbox: lấy việc, giao qua kênh, thử lại có backoff, DLQ. Tắt êm khi nhận SIGTERM/SIGINT:
// xong lượt đang chạy rồi đóng pool, thoát 0 (lib/nen/shutdown dành cho http.Server nên không dùng ở đây).
import { closePool } from "../lib/db/index.ts";
import { env } from "../lib/nen/env.ts";
import { log } from "../lib/nen/log.ts";
import { runLoop } from "../lib/worker/index.ts";

const ctl = new AbortController();
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    log.warn(`[worker] nhận ${sig}: xong lượt hiện tại rồi dừng`);
    ctl.abort();
  });
}

log.info("[worker] bắt đầu");
try {
  await runLoop(ctl.signal, {
    maxAttempts: env("WORKER_MAX_ATTEMPTS"),
    batchSize: env("WORKER_BATCH_SIZE"),
    pollMs: env("WORKER_POLL_MS"),
  });
  log.info("[worker] đã dừng");
} finally {
  await closePool();
}
