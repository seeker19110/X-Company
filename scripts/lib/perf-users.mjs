// Nhân viên riêng của kịch bản ghi chấm công trong đo tải (scripts/seed-perf.ts tạo, scripts/perf-load.mjs đăng nhập).
// Trần `/attendance/events` là 60 lượt/phút/người dùng (AUD-XFEAT-004): đủ người để mỗi người dưới trần trong một lượt đo.
export const PERF_ATTENDANCE_USERS = 128;
export const perfAttendanceEmail = (i) => `perf-att-${i}@e2e.test`;

/** Số người tối thiểu để `requests` lượt chia đều mà mỗi người ≤ `perUserMax` (ca biên: 0 lượt → 0 người). */
export function usersNeeded(requests, perUserMax) {
  if (!(perUserMax > 0)) throw new RangeError("perUserMax phải > 0");
  return Math.ceil(Math.max(0, requests) / perUserMax);
}
