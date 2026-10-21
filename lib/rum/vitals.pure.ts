// Tính chỉ số web từ entry của PerformanceObserver (T-056). Mô-đun thuần: không import gì (ARC-MOD-003), dùng ở client (rum-beacon)
// và test. Khớp định nghĩa Core Web Vitals (web.dev): CLS = cửa sổ phiên lớn nhất; INP xấp xỉ bằng tương tác chậm nhất.

/** Một layout-shift (PerformanceEntry của loại layout-shift). */
export interface ShiftEntry {
  startTime: number;
  value: number;
  hadRecentInput?: boolean;
}

/** Cửa sổ phiên: shift cách shift liền trước < 1 s VÀ cách shift đầu cửa sổ < 5 s thì cùng cửa sổ; ngược lại (kể cả đúng 1 s/5 s) mở cửa sổ mới. */
export const CLS_GAP_MS = 1000;
export const CLS_MAX_WINDOW_MS = 5000;

/** CLS = tổng `value` của cửa sổ phiên LỚN NHẤT; bỏ shift có `hadRecentInput`. Không shift → 0. Không đòi entry đã sắp thứ tự. */
export function clsSessionWindow(entries: readonly ShiftEntry[]): number {
  let best = 0;
  let sum = 0;
  let first = 0;
  let last = 0;
  let open = false;
  for (const e of [...entries].sort((a, b) => a.startTime - b.startTime)) {
    if (e.hadRecentInput === true) continue;
    if (open && e.startTime - last < CLS_GAP_MS && e.startTime - first < CLS_MAX_WINDOW_MS) sum += e.value;
    else {
      sum = e.value;
      first = e.startTime;
      open = true;
    }
    last = e.startTime;
    best = Math.max(best, sum);
  }
  return best;
}

/** Entry thuộc loại event/first-input của Event Timing. */
export interface InteractionEntry {
  duration: number;
  entryType?: string;
  interactionId?: number;
}

/**
 * Thời lượng tương tác chậm nhất (xấp xỉ INP): entry có `interactionId` > 0, hoặc `first-input` (một số trình duyệt để
 * interactionId = 0 cho lần nhập đầu). Không có tương tác → undefined (không báo 0 giả).
 */
export function slowestInteractionMs(entries: readonly InteractionEntry[]): number | undefined {
  let max: number | undefined;
  for (const e of entries)
    if ((e.interactionId ?? 0) > 0 || e.entryType === "first-input") max = Math.max(max ?? 0, e.duration);
  return max;
}

/**
 * LCP = startTime của entry CUỐI; entry rỗng (vd `takeRecords()` lúc ẩn trang sau khi mọi entry đã giao) KHÔNG được xoá giá trị
 * đã có — trả `prev`.
 */
export function lastStartTime(entries: readonly { startTime: number }[], prev?: number): number | undefined {
  const e = entries[entries.length - 1];
  return e === undefined ? prev : e.startTime;
}

/** Navigation Timing: TTFB = responseStart, nav = loại điều hướng. Rỗng → giữ giá trị đã có (cùng lý do như `lastStartTime`). */
export interface NavTiming {
  ttfb?: number;
  nav?: string;
}
export function navTiming(
  entries: readonly { responseStart: number; type?: string }[],
  prev: NavTiming,
): NavTiming {
  const e = entries[0];
  return e === undefined ? prev : { ttfb: e.responseStart, nav: e.type };
}
