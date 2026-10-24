// npm run alerts:drill — bài THỬ KÍCH HOẠT cảnh báo (OPS-SLO-006; lifecycle G8 "cảnh báo đã thử kích hoạt"), chạy cục bộ.
// Với MỖI luật trong docs/ops/alerts.json: dựng CSDL tạm đã migrate (KHÔNG chạm DB đặt ở DATABASE_URL — chỉ tạo/xoá một DB
// riêng trên cùng máy chủ), nền khoẻ mạnh (không cảnh báo) → gây sự cố giả (chèn việc outbox chết bằng worker thật, DSAR/kỳ
// công quá hạn, giả lập DB lỗi cho readiness, metric 5xx/chậm sinh bằng bộ đo thật, sao lưu quá hạn bằng scripts/backup.sh,
// sửa chuỗi audit) → chứng minh: "firing" tới ĐÚNG ba kênh (tệp JSONL, webhook HTTP cục bộ, log sự kiện `ops.alert`),
// KHÔNG gửi lặp khi vẫn đang bắn, rồi "resolved" khi hết. Đồng hồ tiến giả (`tick`) để thử cả cửa sổ burn-rate 6 giờ.
// Exit 1 nếu bất kỳ luật nào không bắn/không hết/gửi sai kênh/gửi lặp. Nhãn bằng chứng: faithful-fixture (không có
// Prometheus/Alertmanager/kênh trực thật).
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { appendAudit } from "../lib/audit/index.ts";
import { guardIdleErrors, withTx } from "../lib/db/index.ts";
import { runMigrations } from "../lib/db/migrate.ts";
import { observeRequest, renderMetrics, resetMetrics } from "../lib/http/metrics.ts";
import { createLogger } from "../lib/nen/log.ts";
import { readiness } from "../lib/nen/health.ts";
import {
  AlertEngine,
  fileSink,
  loadRules,
  makeLogSink,
  type AlertNotification,
  type AlertRule,
  type EvalResult,
  XID_AGE_MAX_SQL,
} from "../lib/ops/index.ts";
import { enqueue } from "../lib/outbox/index.ts";
import { runOnce } from "../lib/worker/index.ts";
import { webhookSink } from "./alert-channels.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const STEP_MS = 300_000;
const WARM_TICKS = 13; // 13 × 5 phút > 1 giờ lịch sử khoẻ mạnh cho cửa sổ burn-rate
const MAX_TICKS = 14;

export interface DrillRow {
  rule: string;
  severity: string;
  scenario: string;
  firedAtTick: number | null;
  resolvedAtTick: number | null;
  channels: { file: boolean; webhook: boolean; log: boolean };
  baselineQuiet: boolean;
  noRepeat: boolean;
  ok: boolean;
}

interface Shared {
  admin: pg.Pool;
  dead: pg.Pool;
  dir: string;
  adminUrl: URL;
  /** Gốc URL webhook cục bộ; mỗi kịch bản dùng đường dẫn riêng `/hook/<luật>` để bằng chứng không lẫn nhau. */
  webhookBase: string;
  webhookBodies: Map<string, AlertNotification[]>;
  companyId: string;
  /** Luật gốc từ docs/ops/alerts.json (để khôi phục ngưỡng sau khi kịch bản hạ tạm). */
  rules: AlertRule[];
}

/** Trạng thái có điều khiển được của một lần thử (đồng hồ giả, lưu lượng, probe). */
class Harness {
  clock = Date.now();
  realClock = false;
  traffic = { ok: 0, err: 0, attOk: 0, attSlow: 0 };
  /** Lưu lượng cộng thêm MỖI tick khi đang "sự cố". */
  extra = { err: 0, attSlow: 0 };
  scrapeFail = false;
  readyPool: pg.Pool;
  backupFresh = true;
  offsiteFresh = true;
  offsiteDrillFresh = true;
  readonly logLines: string[] = [];
  readonly engine: AlertEngine;
  readonly backupDir: string;
  /** Bản sao luật của riêng lần thử này (kịch bản có thể hạ ngưỡng tạm — không ảnh hưởng kịch bản khác). */
  readonly rules: AlertRule[];
  tickNo = 0;
  last: EvalResult[] = [];

