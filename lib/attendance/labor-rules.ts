// Quy tắc ca/OT/nghỉ theo Bộ luật Lao động 2019 (D-031, RK-001) — mô-đun THUẦN, mọi giá trị là cấu hình CÓ NGÀY HIỆU LỰC.
// Nguồn: BLLĐ 2019 Điều 105 (8 giờ/ngày, 48 giờ/tuần), 107 (OT ≤ 50% giờ bình thường/ngày, ≤ 12 giờ/ngày gồm OT, ≤ 40 giờ/tháng,
// ≤ 200 giờ/năm; 300 giờ chỉ ngành được phép), 109 (nghỉ giữa ca 30', ca đêm 45'; nghỉ ≥ 12 giờ giữa hai ca),
// 111 (nghỉ tuần ≥ 24 giờ liên tục), 98 (làm đêm +30%, OT đêm +20%), 98.1 (OT 150/200/300%) — bản đọc được mức A; NĐ 145/2020 chỉ có
// nguồn thứ cấp (mức C). GIÁ TRỊ MẶC ĐỊNH THEO LUẬT, chờ HR chốt nội quy chặt hơn (không phải xác nhận pháp chế).
// Phút/phần trăm là số nguyên; tiền không xuất hiện ở đây. Kỳ đã khoá giữ policy_version cũ (D-007): luôn tra `rulesAt(ngày)`.
import { addDays, localDateOf, zonedToUtc } from "./compute.ts";
import { BUSINESS_TZ } from "../nen/time.ts";
import { hoursToMs, minutesToMs } from "../nen/units.ts";

export type DayType = "weekday" | "weekly_rest" | "holiday";

export interface LaborRules {
  /** Ngày hiệu lực (YYYY-MM-DD, ngày nghiệp vụ). */
  effectiveFrom: string;
  /** Nguồn + mức tin cậy, hiển thị cho HR. */
  source: string;
  normalMinutesDay: number;
  normalMinutesWeek: number;
  /** OT/ngày tối đa = tỷ lệ % của giờ bình thường/ngày (50). */
  otMaxPctOfNormalDay: number;
  /** Tổng giờ làm (bình thường + OT) tối đa/ngày. */
  totalMaxMinutesDay: number;
  otMaxMinutesMonth: number;
  otMaxMinutesYear: number;
  /** Trần năm khi ngành được phép (300 giờ). */
  otMaxMinutesYearSector: number;
  /** Cờ ngành: true → dùng trần năm của ngành. Mặc định false. */
  sectorYearCapAllowed: boolean;
  breakMinutes: number;
  nightBreakMinutes: number;
  /** Ca từ ngần này phút mới bắt buộc nghỉ giữa ca (6 giờ). */
  breakRequiredFromMinutes: number;
  restBetweenShiftsMinutes: number;
  weeklyRestMinutes: number;
  /** Giờ đêm [nightStartHour, nightEndHour) giờ địa phương: 22h–6h. */
  nightStartHour: number;
  nightEndHour: number;
  /** GIẢ ĐỊNH: ca coi là ca đêm khi giờ đêm chiếm ≥ ngần này phút. */
  nightShiftMinOverlapMinutes: number;
  otPayPct: Record<DayType, number>;
  nightPremiumPct: number;
  otNightPremiumPct: number;
}

export const LABOR_RULES_V1: LaborRules = {
  effectiveFrom: "2021-01-01",
  source:
    // i18n-ignore: nhãn nguồn pháp lý trong cấu hình (dữ liệu tham chiếu cho HR/tài liệu), không phải chuỗi giao diện
    "BLLĐ 2019 Đ98,105,107,109-111 (mức A, bản sao); NĐ 145/2020 (mức C); mặc định theo luật, chờ HR chốt (RK-001)",
  normalMinutesDay: 480,
  normalMinutesWeek: 2880,
  otMaxPctOfNormalDay: 50,
  totalMaxMinutesDay: 720,
  otMaxMinutesMonth: 2400,
  otMaxMinutesYear: 12000,
  otMaxMinutesYearSector: 18000,
  sectorYearCapAllowed: false,
  breakMinutes: 30,
  nightBreakMinutes: 45,
  breakRequiredFromMinutes: 360,
  restBetweenShiftsMinutes: 720,
  weeklyRestMinutes: 1440,
  nightStartHour: 22,
  nightEndHour: 6,
  nightShiftMinOverlapMinutes: 180,
  otPayPct: { weekday: 150, weekly_rest: 200, holiday: 300 },
  nightPremiumPct: 30,
  otNightPremiumPct: 20,
};

