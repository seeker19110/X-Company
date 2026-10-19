// Truy cập PostgreSQL bằng SQL thuần (ADR-0001). Placeholder `$1…` của pg — không tự chuyển `?` (bẫy XBOSS #4).
import pg from "pg";
import { env } from "../nen/env.ts";
import { log } from "../nen/log.ts";

export type Queryable = Pick<pg.PoolClient, "query">;
export type Tx = pg.PoolClient;

// Trả `date` dạng chuỗi YYYY-MM-DD (ngày nghiệp vụ, không gắn múi giờ) và bigint/numeric dạng chuỗi (tránh mất số).
pg.types.setTypeParser(pg.types.builtins.DATE, (v: string) => v);

// Pool nằm ở globalThis (không phải biến module): Next đóng gói trang SSR và route handler thành các bundle riêng, mỗi bundle
// một bản module này — biến module sẽ cho mỗi bundle một pool riêng và nhân đôi số kết nối DB (perf:load đo 20 thay vì ≤ 10).
const POOL_KEY = Symbol.for("x-company.db.appPool");
const shared = globalThis as unknown as { [POOL_KEY]?: pg.Pool };

/** Pool của ứng dụng — DATABASE_URL là role ứng dụng (không owner, không BYPASSRLS). Một pool cho cả tiến trình. */
export function getPool(): pg.Pool {
  let pool = shared[POOL_KEY];
  if (pool === undefined) {
    pool = new pg.Pool({
      connectionString: env("DATABASE_URL"),
      max: env("DB_POOL_MAX"),
      options: PG_SESSION_OPTIONS,
      ...POOL_TIMEOUTS,
    });
    guardIdleErrors(pool, "app");
    shared[POOL_KEY] = pool;
  }
  return pool;
}

/** Tham số phiên cho mọi kết nối (pool production và test dùng chung) — đặt lúc bắt tay, không chạy query riêng. */
export const PG_SESSION_OPTIONS =
  "-c statement_timeout=30000 -c idle_in_transaction_session_timeout=60000 -c TimeZone=UTC";

/**
 * Timeout phía client của pool (ARC-RES-001, BE-REL-001, DB-PERF-004): lấy/mở kết nối không treo vô hạn;
 * `query_timeout` lớn hơn statement_timeout của server (30 s) để server huỷ trước, client chỉ là lưới an toàn khi mạng treo.
 */
export const POOL_TIMEOUTS = {
  connectionTimeoutMillis: 5_000,
  query_timeout: 35_000,
} as const;

/** Thay pool (test). */
export function setPool(pool: pg.Pool | undefined): void {
  shared[POOL_KEY] = pool;
}

/**
 * Kết nối NHÀN RỖI trong pool bị máy chủ ngắt (DB khởi động lại/failover, admin kill, timeout phía server) làm pool phát
 * sự kiện `error`; không có listener → uncaughtException → tiến trình chết. Ghi log và để pool tự bỏ kết nối hỏng —
 * request kế tiếp mở kết nối mới (ARC-RES, tài liệu node-postgres "pool.on('error')").
 */
export function guardIdleErrors(pool: pg.Pool, name: string): pg.Pool {
  pool.on("error", (err) => log.warn("kết nối nhàn rỗi của pool bị ngắt", { pool: name, err }));
  return pool;
}

/** Đóng pool ứng dụng (tắt êm); không có pool thì không làm gì. */
export async function closePool(): Promise<void> {
  const p = shared[POOL_KEY];
  shared[POOL_KEY] = undefined;
  await p?.end();
}

/** Chạy `fn` trong một giao dịch; lỗi → ROLLBACK và ném lại. */
export async function withTx<T>(fn: (tx: Tx) => Promise<T>, pool: pg.Pool = getPool()): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    // Lỗi gốc `err` được ném lại; lỗi ROLLBACK chỉ ghi log (kết nối hỏng sẽ bị pool loại khi release).
    await client.query("ROLLBACK").catch((e: unknown) => log.warn("rollback giao dịch thất bại", { err: e }));
    throw err;
  } finally {
    client.release();
  }
}
