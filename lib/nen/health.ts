// Health endpoint (OPS-OBS-006): `/api/healthz` = liveness, KHÔNG chạm phụ thuộc; `/api/readyz` = readiness, kiểm DB
// bằng `SELECT 1` có timeout; 503 khi DB không phản hồi hoặc tiến trình đang tắt. Không lộ chi tiết nội bộ (không
// chuỗi kết nối, không thông điệp lỗi) — chỉ trạng thái ngắn; chi tiết lỗi ghi log phía server.
import type pg from "pg";
import { getPool } from "../db/index.ts";
import { log } from "./log.ts";
import { isShuttingDown } from "./shutdown.ts";

export const READY_DB_TIMEOUT_MS = 2_000;
const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function body(status: string, code = 200): Response {
  return new Response(JSON.stringify({ status }), { status: code, headers: HEADERS });
}

export function liveness(): Response {
  return body("ok");
}

/** `SELECT 1` trong hạn `timeoutMs`; quá hạn coi như DB không sẵn sàng (truy vấn treo được pool dọn sau). */
export async function dbReachable(pool: pg.Pool, timeoutMs: number = READY_DB_TIMEOUT_MS): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const ping = pool.query("SELECT 1").then(
    () => true as const,
    (err: unknown) => {
      log.warn("readyz: DB lỗi", { err });
      return false as const;
    },
  );
  try {
    return await Promise.race([ping, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function readiness(
  getDb: () => pg.Pool = getPool,
  timeoutMs: number = READY_DB_TIMEOUT_MS,
): Promise<Response> {
  if (isShuttingDown()) return body("shutting_down", 503);
  let pool: pg.Pool;
  try {
    pool = getDb();
  } catch {
    return body("db_unavailable", 503); // thiếu cấu hình DB
  }
  return (await dbReachable(pool, timeoutMs)) ? body("ok") : body("db_unavailable", 503);
}

/** Handler route không tham số — route chỉ gán tên hàm (cùng mẫu publicRoute/withActor). */
export const healthzHandler = (): Response => liveness();
export const readyzHandler = (): Promise<Response> => readiness();