/** Các phiên bản cấu hình, sắp tăng theo ngày hiệu lực. Thêm bản mới = thêm phần tử (không sửa bản cũ). */
export const LABOR_RULES_VERSIONS: readonly LaborRules[] = [LABOR_RULES_V1];

/** Bản có hiệu lực tại ngày nghiệp vụ `date`; trước bản đầu → bản đầu (không có "không quy tắc"). */
export function rulesAt(date: string, versions: readonly LaborRules[] = LABOR_RULES_VERSIONS): LaborRules {
  let found = versions[0]!;
  for (const v of versions) if (v.effectiveFrom <= date) found = v;
  return found;
}

/** OT tối đa trong ngày = 50% giờ bình thường/ngày, và không làm tổng ngày vượt 12 giờ. */
export const otDayCapMinutes = (r: LaborRules, scheduledMinutes: number): number =>
  Math.max(
    0,
    Math.min(
      Math.floor((r.normalMinutesDay * r.otMaxPctOfNormalDay) / 100),
      r.totalMaxMinutesDay - scheduledMinutes,
    ),
  );

export type CeilingCode = "OT_LIMIT_DAY" | "OT_LIMIT_TOTAL_DAY" | "OT_LIMIT_MONTH" | "OT_LIMIT_YEAR";
export interface CeilingViolation {
  code: CeilingCode;
  limit: number;
  total: number;
}

export interface CeilingInput {
  /** OT đã duyệt và OT đề nghị (phút) trong ngày / tháng / năm của ngày nghiệp vụ. */
  day: { approved: number; requested: number };
  month: { approved: number; requested: number };
  year: { approved: number; requested: number };
  /** Phút làm việc theo ca được giao trong ngày (không gồm OT). */
  scheduledDayMinutes: number;
}

/** Kiểm ĐỒNG THỜI mọi trần OT; trả mọi vi phạm (không dừng ở cái đầu). */
export function checkOtCeilings(
  r: LaborRules,
  i: CeilingInput,
): { ok: boolean; violations: CeilingViolation[] } {
  const v: CeilingViolation[] = [];
  const day = i.day.approved + i.day.requested;
  const dayCap = Math.floor((r.normalMinutesDay * r.otMaxPctOfNormalDay) / 100);
  if (day > dayCap) v.push({ code: "OT_LIMIT_DAY", limit: dayCap, total: day });
  const total = i.scheduledDayMinutes + day;
  if (total > r.totalMaxMinutesDay)
    v.push({ code: "OT_LIMIT_TOTAL_DAY", limit: r.totalMaxMinutesDay, total });
  const month = i.month.approved + i.month.requested;
  if (month > r.otMaxMinutesMonth)
    v.push({ code: "OT_LIMIT_MONTH", limit: r.otMaxMinutesMonth, total: month });
  const yearCap = r.sectorYearCapAllowed ? r.otMaxMinutesYearSector : r.otMaxMinutesYear;
  const year = i.year.approved + i.year.requested;
  if (year > yearCap) v.push({ code: "OT_LIMIT_YEAR", limit: yearCap, total: year });
  return { ok: v.length === 0, violations: v };
}

/**
 * Hệ số trả lương (% của đơn giá giờ bình thường, số nguyên): giờ thường 100; làm đêm +30; OT 150/200/300;
 * OT đêm = hệ số OT + 30 + 20 (BLLĐ Đ98.3 — mức A; cách cộng theo NĐ 145/2020 mức C: luật sư xác nhận).
 */
export function payMultiplierPct(
  r: LaborRules,
  o: { overtime: boolean; night: boolean; dayType?: DayType },
): number {
  const base = o.overtime ? r.otPayPct[o.dayType ?? "weekday"] : 100;
  if (!o.night) return base;
  return base + r.nightPremiumPct + (o.overtime ? r.otNightPremiumPct : 0);
}

