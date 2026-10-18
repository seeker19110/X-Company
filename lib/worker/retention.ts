// Retention (D-016, STD-PRIV-005, XC-GREEN-007): thời hạn là CẤU HÌNH (lib/nen/env.ts). Liên hệ/ứng viên quá hạn → ẩn danh PII
// (giữ bản ghi + mã để thống kê); session hết hạn, login_attempt, outbox done cũ, idempotency_record cũ → xoá.
// Mỗi nhóm một giao dịch + một bản ghi audit (chỉ đếm, không PII). Tắt: RETENTION_ENABLED=false (đường lùi D-016).
import type pg from "pg";
import { appendAudit } from "../audit/index.ts";
import { getPool, type Tx } from "../db/index.ts";
import { env } from "../nen/env.ts";
import { log } from "../nen/log.ts";

export interface RetentionConfig {
  enabled: boolean;
  inquiryDays: number;
  applicationDays: number;
  sessionDays: number;
  loginAttemptDays: number;
  outboxDoneDays: number;
  idempotencyHours: number;
}

export function retentionConfig(source?: Record<string, string | undefined>): RetentionConfig {
  return {
    enabled: env("RETENTION_ENABLED", source),
    inquiryDays: env("RETENTION_INQUIRY_DAYS", source),
    applicationDays: env("RETENTION_APPLICATION_DAYS", source),
    sessionDays: env("RETENTION_SESSION_DAYS", source),
    loginAttemptDays: env("RETENTION_LOGIN_ATTEMPT_DAYS", source),
    outboxDoneDays: env("RETENTION_OUTBOX_DONE_DAYS", source),
    idempotencyHours: env("RETENTION_IDEMPOTENCY_HOURS", source),
  };
}

export interface RetentionReport {
  skipped: boolean;
  inquiryAnonymized: number;
  applicationAnonymized: number;
  sessionDeleted: number;
  loginAttemptDeleted: number;
  outboxDoneDeleted: number;
  idempotencyDeleted: number;
}

export const ANON_NAME = "[đã ẩn danh]";
/** Miền `.invalid` (RFC 2606) — không bao giờ gửi được; thoả CHECK/NOT NULL của bảng. */
export const ANON_EMAIL = "da-an-danh@anonymized.invalid";

const ago = (now: Date, ms: number): Date => new Date(now.getTime() - ms);
const DAY = 86_400_000;
const HOUR = 3_600_000;

async function audited(
  tx: Tx,
  companyId: string | null,
  action: string,
  objectType: string,
  before: Date,
  count: number,
): Promise<void> {
  if (count === 0) return;
  await appendAudit(tx, {
    actorUserId: null,
    companyId,
    action,
    objectType,
    reason: "retention",
    after: { count, olderThan: before.toISOString() },
    sourceIp: null,
    userAgent: null,
  });
}

async function inTx<T>(pool: pg.Pool, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (err) {
    await c.query("ROLLBACK").catch((e: unknown) => log.warn("rollback retention thất bại", { err: e }));
    throw err;
  } finally {
    c.release();
  }
}

/** Ẩn danh các hàng quá hạn của `table` (inquiry|job_application); audit theo công ty. Trả tổng số hàng. */
async function anonymize(
  pool: pg.Pool,
  table: "inquiry" | "job_application",
  before: Date,
  now: Date,
): Promise<number> {
  // email giữ giá trị giả hợp lệ vì CHECK (inquiry: email hoặc phone) và NOT NULL (job_application).
  const sets =
    table === "inquiry"
      ? "name = $3, email = $4, phone = NULL, message = $3, ip_hash = NULL"
      : "name = $3, email = $4, phone = NULL, cover_letter = NULL, ip_hash = NULL";
  const params = [before, now, ANON_NAME, ANON_EMAIL];
  return inTx(pool, async (tx) => {
    const r = await tx.query<{ company_id: string }>(
      // sql-interp-allow: `table` là "inquiry" | "job_application"; `sets` là một trong hai hằng ở trên; giá trị qua $1..$4.
      `UPDATE ${table} SET ${sets}, anonymized_at = $2
        WHERE created_at < $1 AND anonymized_at IS NULL RETURNING company_id`,
      params,
    );
    const per = new Map<string, number>();
    for (const row of r.rows) per.set(row.company_id, (per.get(row.company_id) ?? 0) + 1);
    for (const [companyId, n] of per) await audited(tx, companyId, "retention.anonymize", table, before, n);
    return r.rowCount ?? 0;
  });
}

