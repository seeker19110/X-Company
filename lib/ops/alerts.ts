// i18n-ignore-file: cảnh báo/chẩn đoán cho người vận hành (kênh trực, log), không tới người dùng cuối
// Bộ đánh giá cảnh báo cục bộ (T-046; OPS-SLO-004/005/006, OPS-OBS-003, BASE-ERR-011 phần cục bộ). KHÔNG thay Prometheus/
// Alertmanager: đọc luật `docs/ops/alerts.json`, thu tín hiệu từ (a) văn bản `/api/metrics` (scrape HTTP), (b) truy vấn DB,
// (c) probe readiness, (d) manifest sao lưu; mỗi luật là máy trạng thái ok → pending → firing → resolved với chống lặp:
// cùng một luật chỉ gửi "firing" một lần cho tới khi hết (resolved) hoặc qua cửa sổ nhắc `repeatMs`.
// Chạy theo chu kỳ trong tiến trình worker khi ALERTS_ENABLED=true (mặc định tắt). Trạng thái nằm trong bộ nhớ: khởi động
// lại thì mất (một cảnh báo đang bắn sẽ gửi lại một lần) — giới hạn đã biết, ghi ở docs/ops/SLO.md.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type pg from "pg";
import { verifyAuditChain } from "../audit/index.ts";
import { env } from "../nen/env.ts";
import { log } from "../nen/log.ts";
import { MS_PER_HOUR, SECONDS_PER_HOUR, msToSeconds, secondsToMs } from "../nen/units.ts";
import { dsarAnyOverdueSql } from "../privacy/deadlines.ts";
import type { AlertNotification, AlertSink } from "./sinks.ts";
import type { AlertRule, SignalName } from "./rules.ts";

export interface AlertConfig {
  enabled: boolean;
  intervalMs: number;
  repeatMs: number;
  rulesFile: string;
  sinkFile: string;
  webhookUrl: string | undefined;
  webhookTimeoutMs: number;
  metricsUrl: string | undefined;
  metricsToken: string | undefined;
  readyzUrl: string | undefined;
  backupDir: string;
}

export function alertConfig(source?: Record<string, string | undefined>): AlertConfig {
  return {
    enabled: env("ALERTS_ENABLED", source),
    intervalMs: env("ALERT_INTERVAL_MS", source),
    repeatMs: env("ALERT_REPEAT_MS", source),
    rulesFile: env("ALERT_RULES_FILE", source),
    sinkFile: env("ALERT_SINK_FILE", source),
    webhookUrl: env("ALERT_WEBHOOK_URL", source),
    webhookTimeoutMs: env("ALERT_WEBHOOK_TIMEOUT_MS", source),
    metricsUrl: env("ALERT_METRICS_URL", source),
    metricsToken: env("METRICS_TOKEN", source),
    readyzUrl: env("ALERT_READYZ_URL", source),
    backupDir: env("BACKUP_DIR", source),
  };
}

// ---- Văn bản metric Prometheus ---------------------------------------------------------------------------------

export interface Sample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

const LINE = /^([A-Za-z_:][A-Za-z0-9_:]*)(?:\{(.*)\})?\s+(\S+)(?:\s+-?\d+)?$/;
const LABEL = /([A-Za-z_][A-Za-z0-9_]*)="((?:[^"\\]|\\.)*)"/g;

