// Ngày nghiệp vụ theo múi giờ (mặc định Asia/Ho_Chi_Minh) — instant lưu UTC, ngày tính theo giờ địa phương.
import { MS_PER_DAY } from "./units.ts";
export const BUSINESS_TZ = "Asia/Ho_Chi_Minh";

/** YYYY-MM-DD của instant `d` theo múi giờ `tz`. */
export function localDate(d: Date, tz: string = BUSINESS_TZ): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Thứ trong tuần (0 = CN … 6 = T7) của instant theo múi giờ. */
export function localWeekday(d: Date, tz: string = BUSINESS_TZ): number {
  const w = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(w);
}

/** Cộng `n` ngày làm việc (bỏ T7, CN; ngày lễ do lịch công ty — H02) giữ nguyên giờ trong ngày. */
export function addBusinessDays(d: Date, n: number, tz: string = BUSINESS_TZ): Date {
  let t = new Date(d.getTime());
  let left = n;
  while (left > 0) {
    t = new Date(t.getTime() + MS_PER_DAY);
    const w = localWeekday(t, tz);
    if (w !== 0 && w !== 6) left--;
  }
  return t;
}
