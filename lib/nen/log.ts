// Logger JSON một dòng ra stdout (BASE-ERR-005…009, SEC-SECRET-007, CMP-PRIV-008). Không phụ thuộc ngoài.
// Mỗi bản ghi: timestamp RFC 3339 UTC (ms), level + level_number (OTel), message, service, version, env,
// request_id/trace_id/span_id (từ ngữ cảnh request qua AsyncLocalStorage). Giá trị được che theo TÊN trường và
// theo mẫu giá trị (token, JWT, URL có mật khẩu, email…) trước khi ghi; xuống dòng giả không tạo bản ghi thứ hai.
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { env } from "./env.ts";

export type Level = "debug" | "info" | "warn" | "error" | "fatal";
export type LevelSetting = Level | "silent";

/** Số mức theo OTel SeverityNumber (đầu mỗi dải). */
export const SEVERITY: Record<Level, number> = { debug: 5, info: 9, warn: 13, error: 17, fatal: 21 };
const RANK: Record<LevelSetting, number> = { debug: 0, info: 1, warn: 2, error: 3, fatal: 4, silent: 5 };

export const REDACTED = "[REDACTED]";

// ---- Ngữ cảnh request ---------------------------------------------------------------------------------------

export interface LogContext {
  request_id?: string;
  trace_id?: string;
  span_id?: string;
  /** Không in vào mọi dòng log; dùng cho sự kiện bảo mật và audit (CMP-AUDIT-002). */
  actor_id?: string | null;
  source_ip?: string | null;
  user_agent?: string | null;
}

const als = new AsyncLocalStorage<LogContext>();

/** Chạy `fn` với ngữ cảnh log (gộp lên ngữ cảnh cha nếu có). */
export function runWithLogContext<T>(ctx: LogContext, fn: () => T): T {
  return als.run({ ...als.getStore(), ...ctx }, fn);
}

export const currentLogContext = (): LogContext => als.getStore() ?? {};

export const newTraceId = (): string => randomBytes(16).toString("hex");
export const newSpanId = (): string => randomBytes(8).toString("hex");

/** W3C Trace Context: `00-<trace_id 32 hex>-<parent_id 16 hex>-<flags>`; sai/toàn số 0 → null. */
export function parseTraceparent(header: string | null | undefined): { trace_id: string } | null {
  const m = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/.exec((header ?? "").trim());
  if (!m || /^0+$/.test(m[1]!) || /^0+$/.test(m[2]!)) return null;
  return { trace_id: m[1]! };
}

// ---- Che dữ liệu --------------------------------------------------------------------------------------------

// Tên trường bí mật (SEC-SECRET-007) và PII thường (CMP-PRIV-008).
const SECRET_KEY =
  /pass(word|wd|code)?|token|authorization|cookie|secret|credential|api[-_]?key|private[-_]?key|signing|csrf|session|(^|[-_.])key$/i;
const PII_KEY =
  /(^|[-_.])(e-?mail|phone|mobile|tel|cccd|cmnd|passport|latitude|longitude|lat|lng|lon)($|[-_.])|id[-_]?number|national[-_]?id|tax[-_]?code/i;

/** Có nên che toàn bộ giá trị của trường tên `key` không. */
export const isSensitiveKey = (key: string): boolean => SECRET_KEY.test(key) || PII_KEY.test(key);