/** Parse exposition format 0.0.4 (đủ cho `/api/metrics`); dòng lỗi bị bỏ qua, không ném. */
export function parseMetrics(text: string): Sample[] {
  const out: Sample[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const m = LINE.exec(line);
    if (!m) continue;
    const value = m[3] === "+Inf" ? Infinity : Number(m[3]);
    if (Number.isNaN(value)) continue;
    const labels: Record<string, string> = {};
    for (const l of (m[2] ?? "").matchAll(LABEL))
      labels[l[1]!] = l[2]!.replace(/\\(["\\n])/g, (_, c: string) => (c === "n" ? "\n" : c));
    out.push({ name: m[1]!, labels, value });
  }
  return out;
}

export const ATTENDANCE_ROUTE = "/api/app/attendance/events";

export interface HttpTotals {
  total: number;
  errors: number;
  attTotal: number;
  /** Yêu cầu ghi chấm công xử lý ≤ 1 s (bucket le="1"). */
  attGood: number;
}

export function httpTotals(samples: Sample[]): HttpTotals {
  const t: HttpTotals = { total: 0, errors: 0, attTotal: 0, attGood: 0 };
  for (const s of samples) {
    if (s.name === "http_server_request_duration_seconds_count") {
      t.total += s.value;
      if (/^5\d\d$/.test(s.labels.http_response_status_code ?? "")) t.errors += s.value;
      if (s.labels.http_route === ATTENDANCE_ROUTE) t.attTotal += s.value;
    } else if (
      s.name === "http_server_request_duration_seconds_bucket" &&
      s.labels.http_route === ATTENDANCE_ROUTE &&
      s.labels.le === "1"
    )
      t.attGood += s.value;
  }
  return t;
}

// ---- Máy trạng thái một luật ----------------------------------------------------------------------------------

export interface RuleState {
  phase: "ok" | "pending" | "firing";
  /** Lúc điều kiện bắt đầu đúng (ms). */
  since: number | null;
  /** Lần gửi "firing" gần nhất (ms). */
  lastNotifiedAt: number | null;
}
export const FRESH_STATE: RuleState = { phase: "ok", since: null, lastNotifiedAt: null };
export type Transition = "firing" | "repeat" | "resolved" | null;

export const conditionHolds = (r: Pick<AlertRule, "op" | "threshold">, v: number): boolean =>
  r.op === "gt" ? v > r.threshold : v >= r.threshold;

/** Một bước: `value = null` (không có dữ liệu) giữ nguyên trạng thái, không gửi gì. */
export function stepRule(
  rule: Pick<AlertRule, "op" | "threshold" | "forSeconds">,
  value: number | null,
  nowMs: number,
  st: RuleState,
  repeatMs: number,
): { state: RuleState; transition: Transition } {
  if (value === null) return { state: st, transition: null };
  if (!conditionHolds(rule, value)) {
    if (st.phase === "firing") return { state: FRESH_STATE, transition: "resolved" };
    return { state: FRESH_STATE, transition: null };
  }
  const since = st.since ?? nowMs;
  if (st.phase === "firing") {
    const due = repeatMs > 0 && nowMs - (st.lastNotifiedAt ?? nowMs) >= repeatMs;
    return due
      ? { state: { ...st, lastNotifiedAt: nowMs }, transition: "repeat" }
      : { state: st, transition: null };
  }
  if (nowMs - since >= secondsToMs(rule.forSeconds))
    return { state: { phase: "firing", since, lastNotifiedAt: nowMs }, transition: "firing" };
  return { state: { phase: "pending", since, lastNotifiedAt: null }, transition: null };
}

// ---- Thu tín hiệu ------------------------------------------------------------------------------------------------

/** Tuổi giả định khi chưa từng có bản sao lưu hợp lệ (100 năm) — luôn vượt mọi ngưỡng RPO. */
export const BACKUP_NEVER_AGE_SECONDS = 3_153_600_000;

/** Tuổi (giây) của bản sao lưu HOÀN CHỈNH mới nhất (manifest + tệp dữ liệu còn đó) trong `dir`. */
export function backupAgeSeconds(dir: string, nowMs: number): number {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return BACKUP_NEVER_AGE_SECONDS;
  }
  const manifests = names
    .filter((n) => /^xc-.*\.manifest\.json$/.test(n))
    .sort()
    .reverse();
  for (const m of manifests) {
    try {
      const j = JSON.parse(readFileSync(path.join(dir, m), "utf8")) as {
        file?: unknown;
        created_at_utc?: unknown;
      };
      const t = Date.parse(String(j.created_at_utc));
      if (
        typeof j.file === "string" &&
        existsSync(path.join(dir, path.basename(j.file))) &&
        Number.isFinite(t)
      )
        return Math.max(0, msToSeconds(nowMs - t));
    } catch {
      // manifest hỏng → thử bản trước đó
    }
  }
  return BACKUP_NEVER_AGE_SECONDS;
}

interface Snapshot extends HttpTotals {
  t: number;
}

const delta = (cur: number, base: number): number => (cur < base ? cur : cur - base); // counter reset → tính từ 0

function ratioOver(
  history: Snapshot[],
  cur: Snapshot,
  windowS: number,
  minEvents: number,
  pick: (s: HttpTotals) => { bad: number; events: number },
): number | null {
  const cutoff = cur.t - secondsToMs(windowS);
  const older = history.filter((s) => s !== cur);
  const base = [...older].reverse().find((s) => s.t <= cutoff) ?? older[0];
  if (!base) return null;
  const c = pick(cur);
  const b = pick(base);
  const events = delta(c.events, b.events);
  if (events < minEvents) return 0;
  return Math.min(1, delta(c.bad, b.bad) / events);
}

const timeoutAfter = <T>(p: Promise<T>, ms: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("quá thời gian truy vấn")), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
};
export const DB_SIGNAL_TIMEOUT_MS = 5_000;

export interface EngineDeps {
  sinks: AlertSink[];
  now?: () => Date;
  repeatMs?: number;
  /** Trả văn bản `/api/metrics`; ném khi không scrape được. Không đặt = không có tín hiệu HTTP. */
  metricsText?: () => Promise<string>;
  /** true = sẵn sàng. Không đặt = không có tín hiệu readyz. */
  readyz?: () => Promise<boolean>;
  pool?: Pick<pg.Pool, "query">;
  backupDir?: string;
  /** Kiểm chuỗi audit (mặc định `verifyAuditChain` trên `pool`). */
  verifyChain?: (pool: Pick<pg.Pool, "query">) => Promise<boolean>;
}

export interface EvalResult {
  rule: string;
  value: number | null;
  phase: RuleState["phase"];
  notified: Transition;
  /** Số kênh nhận được thông báo (0 khi không gửi). */
  delivered: number;
}

export class AlertEngine {
  private readonly states = new Map<string, RuleState>();
  private history: Snapshot[] = [];
  private auditCache: { at: number; value: number } | null = null;

  constructor(
    readonly rules: AlertRule[],
    private readonly deps: EngineDeps,
  ) {}

  stateOf(id: string): RuleState {
    return this.states.get(id) ?? FRESH_STATE;
  }

  private async scrape(nowMs: number): Promise<{ failed: boolean | null; cur: Snapshot | null }> {
    const fetchText = this.deps.metricsText;
    if (!fetchText) return { failed: null, cur: null };
    try {
      const cur: Snapshot = { t: nowMs, ...httpTotals(parseMetrics(await fetchText())) };
      const horizon = secondsToMs(Math.max(0, ...this.rules.flatMap((r) => r.windows ?? []))) + MS_PER_HOUR;
      this.history = [...this.history.filter((s) => s.t >= nowMs - horizon), cur];
      return { failed: false, cur };
    } catch (err) {
      log.warn("cảnh báo: không scrape được metrics", { error: err instanceof Error ? err.name : "lỗi" });
      return { failed: true, cur: null };
    }
  }

  private async db(rule: AlertRule, sql: string, params: unknown[]): Promise<number | null> {
    const pool = this.deps.pool;
    if (!pool) return null;
    try {
      const r = await timeoutAfter(pool.query<{ n: number }>(sql, params), DB_SIGNAL_TIMEOUT_MS);
      return Number(r.rows[0]?.n ?? 0);
    } catch (err) {
      log.warn("cảnh báo: không đọc được tín hiệu từ DB", { rule: rule.id, signal: rule.signal, err });
      return null;
    }
  }

  private async auditBroken(rule: AlertRule, nowMs: number): Promise<number | null> {
    const pool = this.deps.pool;
    if (!pool) return null;
    const every = secondsToMs(rule.params?.min_interval_seconds ?? SECONDS_PER_HOUR);
    if (this.auditCache && nowMs - this.auditCache.at < every) return this.auditCache.value;
    try {
      const verify = this.deps.verifyChain ?? (async (p) => (await verifyAuditChain(p)).ok);
      const value = (await timeoutAfter(verify(pool), 10 * DB_SIGNAL_TIMEOUT_MS)) ? 0 : 1;
      this.auditCache = { at: nowMs, value };
      return value;
    } catch (err) {
      log.warn("cảnh báo: không kiểm được chuỗi audit", { rule: rule.id, err });
      return null;
    }
  }

  private async signal(
    rule: AlertRule,
    nowMs: number,
    http: { failed: boolean | null; cur: Snapshot | null },
  ): Promise<number | null> {
    const nowDate = new Date(nowMs);
    const p = rule.params ?? {};
    const sig: SignalName = rule.signal;
    switch (sig) {
      case "http_5xx_ratio":
      case "attendance_slow_ratio": {
        if (!http.cur) return null;
        const cur = http.cur;
        const pick =
          sig === "http_5xx_ratio"
            ? (s: HttpTotals) => ({ bad: s.errors, events: s.total })
            : (s: HttpTotals) => ({ bad: s.attTotal - s.attGood, events: s.attTotal });
        const vals = (rule.windows ?? []).map((w) =>
          ratioOver(this.history, cur, w, rule.minEvents ?? 1, pick),
        );
        // Mọi cửa sổ phải cùng vượt ngưỡng ⇒ lấy giá trị nhỏ nhất; thiếu dữ liệu ở một cửa sổ ⇒ không đánh giá.
        return vals.some((v) => v === null) ? null : Math.min(...(vals as number[]));
      }
      case "scrape_failed":
        return http.failed === null ? null : http.failed ? 1 : 0;
      case "readyz_down": {
        if (!this.deps.readyz) return null;
        try {
          return (await this.deps.readyz()) ? 0 : 1;
        } catch {
          return 1;
        }
      }
      case "outbox_dead":
        return this.db(rule, "SELECT count(*)::int AS n FROM outbox_event WHERE status = 'dead'", []);
      case "outbox_stale":
        return this.db(
          rule,
          `SELECT count(*)::int AS n FROM outbox_event
            WHERE (status = 'pending' AND next_attempt_at < $1::timestamptz - make_interval(secs => $2::double precision))
               OR (status = 'processing' AND locked_until < $1::timestamptz - make_interval(secs => $2::double precision))`,
          [nowDate, p.stale_seconds ?? 300],
        );
      case "dsar_overdue":
        // Quá hạn thực hiện (theo loại + gia hạn) HOẶC quá hạn phản hồi "đã nhận" — cùng điều kiện với lib/privacy (D-029).
        return this.db(
          rule,
          "SELECT count(*)::int AS n FROM data_subject_request WHERE " + dsarAnyOverdueSql("$1"),
          [nowDate],
        );
      case "period_close_overdue":
        return this.db(
          rule,
          `SELECT count(*)::int AS n FROM attendance_period
            WHERE status <> 'locked' AND end_date < ($1::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - $2::int`,
          [nowDate, Math.trunc(p.grace_days ?? 7)],
        );
      case "backup_age_seconds":
        return this.deps.backupDir === undefined ? null : backupAgeSeconds(this.deps.backupDir, nowMs);
      case "audit_chain_broken":
        return this.auditBroken(rule, nowMs);
    }
  }

  private async dispatch(n: AlertNotification): Promise<number> {
    const results = await Promise.allSettled(this.deps.sinks.map((s) => s.send(n)));
    let ok = 0;
    results.forEach((r, i) => {
      if (r.status === "fulfilled") ok++;
      else
        log.warn("cảnh báo: kênh đích lỗi", {
          sink: this.deps.sinks[i]!.name,
          rule: n.rule,
          error: r.reason instanceof Error ? r.reason.message : "lỗi",
        });
    });
    return ok;
  }

  /** Một lượt đánh giá mọi luật; gửi thông báo cho các chuyển trạng thái. */
  async evaluate(): Promise<EvalResult[]> {
    const now = (this.deps.now ?? (() => new Date()))();
    const nowMs = now.getTime();
    const http = await this.scrape(nowMs);
    const out: EvalResult[] = [];
    for (const rule of this.rules) {
      const value = await this.signal(rule, nowMs, http);
      const before = this.stateOf(rule.id);
      const { state, transition } = stepRule(rule, value, nowMs, before, this.deps.repeatMs ?? 3_600_000);
      let delivered = 0;
      let next = state;
      if (transition !== null) {
        delivered = await this.dispatch({
          timestamp: now.toISOString(),
          status: transition === "resolved" ? "resolved" : "firing",
          repeat: transition === "repeat",
          rule: rule.id,
          severity: rule.severity,
          summary: rule.summary,
          owner: rule.owner,
          runbook: rule.runbook,
          value,
          threshold: rule.threshold,
          since: before.since === null ? null : new Date(before.since).toISOString(),
        });
        // Không kênh nào nhận được → giữ trạng thái cũ để lượt sau thử gửi lại (không nuốt cảnh báo).
        if (delivered === 0 && this.deps.sinks.length > 0) next = before;
      }
      this.states.set(rule.id, next);
      out.push({
        rule: rule.id,
        value,
        phase: next.phase,
        notified: delivered > 0 ? transition : null,
        delivered,
      });
    }
    return out;
  }
}

// ---- Dựng từ cấu hình + vòng lặp -----------------------------------------------------------------------------------

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

/** Đánh giá định kỳ tới khi `signal` huỷ; một lượt lỗi không dừng vòng lặp. */
export async function runAlertLoop(
  signal: AbortSignal,
  engine: AlertEngine,
  intervalMs: number,
): Promise<void> {
  while (!signal.aborted) {
    try {
      await engine.evaluate();
    } catch (err) {
      log.error("lượt đánh giá cảnh báo lỗi", { err });
    }
    if (!signal.aborted) await sleep(intervalMs, signal);
  }
}
