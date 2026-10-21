// Định dạng số, tiền, ngày/giờ, danh sách, thời gian tương đối bằng Intl/CLDR (XC-I18N-003) — không ghép chuỗi tay.
// Mặc định locale `vi-VN` và múi `Asia/Ho_Chi_Minh`. Giá trị thiếu (null/undefined) → EMPTY, KHÔNG thành "0"
// (BASE-DATA-003: thiếu ≠ 0). Tiền là số nguyên đơn vị nhỏ nhất của VND (không có phần lẻ).
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND } from "../nen/units.ts";
import { BUSINESS_TZ } from "../nen/time.ts";

export const DEFAULT_LOCALE = "vi-VN";
export const DEFAULT_TIME_ZONE = BUSINESS_TZ;
/** Hiển thị cho giá trị chưa có (không phải 0). */
export const EMPTY = "—";

const cache = new Map<string, unknown>();
function memo<T>(kind: string, locale: string, opts: object, make: () => T): T {
  const key = `${kind}|${locale}|${JSON.stringify(opts)}`;
  let v = cache.get(key) as T | undefined;
  if (v === undefined) {
    v = make();
    cache.set(key, v);
  }
  return v;
}

const isMissing = (v: unknown): v is null | undefined => v === null || v === undefined;

/** Số theo locale: 1234567.89 → "1.234.567,89" (vi-VN). */
export function formatNumber(
  n: number | null | undefined,
  opts: Intl.NumberFormatOptions = {},
  locale = DEFAULT_LOCALE,
): string {
  if (isMissing(n)) return EMPTY;
  if (!Number.isFinite(n)) throw new RangeError(`formatNumber: không phải số hữu hạn (${String(n)})`);
  return memo("n", locale, opts, () => new Intl.NumberFormat(locale, opts)).format(n);
}

/** Phần trăm từ tỉ lệ 0..1 (0,256 → "25,6%"). */
export function formatPercent(ratio: number | null | undefined, locale = DEFAULT_LOCALE): string {
  return formatNumber(ratio, { style: "percent", maximumFractionDigits: 1 }, locale);
}

/** Tiền VND — SỐ NGUYÊN (đồng): 1234568 → "1.234.568 ₫". Số lẻ/NaN = lỗi lập trình, ném RangeError. */
export function formatVnd(amount: number | null | undefined, locale = DEFAULT_LOCALE): string {
  if (isMissing(amount)) return EMPTY;
  if (!Number.isSafeInteger(amount))
    throw new RangeError(`formatVnd: tiền phải là số nguyên (${String(amount)})`);
  return memo(
    "vnd",
    locale,
    {},
    () => new Intl.NumberFormat(locale, { style: "currency", currency: "VND" }),
  ).format(amount);
}

export type DateInput = Date | string | number | null | undefined;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Ngày thuần "YYYY-MM-DD" là ngày dương lịch, không phải thời điểm: tách riêng để không bị lệch múi giờ. */
function toInstant(v: Date | string | number): { date: Date; timeZone: string | undefined } {
  if (typeof v === "string") {
    const m = DATE_ONLY.exec(v);
    if (m) return { date: new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))), timeZone: "UTC" };
  }
  const date = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(date.getTime()))
    throw new RangeError(`định dạng ngày: giá trị không hợp lệ (${String(v)})`);
  return { date, timeZone: undefined };
}

function formatWith(
  v: DateInput,
  opts: Intl.DateTimeFormatOptions,
  locale: string,
  timeZone: string,
): string {
  if (isMissing(v)) return EMPTY;
  const { date, timeZone: fixed } = toInstant(v);
  const o = { ...opts, timeZone: fixed ?? timeZone };
  return memo("d", locale, o, () => new Intl.DateTimeFormat(locale, o)).format(date);
}

/** Ngày: "2026-10-13" hoặc thời điểm → "13/10/2026" (vi-VN), "10/13/2026" (en-US). Thời điểm tính theo múi VN. */
export function formatDate(v: DateInput, locale = DEFAULT_LOCALE, timeZone = DEFAULT_TIME_ZONE): string {
  return formatWith(v, { day: "2-digit", month: "2-digit", year: "numeric" }, locale, timeZone);
}

/** Giờ:phút của một thời điểm theo múi giờ VN. */
export function formatTime(v: DateInput, locale = DEFAULT_LOCALE, timeZone = DEFAULT_TIME_ZONE): string {
  return formatWith(v, { hour: "2-digit", minute: "2-digit" }, locale, timeZone);
}

/** Ngày giờ của một thời điểm theo múi giờ VN, năm đủ 4 chữ số (UTC 2026-10-13T07:30Z → "14:30 13/10/2026"). */
export function formatDateTime(v: DateInput, locale = DEFAULT_LOCALE, timeZone = DEFAULT_TIME_ZONE): string {
  return formatWith(
    v,
    { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" },
    locale,
    timeZone,
  );
}

/** Danh sách: ["A","B","C"] → "A, B và C" (vi-VN). */
export function formatList(
  items: readonly string[] | null | undefined,
  type: Intl.ListFormatOptions["type"] = "conjunction",
  locale = DEFAULT_LOCALE,
): string {
  if (isMissing(items) || items.length === 0) return EMPTY;
  const opts = { type, style: "long" as const };
  return memo("l", locale, opts, () => new Intl.ListFormat(locale, opts)).format(items);
}

const RELATIVE_UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * MS_PER_DAY],
  ["month", 30 * MS_PER_DAY],
  ["day", MS_PER_DAY],
  ["hour", MS_PER_HOUR],
  ["minute", MS_PER_MINUTE],
  ["second", MS_PER_SECOND],
];

/** Thời gian tương đối so với `now` (truyền vào để test được): 5 phút trước · hôm qua · 2 giờ nữa. */
export function formatRelative(v: DateInput, now: Date, locale = DEFAULT_LOCALE): string {
  if (isMissing(v)) return EMPTY;
  const diff = toInstant(v).date.getTime() - now.getTime();
  const abs = Math.abs(diff);
  const [unit, size] = RELATIVE_UNITS.find(([, ms]) => abs >= ms) ?? (["second", MS_PER_SECOND] as const);
  const value = Math.trunc(diff / size);
  const opts = { numeric: "auto" as const };
  return memo("r", locale, opts, () => new Intl.RelativeTimeFormat(locale, opts)).format(value, unit);
}