const VALUE_PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, REDACTED],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, `Bearer ${REDACTED}`],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, REDACTED],
  [/([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, `$1${REDACTED}@`],
  [/\b(pass(?:word|wd)?|token|secret|api[_-]?key|authorization)\s*[=:]\s*[^\s,;&"']+/gi, `$1=${REDACTED}`],
  [/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/g, REDACTED],
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, REDACTED],
];

const MAX_STRING = 8192;
const MAX_DEPTH = 6;
const MAX_ITEMS = 100;

/** Che mẫu nhạy cảm trong một chuỗi và cắt độ dài (chống log phình). */
export function redactString(s: string): string {
  // i18n-ignore: dấu cắt trong nhật ký JSON cho vận hành, không tới người dùng
  let out = s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}…[cắt]` : s;
  for (const [re, rep] of VALUE_PATTERNS) out = out.replace(re, rep);
  return out;
}

interface ExceptionInfo {
  type: string;
  message: string;
  stacktrace: string | null;
}

function describeError(e: unknown): ExceptionInfo {
  if (e instanceof Error) {
    return {
      type: e.name !== "" ? e.name : e.constructor.name,
      message: redactString(e.message),
      stacktrace: e.stack ? redactString(e.stack) : null,
    };
  }
  return { type: typeof e, message: redactString(typeof e === "string" ? e : safeJson(e)), stacktrace: null };
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v); // vòng tham chiếu/BigInt: chỉ để mô tả, không ném lỗi trong logger
  }
}

/** Chuỗi nguyên nhân đầy đủ (`cause` lồng nhau), chống vòng. */
function causeChain(e: unknown): ExceptionInfo[] {
  const chain: ExceptionInfo[] = [];
  const seen = new Set<unknown>([e]);
  let cur = e instanceof Error ? e.cause : undefined;
  while (cur !== undefined && !seen.has(cur) && chain.length < 20) {
    chain.push(describeError(cur));
    seen.add(cur);
    cur = cur instanceof Error ? cur.cause : undefined;
  }
  return chain;
}

function exceptionFields(e: unknown): Record<string, unknown> {
  const d = describeError(e);
  const out: Record<string, unknown> = {
    "exception.type": d.type,
    "exception.message": d.message,
    "exception.stacktrace": d.stacktrace,
  };
  const causes = causeChain(e);
  if (causes.length > 0) {
    out["exception.cause"] = causes.map((c) => ({
      "exception.type": c.type,
      "exception.message": c.message,
      "exception.stacktrace": c.stacktrace,
    }));
  }
  return out;
}

function sanitize(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  switch (typeof value) {
    case "string":
      return redactString(value);
    case "number":
    case "boolean":
      return value;
    case "bigint":
      return value.toString();
    case "function":
    case "symbol":
      return undefined;
  }
  const obj = value as object;
  if (obj instanceof Date) return Number.isNaN(obj.getTime()) ? null : obj.toISOString();
  if (obj instanceof Error) return exceptionFields(obj);
  if (Buffer.isBuffer(obj)) return `[Buffer ${obj.length}]`;
  if (seen.has(obj)) return "[Circular]";
  // i18n-ignore: dấu thay thế khi làm phẳng đối tượng quá sâu trong nhật ký, không tới người dùng
  if (depth >= MAX_DEPTH) return "[Quá sâu]";
  seen.add(obj);
  try {
    if (Array.isArray(obj)) return obj.slice(0, MAX_ITEMS).map((v) => sanitize(v, depth + 1, seen));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj).slice(0, MAX_ITEMS)) {
      out[k] = isSensitiveKey(k) && v !== undefined && v !== null ? REDACTED : sanitize(v, depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(obj);
  }
}

/** Che + chuẩn hoá một object thuộc tính log (dùng cả ngoài logger, vd kiểm thử bộ che). */
export function redact(attrs: Record<string, unknown>): Record<string, unknown> {
  return sanitize(attrs, 0, new WeakSet()) as Record<string, unknown>;
}

// ---- Logger -------------------------------------------------------------------------------------------------

export interface LoggerOptions {
  service?: string;
  /** Nhận đúng MỘT dòng JSON (không kèm "\n"). Mặc định ghi stdout. */
  sink?: (line: string) => void;
  /** Mức tối thiểu; mặc định theo LOG_LEVEL. */
  level?: () => LevelSetting;
  now?: () => Date;
}

export interface Logger {
  debug(message: string, attrs?: Record<string, unknown>): void;
  info(message: string, attrs?: Record<string, unknown>): void;
  warn(message: string, attrs?: Record<string, unknown>): void;
  error(message: string, attrs?: Record<string, unknown>): void;
  fatal(message: string, attrs?: Record<string, unknown>): void;
  child(attrs: Record<string, unknown>): Logger;
}

/** Đọc biến cấu hình cho logger: sai/thiếu → mặc định (kiểm lúc khởi động đã báo lỗi tên biến; logger không được ném). */
function envOr<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

function stdoutSink(line: string): void {
  try {
    process.stdout.write(line + "\n");
  } catch {
    // stdout hỏng (đóng ống): thử stderr; nếu cả hai hỏng thì không còn kênh nào để báo.
    try {
      process.stderr.write(line + "\n");
    } catch {
      /* hết kênh ghi */
    }
  }
}

const RESERVED = new Set([
  "timestamp",
  "level",
  "level_number",
  "message",
  "service",
  "version",
  "env",
  "request_id",
  "trace_id",
  "span_id",
]);

export function createLogger(opts: LoggerOptions = {}, bound: Record<string, unknown> = {}): Logger {
  const service = opts.service ?? "x-company";
  const sink = opts.sink ?? stdoutSink;
  const minLevel = opts.level ?? (() => envOr(() => env("LOG_LEVEL"), "info" as LevelSetting));
  const now = opts.now ?? (() => new Date());

  const emit = (level: Level, message: string, attrs: Record<string, unknown> = {}) => {
    if (RANK[level] < RANK[minLevel()]) return;
    const ctx = currentLogContext();
    const extra: Record<string, unknown> = {};
    for (const [k, v] of Object.entries({ ...bound, ...attrs })) {
      if (RESERVED.has(k)) continue; // trường chuẩn không bị ghi đè bởi dữ liệu người gọi
      if ((k === "err" || k === "error" || k === "exception") && v instanceof Error) {
        Object.assign(extra, exceptionFields(v));
      } else {
        extra[k] =
          isSensitiveKey(k) && v !== undefined && v !== null ? REDACTED : sanitize(v, 0, new WeakSet());
      }
    }
    const record: Record<string, unknown> = {
      timestamp: now().toISOString(),
      level,
      level_number: SEVERITY[level],
      message: redactString(String(message)),
      service,
      version: envOr(() => env("APP_VERSION"), undefined) ?? "dev",
      env: envOr(() => env("NODE_ENV"), "development"),
      request_id: ctx.request_id,
      trace_id: ctx.trace_id,
      span_id: ctx.span_id,
      ...extra,
    };
    // JSON.stringify thoát mọi \n \r và ký tự điều khiển → đúng một dòng; U+2028/2029 hợp lệ trong JSON nhưng
    // một số bộ xem coi là xuống dòng → thoát thêm.
    const line = JSON.stringify(record)
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");
    sink(line);
  };

  return {
    debug: (m, a) => emit("debug", m, a),
    info: (m, a) => emit("info", m, a),
    warn: (m, a) => emit("warn", m, a),
    error: (m, a) => emit("error", m, a),
    fatal: (m, a) => emit("fatal", m, a),
    child: (attrs) => createLogger(opts, { ...bound, ...attrs }),
  };
}

/** Logger dùng chung của ứng dụng. */
export const log: Logger = createLogger();
