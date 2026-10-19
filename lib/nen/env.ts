// i18n-ignore-file: chẩn đoán cấu hình môi trường cho người vận hành (stderr lúc khởi động, thông điệp kiểm biến), không tới người dùng cuối
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
  DATABASE_URL: field(url(/^postgres(ql)?$/, "PostgreSQL"), { required: true, secret: true }),
  MIGRATE_DATABASE_URL: field(url(/^postgres(ql)?$/, "PostgreSQL").optional(), { secret: true }),
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
  // D-030 (nguồn: Luật 91/2025/QH15 Điều 3.3 "phù hợp mục đích", Điều 14.1 xoá khi hết mục đích — mức A; số cụ thể là lựa chọn
  // thận trọng của chủ dự án uỷ quyền cho phiên chính, CHƯA có xác nhận pháp chế).
  // Liên hệ khách: 24 tháng kể từ khi tạo rồi ẩn danh.
  RETENTION_INQUIRY_DAYS: field(z.coerce.number().int().min(1).max(36_500).default(730)),
  // Ứng viên đang xử lý mà quá lâu chưa chốt kết quả (lưới an toàn; không phải mốc của ứng viên đã chốt): ẩn danh sau ngần ấy ngày.
  RETENTION_APPLICATION_DAYS: field(z.coerce.number().int().min(1).max(36_500).default(365)),
  // Ứng viên KHÔNG trúng tuyển: ẩn danh sau 30 ngày kể từ khi chốt kết quả (Luật 91/2025 Điều 25.1c: xoá thông tin ứng viên khi
  // không tuyển, trừ thoả thuận khác — mức A), trừ khi có đồng ý riêng "kho nhân tài" còn hiệu lực.
  RETENTION_APPLICATION_DECIDED_DAYS: field(z.coerce.number().int().min(1).max(36_500).default(30)),
  // Có đồng ý "kho nhân tài" còn hiệu lực: giữ 12 tháng kể từ khi chốt kết quả (đồng ý rút được bất kỳ lúc nào → quay về 30 ngày).
  RETENTION_TALENT_POOL_DAYS: field(z.coerce.number().int().min(1).max(36_500).default(365)),
  // Nhân viên đã chấm dứt hợp đồng: sau ngần ấy ngày kể từ ngày chấm dứt, xoá phần liên hệ (SĐT, email) không phải giữ theo luật
  // (Luật 91/2025 Điều 25.2c: xoá/huỷ khi chấm dứt hợp đồng trừ luật khác — mức A). 0 = ngay sau ngày chấm dứt.
  RETENTION_EMPLOYEE_TERMINATED_DAYS: field(z.coerce.number().int().min(0).max(36_500).default(0)),
  // Hồ sơ lao động, chấm công, lương, chứng từ: giữ 10 năm (Luật Kế toán 2015 Điều 41.5b, sửa bởi Luật 56/2024 — mức B; bảng lương
  // thuộc nhóm 5 hay 10 năm CHƯA xác minh nên chọn 10). Hết hạn → họ tên nhân viên được ẩn danh (dòng công/lương không xoá được).
  RETENTION_TIMESHEET_YEARS: field(z.coerce.number().int().min(1).max(100).default(10)),
  // Hồ sơ vi phạm dữ liệu: giữ tối thiểu 5 năm sau khắc phục (NĐ 356/2025 Điều 29.1c — mức B). Chưa có bảng hồ sơ vi phạm trong
  // CSDL (nằm ở quy trình docs/ops/runbooks/data-breach.md); hằng này để job/bảng tương lai và kiểm tài liệu bám theo.
  RETENTION_BREACH_RECORD_YEARS: field(z.coerce.number().int().min(1).max(100).default(5)),
  RETENTION_SESSION_DAYS: field(z.coerce.number().int().min(1).max(36_500).default(30)),
  RETENTION_LOGIN_ATTEMPT_DAYS: field(z.coerce.number().int().min(1).max(36_500).default(90)),
  RETENTION_OUTBOX_DONE_DAYS: field(z.coerce.number().int().min(1).max(36_500).default(30)),
  RETENTION_IDEMPOTENCY_HOURS: field(z.coerce.number().int().min(1).max(8_760).default(24)),
  // Hạn xử lý yêu cầu chủ thể dữ liệu (DSAR, CMP-INTL-007; D-029) THEO LOẠI yêu cầu — NĐ 356/2025/NĐ-CP Điều 5 (nguồn mức B:
  // bản sao thương mại, chưa đối chiếu Công báo). Ngày ở ba biến DSAR_DAYS_* là ngày LỊCH kể từ lúc nhận (GIẢ ĐỊNH: văn bản
  // không nói ngày làm việc); riêng hạn phản hồi đã nhận tính theo ngày LÀM VIỆC (bỏ T7, CN; ngày lễ chưa loại — H02).
  // Đường lùi D-029: đặt cả ba biến về cùng một số để quay lại hạn chung. Thay biến cũ DSAR_DAYS (một số chung = 30).
  DSAR_RESPOND_WORKDAYS: field(z.coerce.number().int().min(1).max(30).default(2)),
  // access (xem) · rectify (chỉnh sửa) · export (cung cấp): 10 ngày (Điều 5 khoản 3).
  DSAR_DAYS_ACCESS: field(z.coerce.number().int().min(1).max(365).default(10)),
  // withdraw_consent (rút đồng ý) · restrict (hạn chế) · object (phản đối): 15 ngày (Điều 5 khoản 2).
  DSAR_DAYS_RESTRICT: field(z.coerce.number().int().min(1).max(365).default(15)),
  // delete (xoá): 20 ngày (Điều 5 khoản 4).
  DSAR_DAYS_DELETE: field(z.coerce.number().int().min(1).max(365).default(20)),
  // Gia hạn tối đa MỘT lần kèm lý do. Số ngày gia hạn của khoản 2-4 CHƯA XÁC MINH (chỉ khoản 5 nêu ≤ 15 ngày) →
  // GIẢ ĐỊNH 15 ngày, luật sư đối chiếu rồi đổi biến này.
  DSAR_EXTEND_DAYS: field(z.coerce.number().int().min(1).max(365).default(15)),
  // Cảnh báo vận hành cục bộ (T-046): bộ đánh giá chạy trong tiến trình worker khi ALERTS_ENABLED=true (mặc định tắt).
  ALERTS_ENABLED: field(
    z
      .enum(["true", "false"], { error: "phải là true|false" })
      .default("false")
      .transform((v) => v === "true"),
  ),
  ALERT_INTERVAL_MS: field(z.coerce.number().int().min(1_000).max(3_600_000).default(60_000)),
  // Cửa sổ chống lặp: cùng một luật đang bắn chỉ được nhắc lại sau ngần ấy ms (0 = không nhắc lại).
  ALERT_REPEAT_MS: field(z.coerce.number().int().min(0).max(604_800_000).default(3_600_000)),
  ALERT_RULES_FILE: field(z.string().min(1).default("docs/ops/alerts.json")),
  ALERT_SINK_FILE: field(z.string().min(1).default(".data/alerts/alerts.jsonl")),
  // URL webhook có thể chứa token → bí mật (che khi in cấu hình, không vào log).
  ALERT_WEBHOOK_URL: field(url(/^https?$/, "http(s)").optional(), { secret: true }),
  ALERT_WEBHOOK_TIMEOUT_MS: field(z.coerce.number().int().min(500).max(60_000).default(5_000)),
  ALERT_METRICS_URL: field(url(/^https?$/, "http(s)").optional()),
  ALERT_READYZ_URL: field(url(/^https?$/, "http(s)").optional()),
  // Thư mục sao lưu (scripts/backup.sh ghi vào đây; cảnh báo tuổi bản sao lưu đọc manifest ở đây).
  BACKUP_DIR: field(z.string().min(1).default(".data/backups")),
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
