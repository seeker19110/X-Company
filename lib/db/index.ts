// Truy cập PostgreSQL bằng SQL thuần (ADR-0001). Placeholder `$1…` của pg — không tự chuyển `?` (bẫy XBOSS #4).
import pg from "pg";

export type Queryable = Pick<pg.PoolClient, "query">;
export type Tx = pg.PoolClient;

// Trả `date` dạng chuỗi YYYY-MM-DD (ngày nghiệp vụ, không gắn múi giờ) và bigint/numeric dạng chuỗi (tránh mất số).
pg.types.setTypeParser(pg.types.builtins.DATE, (v: string) => v);

let appPool: pg.Pool | undefined;

/** Pool của ứng dụng — DATABASE_URL là role ứng dụng (không owner, không BYPASSRLS). */
export function getPool(): pg.Pool {
  if (!appPool) {
    const url = process.env.DATABASE_URL?.trim();
    if (url === undefined || url === "") throw new Error("Thiếu DATABASE_URL");
    appPool = new pg.Pool({
      connectionString: url,
      max: Number(process.env.DB_POOL_MAX ?? 10),
      options: PG_SESSION_OPTIONS,
      ...POOL_TIMEOUTS,
    });
  }
  return appPool;
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
  appPool = pool;
}

/** Đóng pool ứng dụng (tắt êm); không có pool thì không làm gì. */
export async function closePool(): Promise<void> {
  const p = appPool;
  appPool = undefined;
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
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
