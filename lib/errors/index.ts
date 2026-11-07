// Kho lỗi tự host (T-122, PRF-WEB-008): lỗi client (beacon /api/public/errors) và lỗi 500 chưa bắt ở server ghi vào CÙNG bảng
// error_group, gắn release (APP_VERSION), gom nhóm theo fingerprint (đếm, không thêm dòng trùng). Thông điệp/stack được che bí mật
// và PII bằng redactString (lib/nen/log.ts) + che dãy số dài trước khi lưu. Không IP/user agent/mã người dùng, không bên thứ ba.
// Ghi lỗi là TELEMETRY như RUM (T-056): không phải ghi nghiệp vụ nên không kèm audit; đọc qua GET /api/app/errors (errors.read).
import { createHash } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { getPool } from "../db/index.ts";
import { env } from "../nen/env.ts";
import { log, REDACTED, redactString } from "../nen/log.ts";
import { minutesToMs } from "../nen/units.ts";
import type { PageRequest } from "../nen/pagination.ts";
import { PAGE_MAX_LENGTH, pageLabel } from "../rum/page.pure.ts";
import {
  ERROR_CONTEXT_MAX,
  ERROR_MESSAGE_MAX,
  ERROR_STACK_MAX,
  ERROR_TYPE_MAX,
  fingerprintInput,
  normalizeStack,
  RELEASE_RE,
  safeRelease,
} from "./normalize.pure.ts";

export { RELEASE_RE } from "./normalize.pure.ts";

export const ERROR_SOURCES = ["client", "server"] as const;
export type ErrorSource = (typeof ERROR_SOURCES)[number];

/** Giới hạn tần suất riêng của nhóm 'errors' theo IP băm (public_rate_event): một trang lỗi liên tục không làm đầy kho. */
export const ERROR_RATE_LIMIT = { max: 30, windowMs: minutesToMs(10) };
/**
 * Trần nhóm MỚI mỗi ngày UTC cho MỖI nguồn (client/server riêng — beacon không lấp được trần của lỗi server): kẻ xấu đổi loại lỗi/khung để đẻ fingerprint mới thì tối đa chừng này dòng/ngày
 * (nhóm đã có vẫn được đếm). Quá trần: bỏ, route vẫn 204. Đếm CHẶN (LIMIT) trên index first_seen_at.
 */
export const ERROR_DAILY_NEW_GROUP_CAP = 1_000;
/** Trần đầu vào (trước chuẩn hoá) — lớn hơn trần lưu vì stack thô còn origin/query bị bỏ khi chuẩn hoá. */
export const ERROR_INPUT_MESSAGE_MAX = 2_000;
export const ERROR_INPUT_STACK_MAX = 12_000;
/** Trần int4 của occurrence_count (kẹp, không tràn). */
const INT4_MAX = 2_147_483_647;

/** Beacon lỗi của trình duyệt (app/components/client-log.ts). Thừa trường → 400 (strict). */
export const ClientErrorInput = z.strictObject({
  release: z.string().regex(RELEASE_RE),
  page: z.string().min(1).max(PAGE_MAX_LENGTH).startsWith("/"),
  type: z.string().min(1).max(ERROR_TYPE_MAX),
  message: z.string().max(ERROR_INPUT_MESSAGE_MAX),
  stack: z.string().max(ERROR_INPUT_STACK_MAX).optional(),
  context: z.string().min(1).max(ERROR_CONTEXT_MAX).optional(),
});
export type ClientErrorInputT = z.infer<typeof ClientErrorInput>;

/** Mã phiên bản build hiện tại của server (APP_VERSION; không đặt → "dev"), dạng hợp lệ cho error_group.release. */
export function currentRelease(): string {
  try {
    return safeRelease(env("APP_VERSION"));
  } catch {
    return "dev"; // cấu hình sai đã báo lúc khởi động; ghi lỗi không được ném
  }
}

