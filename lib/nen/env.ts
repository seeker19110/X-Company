// Module env DUY NHẤT (BASE-CFG-002/005/008, FE-BUILD-005): mọi biến môi trường của ứng dụng được khai báo và parse ở
// đây bằng zod; nơi khác KHÔNG đọc `process.env.` (scripts/check-env.ts chặn). Hai lớp: `server` (có thể là bí mật) và
// `client` (chỉ tiền tố NEXT_PUBLIC_, không bao giờ bí mật). Lỗi chỉ nêu TÊN biến, không in giá trị.
import { z } from "zod";

interface Field<T extends z.ZodType> {
  schema: T;
  /** Bí mật: bị che `***` khi in cấu hình. */
  secret?: boolean;
  /** Bắt buộc ở lúc khởi động (thiếu = thoát ≠ 0). */
  required?: boolean;
}

const field = <T extends z.ZodType>(
  schema: T,
  o: { secret?: boolean; required?: boolean } = {},
): Field<T> => ({
  schema,
  ...o,
});

const MIN_SECRET_BYTES = 32;
const bytes = (s: string) => Buffer.byteLength(s);

/** "kid1:secret1,kid2:secret2" — mỗi khoá ≥ 32 byte (qr.ts parse lại để xoay vòng). */
function validQrKeys(raw: string): boolean {
  const parts = raw.split(",").filter((p) => p.trim() !== "");
  return (
    parts.length > 0 &&
    parts.every((p) => {
      const i = p.indexOf(":");
      return i > 0 && bytes(p.slice(i + 1).trim()) >= MIN_SECRET_BYTES;
    })
  );
}

const url = (protocols: RegExp, what: string) =>
  z
    .string()
    .refine((v) => z.url({ protocol: protocols }).safeParse(v).success, { error: `phải là URL ${what}` });

