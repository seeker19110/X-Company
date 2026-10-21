// Nhân viên riêng của kịch bản ghi chấm công trong đo tải (scripts/seed-perf.ts tạo, scripts/perf-load.mjs đăng nhập).
// Trần `/attendance/events` là 60 lượt/phút/người dùng (AUD-XFEAT-004): đủ người để mỗi người dưới trần trong một lượt đo.
export const PERF_ATTENDANCE_USERS = 128;
export const perfAttendanceEmail = (i) => `perf-att-${i}@e2e.test`;

/** Số người tối thiểu để `requests` lượt chia đều mà mỗi người ≤ `perUserMax` (ca biên: 0 lượt → 0 người). */
export function usersNeeded(requests, perUserMax) {
  if (!(perUserMax > 0)) throw new RangeError("perUserMax phải > 0");
  return Math.ceil(Math.max(0, requests) / perUserMax);
}

// Kịch bản chốt kỳ (scripts/perf-period.ts, AUD-PERF-001): 200 nhân viên × 3 kỳ 31 ngày ở quá khứ — không chạm kỳ hiện tại.
export const PERIOD_EMPLOYEES = 200;
export const PERIOD_MONTHS = [
  { code: "PERF-2025-01", start: "2025-01-01", end: "2025-01-31", days: 31 },
  { code: "PERF-2025-03", start: "2025-03-01", end: "2025-03-31", days: 31 },
  { code: "PERF-2025-05", start: "2025-05-01", end: "2025-05-31", days: 31 },
];
