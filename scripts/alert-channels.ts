// i18n-ignore-file: kênh/probe của cảnh báo vận hành, không tới người dùng cuối
// Phần MẠNG của cảnh báo cục bộ (T-046), tách khỏi lib/ vì lib/ không được chứa client mạng (DB-TX-003): webhook HTTP,
// scrape `/api/metrics`, probe `/api/readyz` và nối engine từ cấu hình. Dùng ở scripts/worker.ts và bài thử alerts:drill.
import type pg from "pg";
import { getPool } from "../lib/db/index.ts";
import { readiness } from "../lib/nen/health.ts";
import {
  AlertEngine,
  fileSink,
  loadRules,
  logSink,
  type AlertConfig,
  type AlertSink,
} from "../lib/ops/index.ts";

export const DEFAULT_WEBHOOK_TIMEOUT_MS = 5_000;

export function webhookSink(
  url: string,
  timeoutMs: number = DEFAULT_WEBHOOK_TIMEOUT_MS,
  fetchFn: typeof fetch = fetch,
): AlertSink {
  return {
    name: "webhook",
    async send(n) {
      let res: Response;
      try {
        res = await fetchFn(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(n),
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        // Thông điệp gốc có thể chứa URL (bí mật) → chỉ nêu loại lỗi.
        const kind =
          err instanceof Error && err.name === "TimeoutError" ? "hết thời gian chờ" : "lỗi kết nối";
        throw new Error(`webhook ${kind}`);
      }
      await res.body?.cancel();
      if (!res.ok) throw new Error(`webhook trả HTTP ${res.status}`);
    },
  };
}

export function sinksFromConfig(cfg: AlertConfig): AlertSink[] {
  const sinks: AlertSink[] = [fileSink(cfg.sinkFile), logSink];
  if (cfg.webhookUrl) sinks.push(webhookSink(cfg.webhookUrl, cfg.webhookTimeoutMs));
  return sinks;
}

async function httpGet(
  url: string,
  timeoutMs: number,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
}

export function engineFromConfig(cfg: AlertConfig, pool?: pg.Pool): AlertEngine {
  const dbPool = pool ?? getPool();
  const metricsUrl = cfg.metricsUrl;
  const readyzUrl = cfg.readyzUrl;
  const headers: Record<string, string> = cfg.metricsToken
    ? { authorization: `Bearer ${cfg.metricsToken}` }
    : {};
  return new AlertEngine(loadRules(cfg.rulesFile), {
    sinks: sinksFromConfig(cfg),
    repeatMs: cfg.repeatMs,
    pool: dbPool,
    backupDir: cfg.backupDir,
    ...(metricsUrl
      ? {
          metricsText: async () => {
            const res = await httpGet(metricsUrl, 5_000, headers);
            if (!res.ok) {
              await res.body?.cancel();
              throw new Error(`metrics HTTP ${res.status}`);
            }
            return res.text();
          },
        }
      : {}),
    readyz: readyzUrl
      ? async () => {
          const res = await httpGet(readyzUrl, 5_000);
          await res.body?.cancel();
          return res.status === 200;
        }
      : async () => (await readiness(() => dbPool as pg.Pool)).ok,
  });
}
