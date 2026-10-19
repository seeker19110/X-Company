// Retention (D-016, D-030, STD-PRIV-005, XC-GREEN-007): thời hạn là CẤU HÌNH (lib/nen/env.ts, kèm nguồn luật + mức tin cậy).
// Liên hệ quá 24 tháng → ẩn danh PII (giữ bản ghi + mã để thống kê). Ứng viên KHÔNG trúng tuyển → ẩn danh sau 30 ngày kể từ
// khi chốt kết quả, trừ khi có đồng ý riêng "kho nhân tài" còn hiệu lực (khi đó 12 tháng); ứng viên chưa chốt quá lâu → lưới an
// toàn. Nhân viên đã chấm dứt hợp đồng → xoá liên hệ không phải giữ; hết 10 năm → ẩn danh họ tên (chấm công/lương giữ 10 năm).
// Session hết hạn, login_attempt, outbox done cũ, idempotency_record cũ, rum_sample quá hạn (T-056), public_rate_event quá 1 ngày → xoá.
// Mỗi nhóm một giao dịch + một bản ghi audit (chỉ đếm, không PII). Tắt: RETENTION_ENABLED=false (đường lùi D-016).
import type pg from "pg";
import { appendAudit } from "../audit/index.ts";
import { getPool, type Queryable, type Tx } from "../db/index.ts";
import { env } from "../nen/env.ts";
import { log } from "../nen/log.ts";
import { localDate } from "../nen/time.ts";
import { MS_PER_DAY } from "../nen/units.ts";
import { PURPOSE_TALENT_POOL } from "../privacy/consent.ts";

export interface RetentionConfig {
  enabled: boolean;
  inquiryDays: number;
  /** Ứng viên chưa chốt kết quả quá lâu (lưới an toàn). */
  applicationDays: number;
  /** Ứng viên không trúng tuyển: ngày kể từ khi chốt. */
  applicationDecidedDays: number;
  /** Ứng viên có đồng ý "kho nhân tài": ngày kể từ khi chốt. */
  talentPoolDays: number;
  /** Nhân viên đã chấm dứt hợp đồng: ngày kể từ ngày chấm dứt tới khi xoá liên hệ. */
  employeeTerminatedDays: number;
  /** Hồ sơ lao động/chấm công/lương: năm giữ kể từ ngày chấm dứt hợp đồng. */
  timesheetYears: number;
  /** Hồ sơ vi phạm dữ liệu: năm giữ sau khắc phục (chưa có bảng — hằng cho job/bảng tương lai). */
  breachRecordYears: number;
  sessionDays: number;
  loginAttemptDays: number;
  outboxDoneDays: number;
  idempotencyHours: number;
  /** Mẫu RUM (rum_sample): ngày kể từ lúc nhận. */
  rumDays: number;
}

export function retentionConfig(source?: Record<string, string | undefined>): RetentionConfig {
  return {
    enabled: env("RETENTION_ENABLED", source),
    inquiryDays: env("RETENTION_INQUIRY_DAYS", source),
    applicationDays: env("RETENTION_APPLICATION_DAYS", source),
    applicationDecidedDays: env("RETENTION_APPLICATION_DECIDED_DAYS", source),
    talentPoolDays: env("RETENTION_TALENT_POOL_DAYS", source),
    employeeTerminatedDays: env("RETENTION_EMPLOYEE_TERMINATED_DAYS", source),
    timesheetYears: env("RETENTION_TIMESHEET_YEARS", source),
    breachRecordYears: env("RETENTION_BREACH_RECORD_YEARS", source),
    sessionDays: env("RETENTION_SESSION_DAYS", source),
    loginAttemptDays: env("RETENTION_LOGIN_ATTEMPT_DAYS", source),
    outboxDoneDays: env("RETENTION_OUTBOX_DONE_DAYS", source),
    idempotencyHours: env("RETENTION_IDEMPOTENCY_HOURS", source),
    rumDays: env("RETENTION_RUM_DAYS", source),
  };
}

export interface RetentionReport {
  skipped: boolean;
  inquiryAnonymized: number;
  /** Tổng ứng viên bị ẩn danh lần chạy này (đã chốt + lưới an toàn). */
  applicationAnonymized: number;
  employeeContactCleared: number;
  employeeAnonymized: number;
  sessionDeleted: number;
  loginAttemptDeleted: number;
  outboxDoneDeleted: number;
  idempotencyDeleted: number;
  rumSampleDeleted: number;
  rateEventDeleted: number;
}

// i18n-ignore: giá trị dữ liệu ổn định ghi vào cột tên sau ẩn danh (so khớp/kiểm bằng truy vấn), không đổi theo ngôn ngữ
export const ANON_NAME = "[đã ẩn danh]";
/** Miền `.invalid` (RFC 2606) — không bao giờ gửi được; thoả CHECK/NOT NULL của bảng. */
export const ANON_EMAIL = "da-an-danh@anonymized.invalid";

