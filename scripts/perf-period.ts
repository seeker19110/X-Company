// Kịch bản chốt kỳ công trong đo tải cục bộ (AUD-PERF-001, T-069; KHÔNG dùng cho production): perf-load.mjs gọi SAU
// các kịch bản HTTP. Seed 200 nhân viên có ca mọi ngày trong 3 tháng quá khứ (không chạm kỳ hiện tại mà kịch bản ghi
// chấm công đang dùng), rồi chốt lần lượt 3 kỳ bằng `lockPeriod` dưới role ứng dụng (không superuser).
// In ra stdout MỘT dòng JSON: [{ code, lines, expectedLines, ms, queries, error? }].
// Env: DATABASE_URL (superuser, để seed) · PERF_APP_DATABASE_URL (role ứng dụng, để chốt kỳ).
import { readFileSync } from "node:fs";
import pg from "pg";
import { setPool, withTx, type Queryable } from "../lib/db/index.ts";
import { loadActor } from "../lib/authz/load.ts";
import { BUSINESS_TZ } from "../lib/nen/time.ts";
import { advancePeriod, createPeriod, lockPeriod } from "../lib/attendance/period.ts";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu (dùng chung với perf-load.mjs)
import { PERIOD_EMPLOYEES, PERIOD_MONTHS } from "./lib/perf-users.mjs";

interface SeedFile {
  companyId: string;
  users: Record<string, { userId: string }>;
}
const seed = JSON.parse(readFileSync("e2e/.seed.json", "utf8")) as SeedFile;
const months = PERIOD_MONTHS as { code: string; start: string; end: string; days: number }[];
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const app = new pg.Pool({ connectionString: process.env.PERF_APP_DATABASE_URL, max: 2 });
setPool(app);
const companyId = seed.companyId;

const first = months[0]!.start;
const last = months[months.length - 1]!.end;
const tpl = (
  await admin.query<{ id: string }>(
    `INSERT INTO shift_template (company_id, code, name, start_time, end_time, break_minutes)
     VALUES ($1, 'PERFKY', 'Ca đo chốt kỳ', '08:00', '17:00', 60) RETURNING id`,
    [companyId],
  )
).rows[0]!.id;
await admin.query(
  `INSERT INTO employee (company_id, code, full_name)
   SELECT $1, 'KY' || lpad(i::text, 4, '0'), 'Nhân viên chốt kỳ ' || i FROM generate_series(1, $2::int) AS i`,
  [companyId, PERIOD_EMPLOYEES],
);
await admin.query(
  `INSERT INTO shift_assignment (company_id, employee_id, business_date, shift_template_id)
   SELECT $1, e.id, d::date, $2 FROM employee e, generate_series($3::date, $4::date, interval '1 day') AS d
   WHERE e.company_id = $1 AND e.code LIKE 'KY%'`,
  [companyId, tpl, first, last],
);
// Một phần mười đi làm đủ giờ mọi ngày (có sự kiện để tính), còn lại vắng — cả hai nhánh tính dòng công.
await admin.query(
  `INSERT INTO attendance_event (company_id, employee_id, idempotency_key, request_hash, kind, device_time, source, status)
   SELECT $1, e.id, 'perf-ky-' || k.kind || '-' || e.code || '-' || d::date, 'h', k.kind,
          (d::date + k.t) AT TIME ZONE $4, 'gps', 'accepted'
   FROM employee e, generate_series($2::date, $3::date, interval '1 day') AS d,
        (VALUES ('in', time '08:00'), ('out', time '17:00')) AS k(kind, t)
   WHERE e.company_id = $1 AND e.code LIKE 'KY%' AND right(e.code, 1) = '0'`,
  [companyId, first, last, BUSINESS_TZ],
);

const hr = (await loadActor(app, seed.users.hr!.userId))!;
const results: {
  code: string;
  lines: number;
  expectedLines: number;
  ms: number | null;
  queries: number;
  error?: string;
}[] = [];
for (const m of months) {
  const periodId = await withTx((tx) =>
    createPeriod(tx, hr, { code: m.code, startDate: m.start, endDate: m.end }),
  );
  for (const s of ["employee_review", "manager_confirmed", "hr_closed"] as const)
    await withTx((tx) => advancePeriod(tx, hr, periodId, s));
  let queries = 0;
  const started = performance.now();
  try {
    await withTx((tx) => {
      const spy = {
        query: (...args: unknown[]) => {
          queries++;
          return (tx.query as (...a: unknown[]) => unknown)(...args);
        },
      } as unknown as Queryable;
      return lockPeriod(spy, hr, periodId);
    });
    const ms = Math.round(performance.now() - started);
    const { rows } = await admin.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM period_line l JOIN employee e ON e.id = l.employee_id WHERE l.period_id = $1 AND e.code LIKE 'KY%'",
      [periodId],
    );
    results.push({ code: m.code, lines: rows[0]!.n, expectedLines: PERIOD_EMPLOYEES * m.days, ms, queries });
  } catch (e) {
    results.push({
      code: m.code,
      lines: 0,
      expectedLines: PERIOD_EMPLOYEES * m.days,
      ms: null,
      queries,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
await app.end();
await admin.end();
process.stdout.write(`${JSON.stringify(results)}\n`);
