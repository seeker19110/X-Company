// Metric RED (OPS-OBS-003): histogram `http_server_request_duration_seconds` theo OTel HTTP semconv
// (`http.server.request.duration`, Prometheus đổi dấu chấm → gạch dưới) + gauge `outbox_dead_total` (DLQ, BE-JOB-004).
// Tự viết, không thêm phụ thuộc: exposition format Prometheus text 0.0.4. Số chuỗi nhãn BỊ CHẶN: `http_route` là MẪU route
// (ROUTE_PATTERNS, khớp cây app/api bằng test), đường dẫn lạ → "unmatched"; method/status chuẩn hoá; quá MAX_SERIES thì bỏ qua
// chuỗi mới và đếm vào `http_server_series_dropped_total`. Bộ đếm nằm trong bộ nhớ tiến trình (mỗi instance một bộ).
import { timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { log } from "../nen/log.ts";
import { msToSeconds } from "../nen/units.ts";

export const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;
export const MAX_SERIES = 1_000;
export const OUTBOX_QUERY_TIMEOUT_MS = 2_000;

/** Mọi route API có đo (khớp các tệp route.ts dưới app/api — tests/unit/metrics.test.ts chặn lệch). Mẫu dùng `[tên]` như Next. */
export const ROUTE_PATTERNS: readonly string[] = [
  "/api/app/adjustments",
  "/api/app/applications",
  "/api/app/approvals/[type]/[id]/[decision]",
  "/api/app/approvals",
  "/api/app/attendance/events",
  "/api/app/attendance/qr/[worksiteId]",
  "/api/app/auth/login",
  "/api/app/auth/mfa",
  "/api/app/auth/logout",
  "/api/app/comments",
  "/api/app/files/[id]",
  "/api/app/files",
  "/api/app/inquiries",
  "/api/app/leave-requests",
  "/api/app/me",
  "/api/app/notifications/read",
  "/api/app/notifications",
  "/api/app/ot-requests",
  "/api/app/privacy/requests/[id]/[action]",
  "/api/app/privacy/requests",
  "/api/app/sync",
  "/api/app/tasks/[id]/[action]",
  "/api/app/tasks",
  "/api/healthz",
  "/api/metrics",
  "/api/public/applications",
  "/api/public/inquiries",
  "/api/public/rum",
  "/api/readyz",
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const COMPILED = ROUTE_PATTERNS.map((p) => ({
  pattern: p,
  re: new RegExp(
    "^" +
      p
        .split("/")
        .map((s) => (/^\[.+\]$/.test(s) ? "[^/]+" : escapeRe(s)))
        .join("/") +
      "/?$",
  ),
}));

export const UNMATCHED_ROUTE = "unmatched";

/** Đường dẫn thật → mẫu route (không bao giờ trả path đầy đủ/id). */
export function routeLabel(pathname: string): string {
  for (const c of COMPILED) if (c.re.test(pathname)) return c.pattern;
  return UNMATCHED_ROUTE;
}

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const normMethod = (m: string): string => {
  const u = m.toUpperCase();
  return METHODS.has(u) ? u : "_OTHER";
};
const normStatus = (s: number): string => (Number.isInteger(s) && s >= 100 && s <= 599 ? String(s) : "0");

interface Series {
  method: string;
  route: string;
  status: string;
  buckets: number[];
  count: number;
  sum: number;
}

const series = new Map<string, Series>();
let dropped = 0;
let syncItemErrors = 0;

export function resetMetrics(): void {
  series.clear();
  dropped = 0;
  syncItemErrors = 0;
}

/** Đếm một bản ghi đồng bộ ngoại tuyến gặp lỗi chưa lường (/api/app/sync trả HTTP 200 nên RED không thấy 5xx). */
export function countSyncItemError(): void {
  syncItemErrors += 1;
}

export function seriesCount(): number {
  return series.size;
}

/** Ghi một request đã xong. Không bao giờ ném (đo không được làm hỏng request). */
export function observeRequest(method: string, pathname: string, status: number, seconds: number): void {
  const m = normMethod(method);
  const route = routeLabel(pathname);
  const st = normStatus(status);
  const key = `${m}\u0000${route}\u0000${st}`;
  let s = series.get(key);
  if (!s) {
    if (series.size >= MAX_SERIES) {
      dropped += 1;
      return;
    }
    s = {
      method: m,
      route,
      status: st,
      buckets: new Array<number>(DURATION_BUCKETS.length).fill(0),
      count: 0,
      sum: 0,
    };
    series.set(key, s);
  }
  const v = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const hit = s;
  DURATION_BUCKETS.forEach((le, i) => {
    if (v <= le) hit.buckets[i] = (hit.buckets[i] ?? 0) + 1;
  });
  s.count += 1;
  s.sum += v;
}

const esc = (v: string): string => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");

/** Một dòng p75 RUM (cùng hình với lib/rum RumP75Row; khai lại để http không import miền rum). p75: ms với chỉ số thời gian, điểm với CLS. */
export interface RumP75Line {
  page: string;
  metric: string;
  p75: number;
  n: number;
}

export interface RenderOptions {
  /** Có (kể cả `null`) → in HELP/TYPE của rum_web_vitals_*; mảng → in mẫu. Vắng = RUM tắt, không in gì. */
  rum?: readonly RumP75Line[] | null;
}

const rumLabels = (r: RumP75Line): string => `page="${esc(r.page)}",metric="${esc(r.metric)}"`;
/** Chỉ số thời gian xuất bằng GIÂY (đơn vị cơ sở Prometheus); CLS là điểm không đơn vị. */
const rumValue = (r: RumP75Line): number => (r.metric === "CLS" ? r.p75 : msToSeconds(r.p75));

export function renderMetrics(outboxDead: number | null, opts: RenderOptions = {}): string {
  const out: string[] = [];
  out.push(
    // i18n-ignore: dòng HELP của Prometheus — siêu dữ liệu cho vận hành/bảng giám sát, không tới người dùng cuối
    "# HELP http_server_request_duration_seconds Thời gian xử lý request HTTP phía máy chủ (OTel http.server.request.duration).",
    "# TYPE http_server_request_duration_seconds histogram",
  );
  for (const k of [...series.keys()].sort()) {
    const s = series.get(k)!;
    const base = `http_request_method="${esc(s.method)}",http_route="${esc(s.route)}",http_response_status_code="${s.status}"`;
    DURATION_BUCKETS.forEach((le, i) =>
      out.push(`http_server_request_duration_seconds_bucket{${base},le="${le}"} ${s.buckets[i]}`),
    );
    out.push(
      `http_server_request_duration_seconds_bucket{${base},le="+Inf"} ${s.count}`,
      `http_server_request_duration_seconds_sum{${base}} ${s.sum}`,
      `http_server_request_duration_seconds_count{${base}} ${s.count}`,
    );
  }
  out.push(
    // i18n-ignore: dòng HELP của Prometheus — siêu dữ liệu cho vận hành/bảng giám sát, không tới người dùng cuối
    "# HELP http_server_series_dropped_total Số quan sát bị bỏ vì vượt trần số chuỗi nhãn.",
    "# TYPE http_server_series_dropped_total counter",
    `http_server_series_dropped_total ${dropped}`,
    // i18n-ignore: dòng HELP của Prometheus — siêu dữ liệu cho vận hành/bảng giám sát, không tới người dùng cuối
    "# HELP sync_item_errors_total Số bản ghi đồng bộ ngoại tuyến gặp lỗi chưa lường (kết quả INTERNAL trong lô HTTP 200).",
    "# TYPE sync_item_errors_total counter",
    `sync_item_errors_total ${syncItemErrors}`,
    // i18n-ignore: dòng HELP của Prometheus — siêu dữ liệu cho vận hành/bảng giám sát, không tới người dùng cuối
    "# HELP outbox_dead_total Số việc outbox ở trạng thái dead (DLQ); vắng mặt khi không đọc được DB.",
    "# TYPE outbox_dead_total gauge",
  );
  if (outboxDead !== null) out.push(`outbox_dead_total ${outboxDead}`);
  if (opts.rum !== undefined) {
    out.push(
      // i18n-ignore: dòng HELP của Prometheus — siêu dữ liệu cho vận hành/bảng giám sát, không tới người dùng cuối
      "# HELP rum_web_vitals_p75 p75 chỉ số web thực địa 24 giờ gần nhất theo trang (LCP/INP/FCP/TTFB: giây; CLS: điểm); chỉ nhóm đủ mẫu.",
      "# TYPE rum_web_vitals_p75 gauge",
    );
    const rows = opts.rum ?? [];
    for (const r of rows) out.push(`rum_web_vitals_p75{${rumLabels(r)}} ${rumValue(r)}`);
    out.push(
      // i18n-ignore: dòng HELP của Prometheus — siêu dữ liệu cho vận hành/bảng giám sát, không tới người dùng cuối
      "# HELP rum_web_vitals_samples Số mẫu RUM trong cửa sổ 24 giờ của từng nhóm (trang, chỉ số) đã tính p75.",
      "# TYPE rum_web_vitals_samples gauge",
    );
    for (const r of rows) out.push(`rum_web_vitals_samples{${rumLabels(r)}} ${r.n}`);
  }
  return out.join("\n") + "\n";
}

/** Đếm DLQ với timeout; lỗi/quá hạn → null (gauge vắng mặt thay vì báo 0 sai). */
export async function readOutboxDead(
  pool: Pick<pg.Pool, "query">,
  timeoutMs: number = OUTBOX_QUERY_TIMEOUT_MS,
): Promise<number | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const q = pool
    .query<{ n: string }>("SELECT count(*)::text AS n FROM outbox_event WHERE status = 'dead'")
    .then(
      (r) => Number(r.rows[0]?.n ?? 0),
      (err: unknown) => {
        log.warn("metrics: không đọc được outbox_dead_total", { err });
        return null;
      },
    );
  try {
    return await Promise.race([q, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Bearer token so sánh thời gian hằng; sai/thiếu → false. */
export function bearerMatches(header: string | null, token: string): boolean {
  const m = /^Bearer (.+)$/.exec(header ?? "");
  if (!m || token === "") return false;
  const a = Buffer.from(m[1]!);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
