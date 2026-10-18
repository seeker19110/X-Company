// Hằng chuyển đổi đơn vị tập trung (XC-UNITS-009): mã nghiệp vụ không viết số ma thuật `* 1000`, `/ 1024`.
// Thuần — không import gì, dùng được ở client, worker và module thuần (ARC-MOD-003).
export const MS_PER_SECOND = 1000;
export const SECONDS_PER_MINUTE = 60;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;
export const SECONDS_PER_HOUR = 3600;
export const BYTES_PER_KB = 1024;
export const BYTES_PER_MB = 1024 * BYTES_PER_KB;

export const secondsToMs = (s: number): number => s * MS_PER_SECOND;
export const msToSeconds = (ms: number): number => ms / MS_PER_SECOND;
export const minutesToMs = (m: number): number => m * MS_PER_MINUTE;
export const hoursToMs = (h: number): number => h * MS_PER_HOUR;
export const daysToMs = (d: number): number => d * MS_PER_DAY;
export const hoursToSeconds = (h: number): number => h * SECONDS_PER_HOUR;
export const kb = (n: number): number => n * BYTES_PER_KB;
export const mb = (n: number): number => n * BYTES_PER_MB;
/** Giây epoch (làm tròn xuống) của một thời điểm. */
export const epochSeconds = (d: Date): number => Math.floor(d.getTime() / MS_PER_SECOND);