// Dãy ≥ 7 chữ số (có thể xen khoảng trắng/chấm/gạch): số điện thoại, CCCD, số tài khoản — redactString chưa che loại này.
const LONG_DIGITS = /\+?\d(?:[\s.-]?\d){6,}/g;

/** Che bí mật/PII trong văn bản tự do rồi cắt trần. */
export function scrubText(s: string, max: number): string {
  return redactString(s).replace(LONG_DIGITS, REDACTED).slice(0, max);
}

export interface ErrorEntry {
  source: ErrorSource;
  release: string;
  type: string;
  message: string;
  /** Stack thô (chưa chuẩn hoá). */
  stack?: string | null;
  /** Nhãn trang đã chuẩn hoá (pageLabel) hoặc null. */
  page?: string | null;
  context?: string | null;
}

export interface PreparedError {
  source: ErrorSource;
  release: string;
  fingerprint: string;
  type: string;
  message: string;
  stack: string | null;
  page: string | null;
  context: string | null;
}

/** Chuẩn hoá + che + tính fingerprint. Thuần (không I/O) để test được. `root` = thư mục dự án (cắt khỏi đường dẫn server). */
export function prepareError(e: ErrorEntry, root?: string): PreparedError {
  const type = scrubText(e.type.trim() === "" ? "Error" : e.type.trim(), ERROR_TYPE_MAX);
  const message = scrubText(e.message, ERROR_MESSAGE_MAX);
  const frames = normalizeStack(e.stack, root).map((f) => scrubText(f, ERROR_STACK_MAX));
  let stack = "";
  for (const f of frames) {
    if (stack.length + f.length + 1 > ERROR_STACK_MAX) break;
    stack += (stack === "" ? "" : "\n") + f;
  }
  const context = e.context ? scrubText(e.context, ERROR_CONTEXT_MAX) : null;
  const fingerprint = createHash("sha256")
    .update(fingerprintInput({ source: e.source, type, frames, message, context }))
    .digest("hex");
  return {
    source: e.source,
    release: safeRelease(e.release),
    fingerprint,
    type,
    message,
    stack: stack === "" ? null : stack,
    page: e.page ?? null,
    context,
  };
}

/** Kết quả ghi: nhóm mới, tăng đếm nhóm cũ, hay bỏ vì trần nhóm mới trong ngày. */
export type RecordOutcome = "inserted" | "counted" | "dropped";

/**
 * Ghi một lần gặp lỗi trong MỘT câu lệnh: nhóm (fingerprint, release) đã có → tăng occurrence_count (kẹp INT4) + last_seen_at;
 * chưa có → thêm dòng nếu hôm nay (UTC) chưa đủ ERROR_DAILY_NEW_GROUP_CAP nhóm mới. Đồng thời: ON CONFLICT gộp hai lần ghi song
 * song cùng nhóm thành một dòng (đếm 2).
 */
export async function recordError(
  db: Pick<pg.Pool, "query">,
  entry: ErrorEntry,
  now: Date = new Date(),
  root?: string,
): Promise<RecordOutcome> {
  const p = prepareError(entry, root);
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const r = await db.query<{ inserted: boolean }>(
    `INSERT INTO error_group (source, release, group_key, error_type, message, stack, page, context, first_seen_at, last_seen_at)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $9
      WHERE EXISTS (SELECT 1 FROM error_group WHERE group_key = $3 AND release = $2)
         OR (SELECT count(*) FROM (SELECT 1 FROM error_group WHERE source = $1 AND first_seen_at >= $10 LIMIT $11) d) < $11
     ON CONFLICT (group_key, release) DO UPDATE
        SET occurrence_count = LEAST(error_group.occurrence_count::bigint + 1, $12)::integer,
            last_seen_at = GREATEST(error_group.last_seen_at, EXCLUDED.last_seen_at)
     RETURNING (xmax = 0) AS inserted`,
    [
      p.source,
      p.release,
      p.fingerprint,
      p.type,
      p.message,
      p.stack,
      p.page,
      p.context,
      now,
      dayStart,
      ERROR_DAILY_NEW_GROUP_CAP,
      INT4_MAX,
    ],
  );
  const row = r.rows[0];
  if (row === undefined) return "dropped";
  return row.inserted ? "inserted" : "counted";
}

