// npm run retention:run — ẩn danh/xoá dữ liệu quá hạn (D-016). Chạy theo lịch (cron/systemd timer, xem RUNBOOK).
// RETENTION_ENABLED=false → không làm gì, exit 0.
import { closePool } from "../lib/db/index.ts";
import { log } from "../lib/nen/log.ts";
import { runRetention } from "../lib/worker/retention.ts";

try {
  const report = await runRetention();
  log.info(report.skipped ? "[retention] tắt (RETENTION_ENABLED=false)" : "[retention] xong", { ...report });
} catch (err) {
  log.error("[retention] lỗi", { err });
  process.exitCode = 1;
} finally {
  await closePool();
}