const ago = (now: Date, ms: number): Date => new Date(now.getTime() - ms);
/** Lùi `years` năm theo lịch (UTC). 29/2 lùi về năm không nhuận → 1/3. */
export function yearsAgo(now: Date, years: number): Date {
  const d = new Date(now.getTime());
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d;
}
const DAY = MS_PER_DAY;
const HOUR = 3_600_000;
/** public_rate_event chỉ cần cửa sổ giới hạn tần suất (≤ 10 phút); giữ 1 ngày cho điều tra rồi xoá (trước đây tăng mãi). */
const RATE_EVENT_DAYS = 1;

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

type AnonTable = "inquiry" | "job_application";

// email giữ giá trị giả hợp lệ vì CHECK (inquiry: email hoặc phone) và NOT NULL (job_application).
const ANON_SETS: Record<AnonTable, string> = {
  inquiry:
    "name = $3, email = $4, phone = NULL, phone_enc = NULL, phone_bidx = NULL, message = $3, ip_hash = NULL",
  job_application:
    "name = $3, email = $4, phone = NULL, phone_enc = NULL, phone_bidx = NULL, cover_letter = NULL, ip_hash = NULL",
};

/**
 * Ẩn danh MỘT hàng theo id (yêu cầu xoá của chủ thể — T-040), cùng bộ cột với job retention. Chưa ẩn danh mới ghi;
 * trả true nếu hàng được ẩn danh lần này. Gọi trong giao dịch của người gọi (audit do người gọi ghi).
 */