/** Biến phía server. Thêm biến mới = thêm một dòng ở đây + `.env.example` (check:env so khớp). */
export const SERVER_SPEC = {
  NODE_ENV: field(
    z
      .enum(["development", "test", "production"], { error: "phải là development|test|production" })
      .default("development"),
  ),
  NEXT_PHASE: field(z.string().optional()),
  NEXT_RUNTIME: field(z.enum(["nodejs", "edge"]).optional()),
  APP_ORIGIN: field(
    url(/^https?$/, "http(s)")
      .transform((v) => new URL(v).origin)
      .pipe(z.string()),
    { required: true },
  ),
  DATABASE_URL: field(url(/^postgres(ql)?$/, "postgres://"), { required: true, secret: true }),
  MIGRATE_DATABASE_URL: field(url(/^postgres(ql)?$/, "postgres://").optional(), { secret: true }),
  DB_POOL_MAX: field(z.coerce.number().int().min(1).max(100).default(10)),
  // Tắt êm (ARC-RES-009): thời gian chờ request đang chạy và thời gian giữ readiness 503 trước khi ngừng nhận.
  SHUTDOWN_GRACE_MS: field(z.coerce.number().int().min(0).max(120_000).default(20_000)),
  SHUTDOWN_READY_DELAY_MS: field(z.coerce.number().int().min(0).max(30_000).default(2_000)),
  SESSION_SECRET: field(
    z.string().refine((v) => bytes(v) >= MIN_SECRET_BYTES, { error: `phải dài ≥ ${MIN_SECRET_BYTES} byte` }),
    { required: true, secret: true },
  ),
  QR_SIGNING_KEYS: field(
    z
      .string()
      .refine(validQrKeys, { error: `phải dạng kid:khoá[,kid:khoá] với khoá ≥ ${MIN_SECRET_BYTES} byte` }),
    { required: true, secret: true },
  ),
  TRUST_PROXY_HOPS: field(z.coerce.number().int().min(0).max(10).optional()),
  TRUST_PROXY: field(z.enum(["0", "1"]).optional()),
  FILE_STORAGE_DIR: field(z.string().optional()),
  SITE_COMPANY_ID: field(z.uuid().optional()),
  LOG_LEVEL: field(z.enum(["debug", "info", "warn", "error", "fatal", "silent"]).default("info")),
  APP_VERSION: field(z.string().max(64).optional()),
  // /api/metrics (OPS-OBS-003): bearer token nội bộ; không đặt = endpoint 404. Đặt thì ≥ 16 byte.
  METRICS_TOKEN: field(
    z
      .string()
      .refine((v) => bytes(v) >= 16, { error: "phải dài ≥ 16 byte" })
      .optional(),
    { secret: true },
  ),
  // Worker outbox (BE-JOB-003): số lần thử tối đa (mặc định 5), cỡ lô và nhịp thăm dò khi hết việc.
  WORKER_MAX_ATTEMPTS: field(z.coerce.number().int().min(1).max(20).default(5)),
  WORKER_BATCH_SIZE: field(z.coerce.number().int().min(1).max(500).default(10)),
  WORKER_POLL_MS: field(z.coerce.number().int().min(100).max(60_000).default(2_000)),
  // Retention (D-016, STD-PRIV-005): thời hạn lưu là cấu hình — số chính thức do HR/pháp chế chốt (F02).
  RETENTION_ENABLED: field(
    z
      .enum(["true", "false"], { error: "phải là true|false" })
      .default("true")
      .transform((v) => v === "true"),
  ),
  RETENTION_INQUIRY_DAYS: field(z.coerce.number().int().min(1).max(36_500).default(730)),
  RETENTION_APPLICATION_DAYS: field(z.coerce.number().int().min(1).max(36_500).default(365)),
  RETENTION_SESSION_DAYS: field(z.coerce.number().int().min(1).max(36_500).default(30)),
  RETENTION_LOGIN_ATTEMPT_DAYS: field(z.coerce.number().int().min(1).max(36_500).default(90)),
  RETENTION_OUTBOX_DONE_DAYS: field(z.coerce.number().int().min(1).max(36_500).default(30)),
  RETENTION_IDEMPOTENCY_HOURS: field(z.coerce.number().int().min(1).max(8_760).default(24)),
} as const;

/**
 * Biến phía client: CHỈ tiền tố NEXT_PUBLIC_ và không bao giờ bí mật (hiện chưa có biến nào). Next chỉ nhúng
 * `process.env.NEXT_PUBLIC_X` viết thẳng ở nơi dùng; khi thêm biến, đọc qua hằng ở đây và cập nhật `check:env`.
 */
export const CLIENT_SPEC = {} as Record<`NEXT_PUBLIC_${string}`, Field<z.ZodType>>;

/** Tên công khai không được gợi bí mật (BASE-CFG-008, PRF-WEB-003) — `scripts/check-env.ts` dùng cùng biểu thức. */
export const PUBLIC_SECRET_NAME = /SECRET|KEY|TOKEN|PASSWORD/i;

type Spec = Record<string, Field<z.ZodType>>;
type Out<S extends Spec> = { [K in keyof S]: z.output<S[K]["schema"]> };
export type ServerEnv = Out<typeof SERVER_SPEC>;
export type ServerEnvKey = keyof typeof SERVER_SPEC;

export interface EnvIssue {
  name: string;
  message: string;
}

/** Lỗi cấu hình: `issues` chỉ có tên biến + lý do chung, không bao giờ có giá trị. */
export class EnvError extends Error {
  constructor(readonly issues: EnvIssue[]) {
    super(formatEnvIssues(issues));
    this.name = "EnvError";
  }
}

export function formatEnvIssues(issues: EnvIssue[]): string {
  return `Cấu hình môi trường không hợp lệ — ${issues.map((i) => `${i.name}: ${i.message}`).join("; ")}`;
}

type Source = Record<string, string | undefined>;

/** Chuỗi rỗng = chưa đặt (mẫu `.env` hay để `KEY=`). */
const rawOf = (source: Source, name: string): string | undefined => {
  const v = source[name];
  return v === undefined || v.trim() === "" ? undefined : v;
};

