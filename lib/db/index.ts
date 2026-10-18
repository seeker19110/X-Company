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
    if (!url) throw new Error("Thiếu DATABASE_URL");
    appPool = new pg.Pool({ connectionString: url, max: Number(process.env.DB_POOL_MAX ?? 10) });
    appPool.on("connect", configureConnection);
  }
  return appPool;
}

/** Thiết lập phiên cho mọi kết nối mới (pool production và test dùng chung). Lỗi được ghi, không thành unhandled. */
export function configureConnection(c: pg.PoolClient): void {
  c.query("SET statement_timeout = '30s'; SET TIME ZONE 'UTC'").catch((err: unknown) => {
    console.error("[db] thiết lập kết nối lỗi:", err instanceof Error ? err.message : err);
  });
}

/** Thay pool (test). */
export function setPool(pool: pg.Pool | undefined): void {
  appPool = pool;
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