  constructor(
    readonly sh: Shared,
    rules: AlertRule[],
    readonly name: string,
  ) {
    this.rules = rules.map((r) => ({ ...r }));
    this.readyPool = sh.admin;
    this.backupDir = path.join(sh.dir, `${name}-backups`);
    mkdirSync(this.backupDir, { recursive: true });
    const logger = createLogger({
      sink: (l) => this.logLines.push(l),
      level: () => "debug",
      service: "drill",
    });
    this.engine = new AlertEngine(this.rules, {
      sinks: [
        fileSink(path.join(sh.dir, `${name}.jsonl`)),
        webhookSink(`${sh.webhookBase}/hook/${name}`, 2_000),
        makeLogSink(logger),
      ],
      now: () => new Date(this.clock),
      repeatMs: 86_400_000, // "không gửi lặp" chỉ phá bởi cửa sổ nhắc 24 giờ, xa hơn mọi tick của bài thử
      pool: sh.admin,
      backupDir: this.backupDir,
      metricsText: () => {
        if (this.scrapeFail) return Promise.reject(new Error("scrape giả lập thất bại"));
        return Promise.resolve(this.metrics());
      },
      readyz: async () => (await readiness(() => this.readyPool, 300)).ok,
    });
  }

  /** Văn bản metric thật: bộ đo của ứng dụng sinh ra từ tổng đã tích luỹ. */
  metrics(): string {
    resetMetrics();
    const t = this.traffic;
    for (let i = 0; i < t.ok; i++) observeRequest("GET", "/api/app/tasks", 200, 0.02);
    for (let i = 0; i < t.err; i++) observeRequest("GET", "/api/app/tasks", 500, 0.02);
    for (let i = 0; i < t.attOk; i++) observeRequest("POST", "/api/app/attendance/events", 201, 0.2);
    for (let i = 0; i < t.attSlow; i++) observeRequest("POST", "/api/app/attendance/events", 201, 2.5);
    return renderMetrics(0);
  }

  writeFakeBackup(): void {
    const created = new Date(this.clock).toISOString();
    const file = "xc-drill.dump";
    writeFileSync(path.join(this.backupDir, file), "x");
    writeFileSync(
      path.join(this.backupDir, "xc-drill.manifest.json"),
      JSON.stringify({ format: 1, created_at_utc: created, file }),
    );
  }

  async tick(ms: number = STEP_MS): Promise<EvalResult[]> {
    if (!this.realClock) this.clock += ms;
    this.traffic.ok += 100;
    this.traffic.attOk += 20;
    this.traffic.err += this.extra.err;
    this.traffic.attSlow += this.extra.attSlow;
    if (this.backupFresh && !this.realClock) this.writeFakeBackup();
    // Trạng thái off-site do scripts/backup-offsite.sh / restore-offsite-drill.sh ghi (cùng định dạng, chỉ tối thiểu).
    const stamp = JSON.stringify({ format: 1, last_success_utc: new Date(this.clock).toISOString() });
    if (this.offsiteFresh) writeFileSync(path.join(this.backupDir, "offsite-status.json"), stamp);
    if (this.offsiteDrillFresh) writeFileSync(path.join(this.backupDir, "offsite-drill.json"), stamp);
    this.tickNo++;
    this.last = await this.engine.evaluate();
    return this.last;
  }
}

interface Scenario {
  rule: string;
  scenario: string;
  /** Gây sự cố. */
  inject(h: Harness): Promise<void>;
  /** Dọn sự cố. */
  clear(h: Harness): Promise<void>;
  /** Bước đồng hồ cho các tick sau khi inject/clear. */
  stepMs?: number;
  realClock?: boolean;
}