function parseOne(
  spec: Spec,
  source: Source,
  name: string,
): { ok: true; value: unknown } | { ok: false; issue: EnvIssue } {
  const f = spec[name]!;
  const raw = rawOf(source, name);
  if (raw === undefined && f.required) return { ok: false, issue: { name, message: "thiếu (bắt buộc)" } };
  const r = f.schema.safeParse(raw);
  if (r.success) return { ok: true, value: r.data };
  // Chỉ lấy `message` do ta/zod soạn (không chứa giá trị nhập); gộp thành một chuỗi ngắn.
  const message = [...new Set(r.error.issues.map((i) => i.message))].join(", ");
  return { ok: false, issue: { name, message: message === "" ? "không hợp lệ" : message } };
}

function parseSpec<S extends Spec>(spec: S, source: Source): Out<S> {
  const out: Record<string, unknown> = {};
  const issues: EnvIssue[] = [];
  for (const name of Object.keys(spec)) {
    const r = parseOne(spec, source, name);
    if (r.ok) out[name] = r.value;
    else issues.push(r.issue);
  }
  if (issues.length > 0) throw new EnvError(issues);
  return out as Out<S>;
}

/** Parse TOÀN BỘ biến server (kiểm lúc khởi động). Ném `EnvError` liệt kê mọi biến thiếu/sai. */
export function loadEnv(source: Source = process.env): ServerEnv {
  return parseSpec(SERVER_SPEC, source);
}

/** Biến phía client (chỉ NEXT_PUBLIC_*). */
export function loadClientEnv(source: Source = process.env): Out<typeof CLIENT_SPEC> {
  return parseSpec(CLIENT_SPEC, source);
}

/**
 * Đọc MỘT biến (lười, theo `process.env` hiện tại — test đặt biến trước khi dùng). Sai/thiếu bắt buộc → `EnvError`
 * nêu tên biến đó.
 */
export function env<K extends ServerEnvKey>(name: K, source: Source = process.env): ServerEnv[K] {
  const r = parseOne(SERVER_SPEC, source, name);
  if (!r.ok) throw new EnvError([r.issue]);
  return r.value as ServerEnv[K];
}

/** Cấu hình hiệu lực đã che bí mật (`***`) — an toàn để in/log/JSON.stringify (BASE-CFG-005). */
export function maskedEnv(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(config)) {
    const secret = (SERVER_SPEC as Spec)[name]?.secret;
    out[name] = secret && value !== undefined ? "***" : value;
  }
  return out;
}

/** In cấu hình hiệu lực (đã che) dạng dòng `TÊN=giá trị`, sắp theo tên. */
export function printConfig(source: Source = process.env): string {
  const masked = maskedEnv(loadEnv(source));
  return Object.keys(masked)
    .sort()
    .map((k) => `${k}=${masked[k] === undefined ? "" : String(masked[k])}`)
    .join("\n");
}

/** Kiểm schema client: chỉ NEXT_PUBLIC_*, không bí mật, tên không gợi bí mật. Trả danh sách lỗi (rỗng = đạt). */
export function clientSpecProblems(spec: Record<string, Field<z.ZodType>> = CLIENT_SPEC): string[] {
  const problems: string[] = [];
  for (const [name, f] of Object.entries(spec)) {
    if (!name.startsWith("NEXT_PUBLIC_")) problems.push(`${name}: biến client phải có tiền tố NEXT_PUBLIC_`);
    if (f.secret) problems.push(`${name}: biến client không được đánh dấu bí mật`);
    if (PUBLIC_SECRET_NAME.test(name)) problems.push(`${name}: tên công khai chứa SECRET|KEY|TOKEN|PASSWORD`);
  }
  return problems;
}

/** Tên biến server (check:env so khớp với `.env.example`). */
export const serverEnvNames = (): string[] => Object.keys(SERVER_SPEC);