// ---- Lỗi server -----------------------------------------------------------------------------------------------

/** Số lần ghi lỗi server đang chờ tối đa; bão lỗi 500 (vd DB chết) không chồng chất kết nối/bộ nhớ — quá thì bỏ + log. */
export const SERVER_ERROR_MAX_INFLIGHT = 16;
const inflight = new Set<Promise<void>>();

function describe(err: unknown): { type: string; message: string; stack: string | null } {
  if (err instanceof Error)
    return {
      type: err.name !== "" ? err.name : err.constructor.name,
      message: err.message,
      stack: err.stack ?? null,
    };
  return { type: typeof err, message: typeof err === "string" ? err : "", stack: null };
}

/**
 * Ghi lỗi 500 chưa bắt (publicRoute/withActor, onRequestError) vào kho lỗi — KHÔNG chặn phản hồi (chạy nền, best-effort):
 * lỗi khi ghi chỉ log warn, không bao giờ ném hay gọi lại chính nó. `path` = pathname của request (chuẩn hoá thành nhãn trang).
 */
export function recordServerError(err: unknown, where: { path?: string | null } = {}): void {
  if (inflight.size >= SERVER_ERROR_MAX_INFLIGHT) {
    log.warn("kho lỗi: bỏ ghi lỗi server vì quá nhiều lần ghi đang chờ", { inflight: inflight.size });
    return;
  }
  const task = (async () => {
    const d = describe(err);
    await recordError(
      getPool(),
      {
        source: "server",
        release: currentRelease(),
        type: d.type,
        message: d.message,
        stack: d.stack,
        page: where.path ? pageLabel(where.path) : null,
      },
      new Date(),
      process.cwd(),
    );
  })().catch((e: unknown) => log.warn("kho lỗi: không ghi được lỗi server", { err: e }));
  const done = task.finally(() => inflight.delete(done));
  inflight.add(done);
}

/** Chờ mọi lần ghi lỗi server đang chạy (test, tắt êm). */
export async function flushServerErrors(): Promise<void> {
  await Promise.allSettled([...inflight]);
}

// ---- Đọc (nội bộ) -----------------------------------------------------------------------------------------------

export interface ErrorGroupRow {
  id: string;
  source: ErrorSource;
  release: string;
  /** Fingerprint của nhóm (sha256 hex). */
  group_key: string;
  error_type: string;
  message: string;
  stack: string | null;
  page: string | null;
  context: string | null;
  occurrence_count: number;
  first_seen_at: Date;
  last_seen_at: Date;
}

/** Nhóm lỗi mới gặp nhất trước; lọc tuỳ chọn theo nguồn/release. Lấy `limit + 1` dòng (toPage cắt). */
export async function listErrorGroups(
  db: Pick<pg.Pool, "query">,
  filter: { source?: ErrorSource; release?: string },
  page: PageRequest,
  fetch: number,
): Promise<ErrorGroupRow[]> {
  const { rows } = await db.query<ErrorGroupRow>(
    `SELECT id::text AS id, source, release, group_key, error_type, message, stack, page, context, occurrence_count,
            first_seen_at, last_seen_at
       FROM error_group
      WHERE ($1::text IS NULL OR source = $1) AND ($2::text IS NULL OR release = $2)
      ORDER BY last_seen_at DESC, id DESC
      LIMIT $3 OFFSET $4`,
    [filter.source ?? null, filter.release ?? null, fetch, page.offset],
  );
  return rows;
}
