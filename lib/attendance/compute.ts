// Tính công một ca nghiệp vụ (SPEC-attendance C1–C5) — hàm THUẦN, không đọc DB/đồng hồ.
// Quyết định làm rõ (ghi ở SPEC): thời điểm cắt về phút nguyên (bỏ giây) để tổng và các đoạn theo ngày khớp tuyệt đối;
// nghỉ cố định (không ghi sự kiện nghỉ) tính vào ngày lịch chứa điểm giữa ca.

export type EventKind = "in" | "out" | "break_start" | "break_end";

export interface ShiftEvent {
  id: string;
  kind: EventKind;
  at: Date;
  /** Khoá thiết bị/phiên cài đặt; ghép cặp vào–ra theo từng thiết bị rồi hợp khoảng (C1). */
  device?: string | null;
}

export interface ShiftDefinition {
  businessDate: string; // YYYY-MM-DD — ngày bắt đầu ca
  start: string; // HH:MM giờ địa phương
  end: string; // HH:MM; end <= start → ca qua ngày
  breakMinutes: number;
  tz: string;
  earlyGraceMinutes?: number; // mặc định 60
  lateGraceMinutes?: number; // mặc định 240
}

export type ShiftException = "MISSING_CHECKOUT" | "DUPLICATE_IN" | "OUT_WITHOUT_IN" | "UNPAIRED_BREAK";

export interface Interval {
  from: Date;
  to: Date;
}

export interface ShiftResult {
  shiftStart: Date;
  shiftEnd: Date;
  status: "ok" | "incomplete" | "absent";
  /** null khi vắng (ABSENT) — không đồng nhất với 0 giờ có mặt. */
  presentMinutes: number | null;
  breakMinutesApplied: number;
  breakMode: "recorded" | "fixed" | "none";
  intervals: Interval[];
  segments: { calendarDate: string; minutes: number }[];
  exceptions: { code: ShiftException; eventId?: string }[];
}

const MIN = 60_000;

// ---- Múi giờ -----------------------------------------------------------------------------------------------------

/** Độ lệch (phút) của múi giờ `tz` tại instant `t`: local = UTC + offset. */
export function tzOffsetMinutes(t: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(t);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - Math.floor(t.getTime() / 1000) * 1000) / MIN);
}

/** Instant UTC của giờ địa phương `date` `time` ở múi giờ `tz` (giờ không tồn tại do DST → dời tới sau). */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  let guess = naive - tzOffsetMinutes(new Date(naive), tz) * MIN;
  guess = naive - tzOffsetMinutes(new Date(guess), tz) * MIN;
  return new Date(guess);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function localDateOf(t: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(t);
}

// ---- Khoảng thời gian ------------------------------------------------------------------------------------------

const truncMinute = (t: Date) => new Date(Math.floor(t.getTime() / MIN) * MIN);
const minutes = (i: Interval) => (i.to.getTime() - i.from.getTime()) / MIN;

/** Hợp các khoảng (chồng hoặc nối liền → gộp). */
export function union(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.to > i.from).sort((a, b) => a.from.getTime() - b.from.getTime());
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.from.getTime() <= last.to.getTime()) {
      if (i.to > last.to) last.to = i.to;
    } else out.push({ from: i.from, to: i.to });
  }
  return out;
}

/** a − b (b đã hợp). */
export function subtract(a: Interval[], b: Interval[]): Interval[] {
  let cur = a.map((i) => ({ ...i }));
  for (const cut of b) {
    const next: Interval[] = [];
    for (const i of cur) {
      if (cut.to <= i.from || cut.from >= i.to) next.push(i);
      else {
        if (cut.from > i.from) next.push({ from: i.from, to: cut.from });
        if (cut.to < i.to) next.push({ from: cut.to, to: i.to });
      }
    }
    cur = next;
  }
  return cur;
}

function clip(i: Interval, lo: Date, hi: Date): Interval {
  return { from: i.from < lo ? lo : i.from, to: i.to > hi ? hi : i.to };
}

/** Ghép cặp mở/đóng theo từng thiết bị. */
function pair(
  events: ShiftEvent[],
  open: EventKind,
  close: EventKind,
  exceptions: ShiftResult["exceptions"],
  onDangling: (e: ShiftEvent) => void,
  onCloseWithoutOpen: (e: ShiftEvent) => void,
): Interval[] {
  const byDevice = new Map<string, ShiftEvent[]>();
  for (const e of events) {
    if (e.kind !== open && e.kind !== close) continue;
    const k = e.device ?? "";
    (byDevice.get(k) ?? byDevice.set(k, []).get(k)!).push(e);
  }
  const out: Interval[] = [];
  for (const list of byDevice.values()) {
    list.sort((a, b) => {
      const d = a.at.getTime() - b.at.getTime();
      return d !== 0 ? d : a.kind === open ? -1 : 1;
    });
    let cur: ShiftEvent | null = null;
    for (const e of list) {
      if (e.kind === open) {
        if (cur) exceptions.push({ code: open === "in" ? "DUPLICATE_IN" : "UNPAIRED_BREAK", eventId: e.id });
        else cur = e;
      } else if (cur) {
        out.push({ from: truncMinute(cur.at), to: truncMinute(e.at) });
        cur = null;
      } else onCloseWithoutOpen(e);
    }
    if (cur) onDangling(cur);
  }
  return out;
}

