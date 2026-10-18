// Worker outbox (ARC-INT-003/005, BE-JOB-001/003/004/007): lấy việc `FOR UPDATE SKIP LOCKED`, xử lý theo topic,
// thử lại với backoff mũ có jitter, hết lần/sai schema/lỗi vĩnh viễn → DLQ (`status = 'dead'`), khử trùng consumer.
// Mô hình: (1) giao dịch ngắn "claim" đánh dấu processing + thuê (locked_until) rồi commit; (2) mỗi việc chạy một giao dịch
// riêng gồm processed_message + tác động + đánh dấu done (nguyên tử). Worker chết → thuê hết hạn → việc được lấy lại.
import type pg from "pg";
import { getPool } from "../db/index.ts";
import { log, redactString } from "../nen/log.ts";
import { DEFAULT_MAX_ATTEMPTS, nextAttemptDelay } from "./backoff.pure.ts";
import { ChannelDisabledError, PermanentJobError } from "./channels.ts";
import { defaultRegistry, type JobEvent, type Registry } from "./handlers.ts";
import { msToSeconds } from "../nen/units.ts";

export { DEFAULT_MAX_ATTEMPTS, nextAttemptDelay } from "./backoff.pure.ts";
export { ChannelDisabledError, PermanentJobError, logChannel } from "./channels.ts";
export type { Channel, DeliveryMessage } from "./channels.ts";
export { defaultRegistry, Registry } from "./handlers.ts";
export type { Handler, JobEvent } from "./handlers.ts";

export interface WorkerOptions {
  registry?: Registry;
  /** Số việc tối đa mỗi lần lấy. */
  batchSize?: number;
  maxAttempts?: number;
  /** Thời gian thuê một việc (ms): quá hạn mà chưa xong → lấy lại. */
  leaseMs?: number;
  /** Chờ (ms) trước khi thử lại việc bị hoãn vì kênh tắt. */
  channelOffDelayMs?: number;
  now?: () => Date;
  rand?: () => number;
  pool?: pg.Pool;
}

export interface RunStats {
  claimed: number;
  done: number;
  retried: number;
  deferred: number;
  dead: number;
}

interface Claimed extends JobEvent {
  payload: unknown;
}

const MAX_ERROR_CHARS = 500;
const errorText = (e: unknown): string =>
  redactString(e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, MAX_ERROR_CHARS);

/** Lấy tối đa `limit` việc đến hạn (pending, hoặc processing quá hạn thuê) và đánh dấu processing; không lấy trùng giữa các worker. */
export async function claimEvents(
  pool: pg.Pool,
  limit: number,
  leaseMs: number,
  now: Date = new Date(),
): Promise<Claimed[]> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await c.query<{
      id: string;
      company_id: string | null;
      topic: string;
      payload: unknown;
      attempts: number;
    }>(
      `WITH picked AS (
         SELECT id FROM outbox_event
          WHERE (status = 'pending' AND next_attempt_at <= $2)
             OR (status = 'processing' AND locked_until < $2)
          ORDER BY next_attempt_at, id
          LIMIT $1
          FOR UPDATE SKIP LOCKED)
       UPDATE outbox_event e
          SET status = 'processing', attempts = e.attempts + 1,
              locked_until = $2::timestamptz + make_interval(secs => $3::double precision)
         FROM picked
        WHERE e.id = picked.id
       RETURNING e.id, e.company_id, e.topic, e.payload, e.attempts`,
      [limit, now, msToSeconds(leaseMs)],
    );
    await c.query("COMMIT");
    return r.rows
      .map((x) => ({
        id: Number(x.id),
        companyId: x.company_id,
        topic: x.topic,
        payload: x.payload,
        attempts: x.attempts,
      }))
      .sort((a, b) => a.id - b.id);
  } catch (err) {
    await rollback(c);
    throw err;
  } finally {
    c.release();
  }
}

async function rollback(c: pg.PoolClient): Promise<void> {
  await c.query("ROLLBACK").catch((e: unknown) => log.warn("rollback giao dịch worker thất bại", { err: e }));
}

type Outcome = "done" | "retried" | "deferred" | "dead";

async function markDead(pool: pg.Pool, ev: Claimed, error: string, now: Date): Promise<void> {
  await pool.query(
    `UPDATE outbox_event SET status = 'dead', dead_at = $2, last_error = $3, locked_until = NULL
      WHERE id = $1 AND status = 'processing'`,
    [ev.id, now, error],
  );
}

