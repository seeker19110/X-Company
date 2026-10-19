// RUM web-vitals tự làm (T-056, D-042; PRF-WEB-005/008, FE-PERF-001): nhận số đo LCP/INP/CLS/FCP/TTFB từ trình duyệt thật,
// lưu theo NHÃN TRANG đã chuẩn hoá (page.pure.ts), gộp p75 theo (trang, chỉ số) cho /api/metrics + luật cảnh báo.
// Không IP, không user agent, không mã người dùng, không bên thứ ba. Cờ RUM_ENABLED mặc định tắt (tầng route/layout/metrics).
import type pg from "pg";
import { z } from "zod";
import { t } from "../i18n/index.ts";
import { log } from "../nen/log.ts";
import { MS_PER_DAY, minutesToMs } from "../nen/units.ts";
import { PAGE_MAX_LENGTH } from "./page.pure.ts";

export { KNOWN_APP_SECTIONS, pageLabel } from "./page.pure.ts";

export const RUM_METRICS = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;
export type RumMetric = (typeof RUM_METRICS)[number];
export const RUM_NAV_TYPES = ["navigate", "reload", "back_forward", "prerender"] as const;

/** Trần giá trị: chỉ số thời gian (mili giây, khớp CHECK của rum_sample.value_ms) và điểm CLS. */
export const RUM_MAX_TIME_MS = 120_000;
export const RUM_MAX_CLS = 10;
/** CLS lưu ×CLS_SCALE làm tròn thành số nguyên (rum_sample.cls_milli_n). */
export const CLS_SCALE = 1_000;
/** Giới hạn tần suất riêng của nhóm 'rum' (mỗi lượt xem gửi ≤ 1 beacon; cao hơn biểu mẫu vì nhiều người sau một NAT). */
export const RUM_RATE_LIMIT = { max: 60, windowMs: minutesToMs(10) };
/** Gộp p75 trên 24 giờ gần nhất, chỉ nhóm có ≥ RUM_MIN_SAMPLES mẫu (ít hơn thì p75 không có ý nghĩa). */
export const RUM_WINDOW_MS = MS_PER_DAY;
export const RUM_MIN_SAMPLES = 5;
export const RUM_QUERY_TIMEOUT_MS = 2_000;

const MetricName = z.enum(RUM_METRICS);

export const RumInput = z
  .object({
    page: z.string().min(1).max(PAGE_MAX_LENGTH).startsWith("/"),
    nav: z.enum(RUM_NAV_TYPES).optional(),
    metrics: z
      .array(
        z.object({
          name: MetricName,
          value: z.number().finite().min(0),
        }),
      )
      .min(1)
      .max(RUM_METRICS.length),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.metrics.forEach((m, i) => {
      if (seen.has(m.name))
        ctx.addIssue({ code: "custom", path: ["metrics", i, "name"], message: t("err.rum.tenChiSoTrung") });
      seen.add(m.name);
      const max = m.name === "CLS" ? RUM_MAX_CLS : RUM_MAX_TIME_MS;
      if (m.value > max)
        ctx.addIssue({
          code: "custom",
          path: ["metrics", i, "value"],
          message: t("err.rum.giaTriVuotTran", { max }),
        });
    });
  });
export type RumInputT = z.infer<typeof RumInput>;

/** Ghi các số đo của MỘT lượt xem trang trong MỘT câu lệnh. `page` đã là nhãn chuẩn hoá. Trả số dòng đã ghi. */
export async function insertRumSamples(
  db: Pick<pg.Pool, "query">,
  page: string,
  nav: string | null,
  metrics: RumInputT["metrics"],
): Promise<number> {
  const isCls = (n: string): boolean => n === "CLS";
  const r = await db.query(
    `INSERT INTO rum_sample (page, metric, value_ms, cls_milli_n, nav_type)
     SELECT $1, u.metric, u.value_ms, u.cls_milli_n, $5
       FROM unnest($2::text[], $3::int[], $4::int[]) AS u(metric, value_ms, cls_milli_n)`,
    [
      page,
      metrics.map((m) => m.name),
      metrics.map((m) => (isCls(m.name) ? null : Math.round(m.value))),
      metrics.map((m) => (isCls(m.name) ? Math.round(m.value * CLS_SCALE) : null)),
      nav,
    ],
  );
  return r.rowCount ?? 0;
}

export interface RumP75Row {
  page: string;
  metric: RumMetric;
  /** p75 (percentile_cont 0,75): mili giây với chỉ số thời gian, điểm (không đơn vị) với CLS. */
  p75: number;
  /** Số mẫu trong cửa sổ. */
  n: number;
}

/**
 * p75 theo (trang, chỉ số) trên RUM_WINDOW_MS gần nhất, chỉ nhóm có ≥ RUM_MIN_SAMPLES mẫu. Lỗi/quá hạn → null
 * (metric vắng mặt thay vì báo số sai) — cùng khuôn readOutboxDead.
 */
export async function readRumP75(
  pool: Pick<pg.Pool, "query">,
  timeoutMs: number = RUM_QUERY_TIMEOUT_MS,
  now: Date = new Date(),
): Promise<RumP75Row[] | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const since = new Date(now.getTime() - RUM_WINDOW_MS);
  const q = pool
    .query<{ page: string; metric: RumMetric; p75: number; n: number }>(
      `SELECT page, metric,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY COALESCE(value_ms, cls_milli_n)) AS p75,
              count(*)::int AS n
         FROM rum_sample
        WHERE received_at > $1 AND received_at <= $3
        GROUP BY page, metric
       HAVING count(*) >= $2
        ORDER BY page, metric`,
      [since, RUM_MIN_SAMPLES, now],
    )
    .then(
      (r): RumP75Row[] =>
        r.rows.map((x) => ({
          page: x.page,
          metric: x.metric,
          p75: x.metric === "CLS" ? x.p75 / CLS_SCALE : x.p75,
          n: x.n,
        })),
      (err: unknown) => {
        log.warn("metrics: không đọc được rum_web_vitals_p75", { err });
        return null;
      },
    );
  try {
    return await Promise.race([q, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