const runBackupScript = (sh: Shared, backupDir: string): void => {
  const r = spawnSync(path.join(ROOT, "scripts", "backup.sh"), [], {
    env: {
      ...process.env,
      DATABASE_URL: sh.adminUrl.toString(),
      BACKUP_DIR: backupDir,
      BACKUP_PASSPHRASE: "",
    },
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`backup.sh thất bại (exit ${String(r.status)})`);
};

function scenarios(sh: Shared): Scenario[] {
  return [
    {
      rule: "XCLocalAvailabilityFastBurn",
      scenario: "60 phản hồi 5xx mỗi 5 phút trên nền 100 yêu cầu khoẻ mạnh",
      inject: async (h) => void (h.extra.err = 60),
      clear: async (h) => void (h.extra.err = 0),
    },
    {
      rule: "XCLocalAvailabilitySlowBurn",
      scenario: "60 phản hồi 5xx mỗi 5 phút, giữ 15 phút (cửa sổ 6 giờ/30 phút)",
      inject: async (h) => void (h.extra.err = 60),
      clear: async (h) => void (h.extra.err = 0),
    },
    {
      rule: "XCLocalAttendanceLatencyBurn",
      scenario: "200 yêu cầu ghi chấm công mất 2,5 giây mỗi 5 phút",
      inject: async (h) => void (h.extra.attSlow = 200),
      clear: async (h) => void (h.extra.attSlow = 0),
    },
    {
      rule: "XCLocalAttendanceP95Slow",
      scenario: "200 yêu cầu ghi chấm công mất 2,5 giây mỗi 5 phút (p95 > 1 giây)",
      inject: async (h) => void (h.extra.attSlow = 200),
      clear: async (h) => void (h.extra.attSlow = 0),
    },
    {
      rule: "XCLocalOutboxDeadLetter",
      scenario: "enqueue topic không có handler → worker thật đẩy vào DLQ",
      inject: async () => {
        await withTx((tx) => enqueue(tx, null, "drill.khong-co-handler", { x: 1 }), sh.admin);
        // now() của DB có micro giây, worker so với giờ JS (mili giây): đẩy giờ worker tới 1 s để việc vừa enqueue luôn đến hạn.
        const s = await runOnce({ pool: sh.admin, maxAttempts: 1, now: () => new Date(Date.now() + 1_000) });
        if (s.dead < 1) throw new Error("worker không đẩy việc vào DLQ");
      },
      clear: async () => void (await sh.admin.query("DELETE FROM outbox_event WHERE topic LIKE 'drill.%'")),
    },
    {
      rule: "XCLocalOutboxStale",
      scenario: "việc pending đã tới hạn từ 10 phút trước mà không worker nào lấy",
      inject: async (h) =>
        void (await sh.admin.query(
          "INSERT INTO outbox_event (topic, payload, next_attempt_at) VALUES ('drill.stale', '{}', $1)",
          [new Date(h.clock - 600_000)],
        )),
      clear: async () => void (await sh.admin.query("DELETE FROM outbox_event WHERE topic LIKE 'drill.%'")),
    },
    {
      rule: "XCLocalDsarOverdue",
      scenario: "yêu cầu truy cập dữ liệu nhận 31 ngày trước, hạn đã qua 1 ngày, chưa xử lý",
      inject: async (h) =>
        void (await sh.admin.query(
          `INSERT INTO data_subject_request (company_id, subject_type, subject_ref, subject_id, kind, received_at, due_at)
           VALUES ($1, 'inquiry', 'YC-DRILL', $2, 'access', $3, $4)`,
          [sh.companyId, randomUUID(), new Date(h.clock - 31 * 86_400_000), new Date(h.clock - 86_400_000)],
        )),
      clear: async () =>
        void (await sh.admin.query(
          "UPDATE data_subject_request SET status = 'done', closed_at = now() WHERE subject_ref = 'YC-DRILL'",
        )),
    },
    {
      rule: "XCLocalReadyzDown",
      scenario: "giả lập DB lỗi: probe readiness trỏ tới cổng đóng (đường mã thật lib/nen/health)",
      inject: async (h) => void (h.readyPool = sh.dead),
      clear: async (h) => void (h.readyPool = sh.admin),
    },
    {
      rule: "XCLocalMetricsScrapeFailed",
      scenario: "endpoint /api/metrics không trả lời",
      inject: async (h) => void (h.scrapeFail = true),
      clear: async (h) => void (h.scrapeFail = false),
    },
    {
      rule: "XCLocalBackupStale",
      scenario: "bản sao lưu thật (backup.sh) bị lùi manifest 26 giờ; hết khi chạy backup.sh lại",
      realClock: true,
      inject: async (h) => {
        const m = path.join(h.backupDir, readdirManifest(h.backupDir));
        const j = JSON.parse(readFileSync(m, "utf8")) as { created_at_utc: string };
        j.created_at_utc = new Date(Date.now() - 26 * 3_600_000).toISOString();
        writeFileSync(m, JSON.stringify(j));
      },
      clear: async (h) => {
        for (const f of readdirManifestAll(h.backupDir)) rmSync(path.join(h.backupDir, f));
        runBackupScript(sh, h.backupDir);
      },
    },
    {
      rule: "XCLocalOffsiteBackupStale",
      scenario:
        "lần đẩy off-site (restic) ngừng thành công: đồng hồ giả chạy qua 25 giờ (2 giờ/tick); hết khi đẩy thành công lại",
      stepMs: 7_200_000,
      inject: async (h) => void (h.offsiteFresh = false),
      clear: async (h) => void (h.offsiteFresh = true),
    },
    {
      rule: "XCLocalOffsiteDrillStale",
      scenario:
        "không diễn tập khôi phục off-site: đồng hồ giả chạy qua 31 ngày (3 ngày/tick); hết khi diễn tập lại",
      stepMs: 259_200_000,
      inject: async (h) => void (h.offsiteDrillFresh = false),
      clear: async (h) => void (h.offsiteDrillFresh = true),
    },
    {
      rule: "XCLocalPeriodCloseOverdue",
      scenario: "kỳ công kết thúc 30 ngày trước vẫn ở trạng thái open",
      inject: async (h) => {
        const end = new Date(h.clock - 30 * 86_400_000);
        const start = new Date(end.getTime() - 29 * 86_400_000);
        await sh.admin.query(
          "INSERT INTO attendance_period (company_id, code, start_date, end_date) VALUES ($1, 'DRILL-01', $2, $3)",
          [sh.companyId, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)],
        );
      },
      clear: async () =>
        void (await sh.admin.query(
          "UPDATE attendance_period SET status = 'locked', locked_at = now() WHERE code = 'DRILL-01'",
        )),
    },
    {
      rule: "XCLocalAuditChainBroken",
      scenario: "sửa trái phép một bản ghi audit (tắt trigger) rồi khôi phục",
      stepMs: 3_700_000, // vượt chu kỳ kiểm chuỗi 1 giờ (min_interval_seconds)
      inject: async () => {
        await sh.admin.query("ALTER TABLE audit_event DISABLE TRIGGER audit_event_no_update");
        await sh.admin.query("UPDATE audit_event SET reason = 'giả mạo' WHERE action = 'drill.audit'");
        await sh.admin.query("ALTER TABLE audit_event ENABLE TRIGGER audit_event_no_update");
      },
      clear: async () => {
        await sh.admin.query("ALTER TABLE audit_event DISABLE TRIGGER audit_event_no_update");
        await sh.admin.query("UPDATE audit_event SET reason = 'ban-dau' WHERE action = 'drill.audit'");
        await sh.admin.query("ALTER TABLE audit_event ENABLE TRIGGER audit_event_no_update");
      },
    },
    {
      rule: "XCLocalXidWraparound",
      scenario:
        "ngưỡng tạm = tuổi XID hiện tại + 500 rồi tiêu thụ 1.000 XID thật (pg_current_xact_id); hết khi ngưỡng về 1,5 tỷ (thay cho VACUUM FREEZE — không đẩy được tuổi thật tới 1,5 tỷ)",
      inject: async (h) => {
        const r = ruleOf(h, "XCLocalXidWraparound");
        const age = Number((await sh.admin.query<{ n: string }>(XID_AGE_MAX_SQL)).rows[0]!.n);
        r.threshold = age + 500;
        for (let i = 0; i < 1_000; i++) await sh.admin.query("SELECT pg_current_xact_id()");
      },
      clear: async (h) => {
        const r = ruleOf(h, "XCLocalXidWraparound");
        r.threshold = sh.rules.find((x) => x.id === r.id)!.threshold;
      },
    },
    {
      rule: "XCLocalDeadTuplesHigh",
      scenario:
        "bảng thật 30.000 hàng (tắt autovacuum riêng bảng) bị DELETE 15.000 → 50% hàng chết; giữ 1 giờ (20 phút/tick); hết khi VACUUM",
      stepMs: 1_200_000,
      inject: async () => {
        await onOneConnection(sh.admin, [
          "CREATE TABLE drill_bloat (id int PRIMARY KEY) WITH (autovacuum_enabled = false)",
          "INSERT INTO drill_bloat SELECT generate_series(1, 30000)",
          "DELETE FROM drill_bloat WHERE id > 15000",
        ]);
        await waitDeadTuples(sh.admin, (n) => n >= 15_000);
      },
      clear: async () => {
        await onOneConnection(sh.admin, ["VACUUM drill_bloat"]);
        await waitDeadTuples(sh.admin, (n) => n === 0);
      },
    },
  ];
}