async function purge(
  pool: pg.Pool,
  table: string,
  action: string,
  where: string,
  before: Date,
): Promise<number> {
  return inTx(pool, async (tx) => {
    // sql-interp-allow: `table` và `where` là hằng của các lời gọi purge(...) nội bộ trong tệp này; `before` qua $1.
    const r = await tx.query(`DELETE FROM ${table} WHERE ${where}`, [before]);
    await audited(tx, null, action, table, before, r.rowCount ?? 0);
    return r.rowCount ?? 0;
  });
}

/** Outbox `done` cũ: xoá dấu khử trùng của chúng trước (FK), rồi xoá hàng. `dead` (DLQ) không bị đụng. */
async function purgeOutboxDone(pool: pg.Pool, before: Date): Promise<number> {
  return inTx(pool, async (tx) => {
    const old = "SELECT id FROM outbox_event WHERE status = 'done' AND processed_at < $1";
    // sql-interp-allow: `old` là hằng SELECT cục bộ (dòng trên), `before` qua $1.
    await tx.query(`DELETE FROM processed_message WHERE event_id IN (${old})`, [before]);
    const r = await tx.query("DELETE FROM outbox_event WHERE status = 'done' AND processed_at < $1", [
      before,
    ]);
    await audited(tx, null, "retention.purge", "outbox_event", before, r.rowCount ?? 0);
    return r.rowCount ?? 0;
  });
}

/** idempotency_record (T-028) có thể chưa tồn tại ở nhánh này → bỏ qua; cột thời gian `created_at`. */
async function purgeIdempotency(pool: pg.Pool, before: Date): Promise<number> {
  const t = await pool.query<{ ok: boolean }>(
    `SELECT to_regclass('public.idempotency_record') IS NOT NULL AND EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'idempotency_record' AND column_name = 'created_at') AS ok`,
  );
  if (!t.rows[0]?.ok) return 0;
  return purge(pool, "idempotency_record", "retention.purge", "created_at < $1", before);
}

export async function runRetention(
  opts: { config?: RetentionConfig; now?: Date; pool?: pg.Pool } = {},
): Promise<RetentionReport> {
  const cfg = opts.config ?? retentionConfig();
  const now = opts.now ?? new Date();
  const pool = opts.pool ?? getPool();
  const report: RetentionReport = {
    skipped: !cfg.enabled,
    inquiryAnonymized: 0,
    applicationAnonymized: 0,
    sessionDeleted: 0,
    loginAttemptDeleted: 0,
    outboxDoneDeleted: 0,
    idempotencyDeleted: 0,
  };
  if (!cfg.enabled) return report;
  report.inquiryAnonymized = await anonymize(pool, "inquiry", ago(now, cfg.inquiryDays * DAY), now);
  report.applicationAnonymized = await anonymize(
    pool,
    "job_application",
    ago(now, cfg.applicationDays * DAY),
    now,
  );
  report.sessionDeleted = await purge(
    pool,
    "session",
    "retention.purge",
    "absolute_expires_at < $1",
    ago(now, cfg.sessionDays * DAY),
  );
  report.loginAttemptDeleted = await purge(
    pool,
    "login_attempt",
    "retention.purge",
    "attempted_at < $1",
    ago(now, cfg.loginAttemptDays * DAY),
  );
  report.outboxDoneDeleted = await purgeOutboxDone(pool, ago(now, cfg.outboxDoneDays * DAY));
  report.idempotencyDeleted = await purgeIdempotency(pool, ago(now, cfg.idempotencyHours * HOUR));
  return report;
}