export async function anonymizeById(
  tx: Queryable,
  table: AnonTable,
  companyId: string,
  id: string,
  now: Date,
): Promise<boolean> {
  // sql-interp-allow: `table` là AnonTable ("inquiry" | "job_application"); SET là hằng ANON_SETS; giá trị qua $1..$5.
  const r = await tx.query(
    `UPDATE ${table} SET ${ANON_SETS[table]}, anonymized_at = $2
      WHERE id = $1 AND company_id = $5 AND anonymized_at IS NULL`,
    [id, now, ANON_NAME, ANON_EMAIL, companyId],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Đồng ý "kho nhân tài" còn hiệu lực: sự kiện mới nhất của (ứng viên, mục đích) là 'grant'. */
// sql-interp-allow: PURPOSE_TALENT_POOL là hằng mã mục đích của lib/privacy/consent.ts (chữ thường + gạch dưới), không phải đầu vào.
const TALENT_POOL_ACTIVE = `(SELECT c.event FROM consent_record c
    WHERE c.subject_type = 'job_application' AND c.subject_id = job_application.id AND c.purpose_id = '${PURPOSE_TALENT_POOL}'
    ORDER BY c.id DESC LIMIT 1) = 'grant'`;

/** Ẩn danh các hàng của `table` thoả `where` (tham số $1..$5 cố định, xem nơi gọi); audit theo công ty. Trả tổng số hàng. */
async function anonymize(
  pool: pg.Pool,
  table: AnonTable,
  where: string,
  cutoffs: { a: Date; b: Date },
  now: Date,
  action = "retention.anonymize",
): Promise<number> {
  const sets = ANON_SETS[table];
  // Tham số chưa được tham chiếu làm Postgres không suy được kiểu → chỉ truyền $5 khi điều kiện dùng nó.
  const params = [cutoffs.a, now, ANON_NAME, ANON_EMAIL, ...(where.includes("$5") ? [cutoffs.b] : [])];
  return inTx(pool, async (tx) => {
    const r = await tx.query<{ company_id: string }>(
      // sql-interp-allow: `table` là "inquiry" | "job_application"; `sets`/`where` là hằng của lời gọi nội bộ trong tệp này; giá trị qua $1..$5.
      `UPDATE ${table} SET ${sets}, anonymized_at = $2 WHERE anonymized_at IS NULL AND ${where} RETURNING company_id`,
      params,
    );
    const per = new Map<string, number>();
    for (const row of r.rows) per.set(row.company_id, (per.get(row.company_id) ?? 0) + 1);
    for (const [companyId, n] of per) await audited(tx, companyId, action, table, cutoffs.a, n);
    return r.rowCount ?? 0;
  });
}

// Ứng viên không trúng tuyển (rejected | withdrawn) đã chốt: $1 = mốc 30 ngày, $5 = mốc 12 tháng (có đồng ý kho nhân tài).
// Hàng thiếu decided_at (dữ liệu cũ) lấy created_at. Đồng ý đã rút → như không có đồng ý. hired không bị đụng ở đây.
// sql-interp-allow: TALENT_POOL_ACTIVE là hằng SQL ngay phía trên; giá trị thời gian qua $1/$5.
const APPLICATION_DECIDED_WHERE = `status IN ('rejected', 'withdrawn')
  AND CASE WHEN ${TALENT_POOL_ACTIVE} THEN COALESCE(decided_at, created_at) < $5 ELSE COALESCE(decided_at, created_at) < $1 END`;
// Lưới an toàn cho hồ sơ chưa chốt quá lâu.
const APPLICATION_STALE_WHERE = "status IN ('new', 'screening', 'interview', 'offer') AND created_at < $1";

/** Nhân viên đã chấm dứt hợp đồng: xoá liên hệ không phải giữ theo luật (họ tên + mã + dữ liệu công giữ tới hết thời hạn luật). */
async function clearEmployeeContacts(pool: pg.Pool, cutoff: string, before: Date): Promise<number> {
  return inTx(pool, async (tx) => {
    const r = await tx.query<{ company_id: string }>(
      `UPDATE employee SET phone = NULL, phone_enc = NULL, phone_bidx = NULL, work_email = NULL
        WHERE terminated_on IS NOT NULL AND terminated_on < $1::date
          AND (phone IS NOT NULL OR phone_enc IS NOT NULL OR work_email IS NOT NULL)
        RETURNING company_id`,
      [cutoff],
    );
    const per = new Map<string, number>();
    for (const row of r.rows) per.set(row.company_id, (per.get(row.company_id) ?? 0) + 1);
    for (const [companyId, n] of per)
      await audited(tx, companyId, "retention.employee_contact", "employee", before, n);
    return r.rowCount ?? 0;
  });
}

/** Hết thời hạn giữ hồ sơ lao động: ẩn danh họ tên (mã nhân viên + dòng công/lương giữ nguyên, không còn gắn tên). */
async function anonymizeEmployees(pool: pg.Pool, cutoff: string, now: Date, before: Date): Promise<number> {
  return inTx(pool, async (tx) => {
    const r = await tx.query<{ company_id: string }>(
      `UPDATE employee SET full_name = $3, work_email = NULL, phone = NULL, phone_enc = NULL, phone_bidx = NULL, anonymized_at = $2
        WHERE terminated_on IS NOT NULL AND terminated_on < $1::date AND anonymized_at IS NULL
        RETURNING company_id`,
      [cutoff, now, ANON_NAME],
    );
    const per = new Map<string, number>();
    for (const row of r.rows) per.set(row.company_id, (per.get(row.company_id) ?? 0) + 1);
    for (const [companyId, n] of per)
      await audited(tx, companyId, "retention.employee_anonymize", "employee", before, n);
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
    employeeContactCleared: 0,
    employeeAnonymized: 0,
    sessionDeleted: 0,
    loginAttemptDeleted: 0,
    outboxDoneDeleted: 0,
    idempotencyDeleted: 0,
    rumSampleDeleted: 0,
    rateEventDeleted: 0,
  };
  if (!cfg.enabled) return report;
  const inquiryBefore = ago(now, cfg.inquiryDays * DAY);
  report.inquiryAnonymized = await anonymize(
    pool,
    "inquiry",
    "created_at < $1",
    { a: inquiryBefore, b: inquiryBefore },
    now,
  );
  const decidedBefore = ago(now, cfg.applicationDecidedDays * DAY);
  const talentBefore = ago(now, cfg.talentPoolDays * DAY);
  const staleBefore = ago(now, cfg.applicationDays * DAY);
  report.applicationAnonymized =
    (await anonymize(
      pool,
      "job_application",
      APPLICATION_DECIDED_WHERE,
      { a: decidedBefore, b: talentBefore },
      now,
    )) +
    (await anonymize(
      pool,
      "job_application",
      APPLICATION_STALE_WHERE,
      { a: staleBefore, b: staleBefore },
      now,
    ));
  const contactCutoff = localDate(ago(now, cfg.employeeTerminatedDays * DAY));
  report.employeeContactCleared = await clearEmployeeContacts(pool, contactCutoff, now);
  const recordBefore = yearsAgo(now, cfg.timesheetYears);
  report.employeeAnonymized = await anonymizeEmployees(pool, localDate(recordBefore), now, recordBefore);
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
  report.rumSampleDeleted = await purge(
    pool,
    "rum_sample",
    "retention.purge",
    "received_at < $1",
    ago(now, cfg.rumDays * DAY),
  );
  report.rateEventDeleted = await purge(
    pool,
    "public_rate_event",
    "retention.purge",
    "at < $1",
    ago(now, RATE_EVENT_DAYS * DAY),
  );
  return report;
}