const ruleOf = (h: Harness, id: string): AlertRule => {
  const r = h.rules.find((x) => x.id === id);
  if (!r) throw new Error(`luật không có trong docs/ops/alerts.json: ${id}`);
  return r;
};

/**
 * Số liệu thống kê (pg_stat_user_tables) được backend đẩy vào bộ nhớ chung không đồng bộ (PostgreSQL ≥ 15: tối đa mỗi giây,
 * hoãn tới 10 giây). Chạy các lệnh trên CÙNG một kết nối rồi `pg_stat_force_next_flush()` để backend đó đẩy ngay khi rảnh.
 */
async function onOneConnection(pool: pg.Pool, sqls: string[]): Promise<void> {
  const c = await pool.connect();
  try {
    for (const q of sqls) await c.query(q);
    await c.query("SELECT pg_stat_force_next_flush()");
  } finally {
    c.release();
  }
}

/** Chờ tới khi thống kê hàng chết của drill_bloat thoả `ok` (kịch bản không phụ thuộc thời điểm đẩy thống kê). */
async function waitDeadTuples(pool: pg.Pool, ok: (n: number) => boolean): Promise<void> {
  for (let i = 0; i < 150; i++) {
    const r = await pool.query<{ n: string | null }>(
      "SELECT n_dead_tup AS n FROM pg_stat_user_tables WHERE relname = 'drill_bloat'",
    );
    if (ok(Number(r.rows[0]?.n ?? -1))) return;
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error("alerts:drill — thống kê n_dead_tup của drill_bloat không cập nhật trong 15 giây");
}

const readdirManifestAll = (d: string): string[] => readdirSync(d).filter((f) => f.startsWith("xc-"));
const readdirManifest = (d: string): string => readdirSync(d).find((f) => f.endsWith(".manifest.json")) ?? "";

const only = (xs: AlertNotification[], rule: string, status: string) =>
  xs.filter((n) => n.rule === rule && n.status === status);

async function runScenario(sh: Shared, rules: AlertRule[], sc: Scenario): Promise<DrillRow> {
  const rule = rules.find((r) => r.id === sc.rule);
  if (!rule) throw new Error(`luật không có trong docs/ops/alerts.json: ${sc.rule}`);
  const h = new Harness(sh, rules, sc.rule);
  const step = sc.stepMs ?? STEP_MS;
  h.realClock = sc.realClock === true;
  if (h.realClock) runBackupScript(sh, h.backupDir);
  const notifiedOf = (r: EvalResult[]) => r.find((x) => x.rule === sc.rule)?.notified ?? null;

  // 1) nền khoẻ mạnh: không luật nào được phép kêu
  let quiet = true;
  for (let i = 0; i < WARM_TICKS; i++) {
    await h.tick(STEP_MS);
    if (h.last.some((x) => x.notified !== null)) quiet = false;
  }
  // 2) gây sự cố tới khi luật mục tiêu bắn
  await sc.inject(h);
  let firedAt: number | null = null;
  for (let i = 1; i <= MAX_TICKS && firedAt === null; i++) {
    await h.tick(step);
    if (notifiedOf(h.last) === "firing") firedAt = i;
  }
  // 3) vẫn đang sự cố: tick thêm KHÔNG được gửi lặp
  let noRepeat = true;
  for (let i = 0; i < 2 && firedAt !== null; i++) {
    await h.tick(STEP_MS);
    if (notifiedOf(h.last) !== null) noRepeat = false;
  }
  // 4) hết sự cố → resolved
  await sc.clear(h);
  let resolvedAt: number | null = null;
  for (let i = 1; i <= MAX_TICKS && resolvedAt === null; i++) {
    await h.tick(step);
    if (notifiedOf(h.last) === "resolved") resolvedAt = i;
  }

  // 5) bằng chứng ở TỪNG kênh (đọc lại từ chính kênh, không tin giá trị trả về)
  // Các luật khác có thể cùng bắn khi sự cố chung (vd 5xx làm cả burn nhanh lẫn chậm kêu): chỉ xét dòng của luật đang thử.
  const fileLines = readFileSyncSafe(path.join(sh.dir, `${sc.rule}.jsonl`))
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as AlertNotification)
    .filter((n) => n.rule === sc.rule);
  const logRecs = h.logLines
    .map(
      (l) =>
        JSON.parse(l) as {
          event?: string;
          target?: { id: string };
          detail?: { status: string };
          level?: string;
        },
    )
    .filter((r) => r.event === "ops.alert" && r.target?.id === sc.rule);
  const web = (sh.webhookBodies.get(sc.rule) ?? []).filter((n) => n.rule === sc.rule);
  const channelOk = (xs: AlertNotification[]) =>
    only(xs, sc.rule, "firing").length === 1 && only(xs, sc.rule, "resolved").length === 1;
  const channels = {
    file:
      channelOk(fileLines) &&
      fileLines.every((n) => n.severity === rule.severity && n.runbook === rule.runbook),
    webhook: channelOk(web),
    log:
      logRecs.length === 2 &&
      logRecs[0]?.detail?.status === "firing" &&
      logRecs[0].level === "error" &&
      logRecs[1]?.detail?.status === "resolved" &&
      logRecs[1].level === "info",
  };
  const row: DrillRow = {
    rule: sc.rule,
    severity: rule.severity,
    scenario: sc.scenario,
    firedAtTick: firedAt,
    resolvedAtTick: resolvedAt,
    channels,
    baselineQuiet: quiet,
    noRepeat,
    ok: false,
  };
  row.ok =
    quiet &&
    noRepeat &&
    firedAt !== null &&
    resolvedAt !== null &&
    channels.file &&
    channels.webhook &&
    channels.log;
  return row;
}

