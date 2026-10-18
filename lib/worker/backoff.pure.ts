// Backoff mũ có jitter và trần (BE-JOB-003, ARC-RES-002) — hàm thuần, `rand` tiêm vào để test.
export const DEFAULT_MAX_ATTEMPTS = 5;
export const BACKOFF_BASE_MS = 10_000;
export const BACKOFF_CAP_MS = 15 * 60_000;

/**
 * Thời gian chờ (ms) trước lần thử kế tiếp sau lần thử thứ `attempt` (1 = lần đầu vừa lỗi).
 * Phần mũ `min(cap, base · 2^(attempt-1))`; jitter "equal": kết quả ∈ [mũ/2, mũ] theo `rand` ∈ [0,1).
 * `attempt` < 1 coi như 1; `rand` ngoài [0,1) bị kẹp.
 */
export function nextAttemptDelay(
  attempt: number,
  rand: number = Math.random(),
  baseMs: number = BACKOFF_BASE_MS,
  capMs: number = BACKOFF_CAP_MS,
): number {
  const n = Number.isFinite(attempt) ? Math.max(1, Math.floor(attempt)) : 1;
  const r = Number.isFinite(rand) ? Math.min(Math.max(rand, 0), 0.999999999) : 0;
  // 2 ** (n-1) tràn thành Infinity ở n lớn → min với cap vẫn đúng.
  const exp = Math.min(capMs, baseMs * 2 ** (n - 1));
  return Math.floor(exp / 2 + r * (exp / 2));
}