async function processOne(pool: pg.Pool, ev: Claimed, o: Required<WorkerOptions>): Promise<Outcome> {
  const now = o.now();
  const handler = o.registry.find(ev.topic);
  if (!handler) {
    // i18n-ignore: lý do DLQ cho vận hành (cột last_error của hàng outbox), không tới người dùng
    await markDead(pool, ev, `không có handler cho topic ${ev.topic}`, now);
    return "dead";
  }
  const parsed = handler.schema.safeParse(ev.payload);
  if (!parsed.success) {
    // Chỉ nêu đường dẫn trường + mã lỗi, không in giá trị payload.
    const issues = parsed.error.issues
      // i18n-ignore: lý do DLQ cho vận hành (đường dẫn trường + mã lỗi), không tới người dùng
      .map((i) => `${i.path.length > 0 ? i.path.join(".") : "(gốc)"}: ${i.code}`)
      .join("; ");
    await markDead(pool, ev, `payload sai schema — ${issues}`, now);
    return "dead";
  }
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    // Khử trùng: đã có (consumer, event_id) → không chạy lại tác động, chỉ đóng việc.
    const mark = await c.query(
      "INSERT INTO processed_message (consumer, event_id) VALUES ($1, $2) ON CONFLICT (consumer, event_id) DO NOTHING",
      [handler.consumer, ev.id],
    );
    if ((mark.rowCount ?? 0) > 0) await handler.handle(c, parsed.data, ev);
    await c.query(
      `UPDATE outbox_event SET status = 'done', processed_at = $2, locked_until = NULL, last_error = NULL
        WHERE id = $1 AND status = 'processing'`,
      [ev.id, now],
    );
    await c.query("COMMIT");
    return "done";
  } catch (err) {
    await rollback(c);
    if (err instanceof ChannelDisabledError) {
      // Kênh tắt: không tính là lần lỗi; giữ pending, thử lại sau.
      await pool.query(
        `UPDATE outbox_event SET status = 'pending', attempts = GREATEST(attempts - 1, 0), locked_until = NULL,
                last_error = $3, next_attempt_at = $2::timestamptz + make_interval(secs => $4::double precision)
          WHERE id = $1 AND status = 'processing'`,
        [ev.id, now, errorText(err), msToSeconds(o.channelOffDelayMs)],
      );
      return "deferred";
    }
    if (err instanceof PermanentJobError || ev.attempts >= o.maxAttempts) {
      await markDead(pool, ev, errorText(err), now);
      return "dead";
    }
    const delay = nextAttemptDelay(ev.attempts, o.rand());
    await pool.query(
      `UPDATE outbox_event SET status = 'pending', locked_until = NULL, last_error = $3,
              next_attempt_at = $2::timestamptz + make_interval(secs => $4::double precision)
        WHERE id = $1 AND status = 'processing'`,
      [ev.id, now, errorText(err), msToSeconds(delay)],
    );
    return "retried";
  } finally {
    c.release();
  }
}

/** Một lượt: lấy việc đến hạn và xử lý tuần tự. */
export async function runOnce(opts: WorkerOptions = {}): Promise<RunStats> {
  const o: Required<WorkerOptions> = {
    registry: opts.registry ?? defaultRegistry(),
    batchSize: opts.batchSize ?? 10,
    maxAttempts: opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    leaseMs: opts.leaseMs ?? 60_000,
    channelOffDelayMs: opts.channelOffDelayMs ?? 60_000,
    now: opts.now ?? (() => new Date()),
    rand: opts.rand ?? Math.random,
    pool: opts.pool ?? getPool(),
  };
  const events = await claimEvents(o.pool, o.batchSize, o.leaseMs, o.now());
  const stats: RunStats = { claimed: events.length, done: 0, retried: 0, deferred: 0, dead: 0 };
  for (const ev of events) {
    const out = await processOne(o.pool, ev, o);
    stats[out]++;
    if (out === "dead")
      log.error("việc outbox vào DLQ", { event_id: ev.id, topic: ev.topic, attempts: ev.attempts });
  }
  return stats;
}

/** Vòng lặp tới khi `signal` huỷ: còn việc → chạy tiếp ngay; hết việc → ngủ `pollMs`. Lượt đang chạy luôn xong trọn. */
export async function runLoop(
  signal: AbortSignal,
  opts: WorkerOptions & { pollMs?: number } = {},
): Promise<void> {
  const pollMs = opts.pollMs ?? 2_000;
  while (!signal.aborted) {
    let busy = false;
    try {
      busy = (await runOnce(opts)).claimed > 0;
    } catch (err) {
      log.error("lượt worker lỗi", { err });
    }
    if (!busy && !signal.aborted) await sleep(pollMs, signal);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

/** Đưa việc `dead` về pending (redrive, RUNBOOK). `ids` rỗng/không truyền = tất cả. Trả số hàng. */
export async function redriveDead(pool: pg.Pool, ids?: number[]): Promise<number> {
  const r = await pool.query(
    // Cắt về mili giây: worker so `next_attempt_at <= $now` với giờ JS (độ phân giải ms) — giữ micro giây của now()
    // làm việc vừa redrive bị bỏ qua nếu worker chạy trong cùng mili giây.
    `UPDATE outbox_event SET status = 'pending', attempts = 0, dead_at = NULL,
            next_attempt_at = date_trunc('milliseconds', now())
      WHERE status = 'dead' AND ($1::bigint[] IS NULL OR id = ANY($1::bigint[]))`,
    [ids && ids.length > 0 ? ids : null],
  );
  return r.rowCount ?? 0;
}