function readFileSyncSafe(f: string): string {
  try {
    return readFileSync(f, "utf8");
  } catch {
    return "";
  }
}

async function adminExec(url: URL, sql: string): Promise<void> {
  const c = new pg.Client({ connectionString: url.toString() });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
}

/** Chạy toàn bộ bài thử trên một DB tạm (tạo/xoá trên cụm của `clusterUrl`). */
export async function runDrill(
  clusterUrl: string,
  rulesFile = path.join(ROOT, "docs/ops/alerts.json"),
): Promise<DrillRow[]> {
  const rules = loadRules(rulesFile);
  const dbName = `xc_alerts_drill_${randomBytes(4).toString("hex")}`;
  const cluster = new URL(clusterUrl);
  await adminExec(cluster, `CREATE DATABASE ${dbName}`);
  const dbUrl = new URL(clusterUrl);
  dbUrl.pathname = `/${dbName}`;
  const dir = mkdtempSync(path.join(tmpdir(), "xc-alerts-drill-"));
  const admin = guardIdleErrors(new pg.Pool({ connectionString: dbUrl.toString(), max: 4 }), "drill");
  // Cổng đóng: nhận kết nối bị từ chối ngay → "DB lỗi" cho probe readiness.
  const closed = http.createServer();
  await new Promise<void>((r) => closed.listen(0, "127.0.0.1", r));
  const closedPort = (closed.address() as AddressInfo).port;
  await new Promise((r) => closed.close(r));
  const dead = guardIdleErrors(
    new pg.Pool({
      connectionString: `postgres://x:y@127.0.0.1:${closedPort}/z`,
      max: 1,
      connectionTimeoutMillis: 300,
    }),
    "drill-dead",
  );
  const webhookBodies = new Map<string, AlertNotification[]>();
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const key = (req.url ?? "").replace(/^\/hook\//, "");
      webhookBodies.set(key, [
        ...(webhookBodies.get(key) ?? []),
        JSON.parse(Buffer.concat(chunks).toString("utf8")) as AlertNotification,
      ]);
      res.writeHead(200).end("ok");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    await runMigrations(admin);
    const companyId = (
      await admin.query<{ id: string }>(
        "INSERT INTO company (name) VALUES ('Công ty thử cảnh báo') RETURNING id",
      )
    ).rows[0]!.id;
    await withTx(
      (tx) =>
        appendAudit(tx, {
          actorUserId: null,
          companyId,
          action: "drill.audit",
          objectType: "drill",
          reason: "ban-dau",
        }),
      admin,
    );
    const sh: Shared = {
      admin,
      dead,
      dir,
      adminUrl: dbUrl,
      webhookBase: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      webhookBodies,
      companyId,
      rules,
    };
    const rows: DrillRow[] = [];
    for (const sc of scenarios(sh)) rows.push(await runScenario(sh, rules, sc));
    const missing = rules.filter((r) => !rows.some((x) => x.rule === r.id)).map((r) => r.id);
    if (missing.length > 0) throw new Error(`luật chưa có kịch bản thử: ${missing.join(", ")}`);
    return rows;
  } finally {
    await new Promise((r) => server.close(r));
    server.closeAllConnections();
    try {
      await dead.end();
    } catch (err) {
      console.error("alerts:drill — đóng pool giả lập lỗi:", err instanceof Error ? err.name : err);
    }
    await admin.end();
    await adminExec(cluster, `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    rmSync(dir, { recursive: true, force: true });
  }
}

export function formatRows(rows: DrillRow[]): string {
  const yn = (b: boolean) => (b ? "có" : "KHÔNG");
  const lines = [
    "| Luật | Mức | Kịch bản | Bắn ở tick | Hết ở tick | tệp | webhook | log | nền yên | không lặp | Kết quả |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const r of rows)
    lines.push(
      `| ${r.rule} | ${r.severity} | ${r.scenario} | ${r.firedAtTick ?? "—"} | ${r.resolvedAtTick ?? "—"} | ${yn(r.channels.file)} | ${yn(r.channels.webhook)} | ${yn(r.channels.log)} | ${yn(r.baselineQuiet)} | ${yn(r.noRepeat)} | ${r.ok ? "ĐẠT" : "ĐỎ"} |`,
    );
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.env.LOG_LEVEL ??= "silent";
  const url = process.env.DATABASE_URL?.trim();
  if (url === undefined || url === "") {
    console.error(
      "alerts:drill — thiếu DATABASE_URL (chạy qua `npm run -s alerts:drill`: cụm Postgres tạm tự dựng)",
    );
    process.exit(2);
  }
  if (process.env.NODE_ENV === "production") {
    console.error("alerts:drill — từ chối chạy khi NODE_ENV=production");
    process.exit(2);
  }
  const rows = await runDrill(url);
  console.log(formatRows(rows));
  const bad = rows.filter((r) => !r.ok);
  if (bad.length > 0) {
    console.error(
      `alerts:drill — ĐỎ ${bad.length}/${rows.length} luật: ${bad.map((r) => r.rule).join(", ")}`,
    );
    process.exit(1);
  }
  console.log(
    `alerts:drill — ĐẠT ${rows.length}/${rows.length} luật (faithful-fixture: không có Prometheus/kênh trực thật)`,
  );
}
