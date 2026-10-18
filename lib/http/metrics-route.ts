// GET /api/metrics (OPS-OBS-003): chỉ truy cập nội bộ — bearer METRICS_TOKEN. Không đặt token → 404 (như không tồn tại).
import { getPool } from "../db/index.ts";
import { env } from "../nen/env.ts";
import { bearerMatches, readOutboxDead, renderMetrics } from "./metrics.ts";

const NO_STORE = { "cache-control": "no-store" };

export async function metricsHandler(req: Request): Promise<Response> {
  let token: string | undefined;
  try {
    token = env("METRICS_TOKEN");
  } catch {
    token = undefined; // token cấu hình sai (quá ngắn) → coi như tắt, fail-closed
  }
  if (token === undefined || token === "")
    return new Response("Not Found", { status: 404, headers: NO_STORE });
  if (!bearerMatches(req.headers.get("authorization"), token))
    return new Response("Unauthorized", {
      status: 401,
      headers: { ...NO_STORE, "www-authenticate": "Bearer" },
    });
  let dead: number | null = null;
  try {
    dead = await readOutboxDead(getPool());
  } catch {
    dead = null; // thiếu cấu hình DB: vẫn trả metric HTTP
  }
  return new Response(renderMetrics(dead), {
    status: 200,
    headers: { ...NO_STORE, "content-type": "text/plain; version=0.0.4; charset=utf-8" },
  });
}