export interface ShiftSpan {
  start: Date;
  end: Date;
  /** Phút nghỉ giữa ca đã áp dụng (ghi nhận hoặc cố định). */
  breakMinutes: number;
}

export type RestCode = "BREAK_TOO_SHORT" | "REST_BETWEEN_SHIFTS" | "WEEKLY_REST";
export interface RestViolation {
  code: RestCode;
  /** Ca (chỉ số theo thứ tự thời gian) liên quan; WEEKLY_REST: ca mở đầu cửa sổ 7 ngày. */
  index: number;
  /** Giá trị thực / yêu cầu (phút). */
  actual: number;
  required: number;
}

const MIN = minutesToMs(1);

/** Số phút của [start, end) rơi vào giờ đêm địa phương. */
export function nightOverlapMinutes(r: LaborRules, start: Date, end: Date, tz: string = BUSINESS_TZ): number {
  let total = 0;
  let day = addDays(localDateOf(start, tz), -1);
  const lastDay = localDateOf(end, tz);
  while (day <= lastDay) {
    // đêm bắt đầu 22h ngày `day`, kết thúc 6h ngày kế
    const ns = zonedToUtc(day, `${String(r.nightStartHour).padStart(2, "0")}:00`, tz).getTime();
    const ne = zonedToUtc(addDays(day, 1), `${String(r.nightEndHour).padStart(2, "0")}:00`, tz).getTime();
    const lo = Math.max(ns, start.getTime());
    const hi = Math.min(ne, end.getTime());
    if (hi > lo) total += (hi - lo) / MIN;
    day = addDays(day, 1);
  }
  return total;
}

/** Cảnh báo (KHÔNG chặn) vi phạm nghỉ giữa ca / giữa hai ca / nghỉ tuần cho các ca của MỘT nhân viên. */
export function restViolations(
  r: LaborRules,
  spans: readonly ShiftSpan[],
  tz: string = BUSINESS_TZ,
): RestViolation[] {
  const s = [...spans].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: RestViolation[] = [];
  s.forEach((x, i) => {
    const len = (x.end.getTime() - x.start.getTime()) / MIN;
    if (len >= r.breakRequiredFromMinutes) {
      const night = nightOverlapMinutes(r, x.start, x.end, tz) >= r.nightShiftMinOverlapMinutes;
      const need = night ? r.nightBreakMinutes : r.breakMinutes;
      if (x.breakMinutes < need)
        out.push({ code: "BREAK_TOO_SHORT", index: i, actual: x.breakMinutes, required: need });
    }
    const prev = s[i - 1];
    if (prev) {
      const gap = (x.start.getTime() - prev.end.getTime()) / MIN;
      if (gap < r.restBetweenShiftsMinutes)
        out.push({
          code: "REST_BETWEEN_SHIFTS",
          index: i,
          actual: gap,
          required: r.restBetweenShiftsMinutes,
        });
    }
  });
  // Nghỉ tuần: trong mỗi cửa sổ 7 ngày bắt đầu từ một ca phải có khoảng trống liên tục ≥ 24 giờ (kể cả đầu/cuối cửa sổ).
  const lastEnd = s.length > 0 ? Math.max(...s.map((x) => x.end.getTime())) : 0;
  let lastFlaggedUntil = -Infinity;
  s.forEach((x, i) => {
    const wStart = x.start.getTime();
    if (wStart < lastFlaggedUntil) return;
    const wEnd = wStart + hoursToMs(24 * 7);
    if (wEnd > lastEnd) return; // cửa sổ chưa đủ dữ liệu 7 ngày: không kết luận
    let cursor = wStart;
    let best = 0;
    for (const y of s) {
      if (y.end.getTime() <= wStart || y.start.getTime() >= wEnd) continue;
      best = Math.max(best, (Math.max(y.start.getTime(), wStart) - cursor) / MIN);
      cursor = Math.max(cursor, Math.min(y.end.getTime(), wEnd));
    }
    best = Math.max(best, (wEnd - cursor) / MIN);
    if (best < r.weeklyRestMinutes) {
      out.push({ code: "WEEKLY_REST", index: i, actual: best, required: r.weeklyRestMinutes });
      lastFlaggedUntil = wEnd;
    }
  });
  return out;
}