/** Chia khoảng theo nửa đêm địa phương. */
function splitByDay(intervals: Interval[], tz: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const i of intervals) {
    let from = i.from;
    while (from < i.to) {
      const day = localDateOf(from, tz);
      const midnight = zonedToUtc(addDays(day, 1), "00:00", tz);
      const to = midnight < i.to ? midnight : i.to;
      out.set(day, (out.get(day) ?? 0) + minutes({ from, to }));
      from = to;
    }
  }
  return out;
}

export function shiftBounds(def: ShiftDefinition): { start: Date; end: Date } {
  const overnight = def.end <= def.start;
  return {
    start: zonedToUtc(def.businessDate, def.start, def.tz),
    end: zonedToUtc(overnight ? addDays(def.businessDate, 1) : def.businessDate, def.end, def.tz),
  };
}

export function computeShift(def: ShiftDefinition, events: readonly ShiftEvent[]): ShiftResult {
  const { start, end } = shiftBounds(def);
  const lo = new Date(start.getTime() - (def.earlyGraceMinutes ?? 60) * MIN);
  const hi = new Date(end.getTime() + (def.lateGraceMinutes ?? 240) * MIN);
  const inWindow = events.filter((e) => e.at >= lo && e.at <= hi);
  const exceptions: ShiftResult["exceptions"] = [];

  if (!inWindow.some((e) => e.kind === "in" || e.kind === "out")) {
    return {
      shiftStart: start,
      shiftEnd: end,
      status: "absent",
      presentMinutes: null,
      breakMinutesApplied: 0,
      breakMode: "none",
      intervals: [],
      segments: [],
      exceptions,
    };
  }

  let incomplete = false;
  const presence = union(
    pair(
      inWindow,
      "in",
      "out",
      exceptions,
      (e) => {
        incomplete = true; // C3: thiếu giờ ra → ngoại lệ, không tự điền
        exceptions.push({ code: "MISSING_CHECKOUT", eventId: e.id });
      },
      (e) => exceptions.push({ code: "OUT_WITHOUT_IN", eventId: e.id }),
    ).map((i) => clip(i, lo, hi)),
  );
  const recordedBreaks = union(
    pair(
      inWindow,
      "break_start",
      "break_end",
      exceptions,
      (e) => exceptions.push({ code: "UNPAIRED_BREAK", eventId: e.id }),
      (e) => exceptions.push({ code: "UNPAIRED_BREAK", eventId: e.id }),
    ),
  );

  const presentTotal = presence.reduce((s, i) => s + minutes(i), 0);
  let worked = presence;
  let breakMode: ShiftResult["breakMode"] = "none";
  let breakApplied = 0;
  let fixedDeduct = 0;
  if (recordedBreaks.length > 0) {
    breakMode = "recorded";
    worked = subtract(presence, recordedBreaks);
    breakApplied = presentTotal - worked.reduce((s, i) => s + minutes(i), 0);
  } else if (def.breakMinutes > 0 && presentTotal > def.breakMinutes) {
    breakMode = "fixed";
    fixedDeduct = def.breakMinutes;
    breakApplied = fixedDeduct;
  }

  const byDay = splitByDay(worked, def.tz);
  if (fixedDeduct > 0) {
    // Trừ dần: ngày chứa điểm giữa ca trước, phần còn lại sang các ngày khác theo số phút giảm dần; không để âm.
    const mid = localDateOf(new Date((start.getTime() + end.getTime()) / 2), def.tz);
    const order = [...byDay.keys()].sort((a, b) =>
      a === mid ? -1 : b === mid ? 1 : byDay.get(b)! - byDay.get(a)!,
    );
    let left = fixedDeduct;
    for (const day of order) {
      const take = Math.min(left, byDay.get(day)!);
      byDay.set(day, byDay.get(day)! - take);
      left -= take;
      if (left === 0) break;
    }
  }
  const segments = [...byDay.entries()]
    .filter(([, m]) => m > 0)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([calendarDate, m]) => ({ calendarDate, minutes: m }));

  return {
    shiftStart: start,
    shiftEnd: end,
    status: incomplete ? "incomplete" : "ok",
    presentMinutes: segments.reduce((s, x) => s + x.minutes, 0),
    breakMinutesApplied: breakApplied,
    breakMode,
    intervals: worked,
    segments,
    exceptions,
  };
}
