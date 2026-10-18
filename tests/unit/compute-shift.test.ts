import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  computeShift,
  shiftBounds,
  subtract,
  tzOffsetMinutes,
  union,
  zonedToUtc,
  type ShiftDefinition,
  type ShiftEvent,
} from "../../lib/attendance/compute.ts";

const VN = "Asia/Ho_Chi_Minh";
/** Giờ VN → Date (VN = UTC+7). */
const vn = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+07:00`);
let n = 0;
const ev = (kind: ShiftEvent["kind"], at: Date, device: string | null = null): ShiftEvent => ({
  id: `e${++n}`,
  kind,
  at,
  device,
});

const night: ShiftDefinition = {
  businessDate: "2026-10-18",
  start: "22:00",
  end: "06:00",
  breakMinutes: 30,
  tz: VN,
};
const day: ShiftDefinition = {
  businessDate: "2026-10-19",
  start: "08:00",
  end: "17:00",
  breakMinutes: 60,
  tz: VN,
};

describe("múi giờ", () => {
  test("VN +7, New York có DST", () => {
    assert.equal(tzOffsetMinutes(new Date("2026-10-18T00:00:00Z"), VN), 420);
    assert.equal(tzOffsetMinutes(new Date("2026-07-01T12:00:00Z"), "America/New_York"), -240);
    assert.equal(tzOffsetMinutes(new Date("2026-01-15T12:00:00Z"), "America/New_York"), -300);
    assert.equal(zonedToUtc("2026-10-18", "22:00", VN).toISOString(), "2026-10-18T15:00:00.000Z");
  });

  test("ca qua ngày: business_date là ngày bắt đầu", () => {
    const b = shiftBounds(night);
    assert.equal(b.start.toISOString(), "2026-10-18T15:00:00.000Z");
    assert.equal(b.end.toISOString(), "2026-10-18T23:00:00.000Z");
  });
});

describe("khoảng", () => {
  const t = (h: number) => new Date(Date.UTC(2026, 0, 1, h));
  test("union gộp chồng và nối liền", () => {
    assert.deepEqual(
      union([
        { from: t(8), to: t(12) },
        { from: t(11), to: t(13) },
        { from: t(13), to: t(14) },
        { from: t(15), to: t(15) },
        { from: t(16), to: t(17) },
      ]),
      [
        { from: t(8), to: t(14) },
        { from: t(16), to: t(17) },
      ],
    );
  });
  test("subtract cắt giữa, đầu, cuối, trọn", () => {
    assert.deepEqual(subtract([{ from: t(8), to: t(17) }], [{ from: t(12), to: t(13) }]), [
      { from: t(8), to: t(12) },
      { from: t(13), to: t(17) },
    ]);
    assert.deepEqual(subtract([{ from: t(8), to: t(10) }], [{ from: t(7), to: t(11) }]), []);
    assert.deepEqual(subtract([{ from: t(8), to: t(10) }], [{ from: t(9), to: t(11) }]), [
      { from: t(8), to: t(9) },
    ]);
  });
});

describe("computeShift — SPEC-attendance", () => {
  test("S-AT-01 (AT03): ca 22:00–06:00, vào 21:55, nghỉ ghi 02:00–02:30, ra 06:05 → 460' ; D 125' ; D+1 335'", () => {
    const r = computeShift(night, [
      ev("in", vn("2026-10-18", "21:55")),
      ev("break_start", vn("2026-10-19", "02:00")),
      ev("break_end", vn("2026-10-19", "02:30")),
      ev("out", vn("2026-10-19", "06:05")),
    ]);
    assert.equal(r.status, "ok");
    assert.equal(r.presentMinutes, 460);
    assert.equal(r.breakMode, "recorded");
    assert.equal(r.breakMinutesApplied, 30);
    assert.deepEqual(r.segments, [
      { calendarDate: "2026-10-18", minutes: 125 },
      { calendarDate: "2026-10-19", minutes: 335 },
    ]);
    assert.deepEqual(r.exceptions, []);
  });

  test("S-AT-02 (AT03): hai thiết bị 08:00–12:00 và 11:30–17:00 → hợp 540', trừ nghỉ cố định 60' → 480'", () => {
    const r = computeShift(day, [
      ev("in", vn("2026-10-19", "08:00"), "phone"),
      ev("in", vn("2026-10-19", "11:30"), "kiosk"),
      ev("out", vn("2026-10-19", "12:00"), "phone"),
      ev("out", vn("2026-10-19", "17:00"), "kiosk"),
    ]);
    assert.equal(r.presentMinutes, 480);
    assert.equal(r.breakMode, "fixed");
    assert.deepEqual(r.segments, [{ calendarDate: "2026-10-19", minutes: 480 }]);
  });

  test("nhiều lần vào ra cùng thiết bị, sự kiện đến sai thứ tự vẫn đúng", () => {
    const r = computeShift({ ...day, breakMinutes: 0 }, [
      ev("out", vn("2026-10-19", "17:00")),
      ev("in", vn("2026-10-19", "13:00")),
      ev("out", vn("2026-10-19", "12:00")),
      ev("in", vn("2026-10-19", "08:00")),
    ]);
    assert.equal(r.presentMinutes, 480);
    assert.equal(r.intervals.length, 2);
  });

  test("C3: thiếu checkout → incomplete + MISSING_CHECKOUT, không tự điền giờ ra", () => {
    const inEv = ev("in", vn("2026-10-19", "08:00"));
    const r = computeShift(day, [inEv]);
    assert.equal(r.status, "incomplete");
    assert.deepEqual(r.exceptions, [{ code: "MISSING_CHECKOUT", eventId: inEv.id }]);
    assert.equal(r.presentMinutes, 0);
    // Có một cặp hoàn chỉnh + một lần vào dở → chỉ tính cặp hoàn chỉnh.
    const r2 = computeShift({ ...day, breakMinutes: 0 }, [
      ev("in", vn("2026-10-19", "08:00")),
      ev("out", vn("2026-10-19", "12:00")),
      ev("in", vn("2026-10-19", "13:00")),
    ]);
    assert.equal(r2.presentMinutes, 240);
    assert.equal(r2.status, "incomplete");
  });

  test("vắng: không sự kiện vào/ra → absent, presentMinutes null (không phải 0)", () => {
    const r = computeShift(day, []);
    assert.equal(r.status, "absent");
    assert.equal(r.presentMinutes, null);
    const onlyBreak = computeShift(day, [ev("break_start", vn("2026-10-19", "12:00"))]);
    assert.equal(onlyBreak.status, "absent");
  });

  test("vào hai lần cùng thiết bị → DUPLICATE_IN, giữ lần đầu; ra không có vào → OUT_WITHOUT_IN", () => {
    const dup = ev("in", vn("2026-10-19", "08:05"));
    const stray = ev("out", vn("2026-10-19", "07:30"));
    const r = computeShift({ ...day, breakMinutes: 0 }, [
      stray,
      ev("in", vn("2026-10-19", "08:00")),
      dup,
      ev("out", vn("2026-10-19", "17:00")),
    ]);
    assert.equal(r.presentMinutes, 540);
    assert.deepEqual(
      r.exceptions.map((e) => e.code),
      ["OUT_WITHOUT_IN", "DUPLICATE_IN"],
    );
  });

  test("cửa sổ ca: sự kiện ngoài [start−60', end+240'] không tính; khoảng bị cắt vào cửa sổ", () => {
    const r = computeShift({ ...day, breakMinutes: 0 }, [
      ev("in", vn("2026-10-19", "05:00")), // ngoài cửa sổ (sớm hơn 07:00)
      ev("in", vn("2026-10-19", "07:00")),
      ev("out", vn("2026-10-19", "21:00")),
    ]);
    assert.equal(r.presentMinutes, 14 * 60);
    const later = computeShift({ ...day, breakMinutes: 0 }, [
      ev("in", vn("2026-10-19", "08:00")),
      ev("out", vn("2026-10-19", "21:30")), // sau 21:00 → ngoài cửa sổ, coi như thiếu ra
    ]);
    assert.equal(later.status, "incomplete");
  });

  test("giây bị cắt về phút nguyên; nghỉ cố định không trừ khi có mặt ≤ thời lượng nghỉ", () => {
    const r = computeShift(day, [
      ev("in", new Date(vn("2026-10-19", "08:00").getTime() + 59_000)),
      ev("out", new Date(vn("2026-10-19", "08:45").getTime() + 1_000)),
    ]);
    assert.equal(r.presentMinutes, 45);
    assert.equal(r.breakMode, "none");
  });

  test("nghỉ ghi nằm ngoài khoảng có mặt không bị trừ; nghỉ thiếu cặp → UNPAIRED_BREAK", () => {
    const r = computeShift({ ...day, breakMinutes: 60 }, [
      ev("in", vn("2026-10-19", "08:00")),
      ev("out", vn("2026-10-19", "12:00")),
      ev("break_start", vn("2026-10-19", "12:00")),
      ev("break_end", vn("2026-10-19", "13:00")),
      ev("in", vn("2026-10-19", "13:00")),
      ev("out", vn("2026-10-19", "17:00")),
      ev("break_end", vn("2026-10-19", "15:00")),
    ]);
    assert.equal(r.breakMode, "recorded");
    assert.equal(r.presentMinutes, 480);
    assert.deepEqual(
      r.exceptions.map((e) => e.code),
      ["UNPAIRED_BREAK"],
    );
  });

  test("nghỉ cố định ca đêm trừ vào ngày chứa điểm giữa ca; nếu ngày đó không đủ thì trừ ngày nhiều phút nhất", () => {
    const r = computeShift(night, [
      ev("in", vn("2026-10-18", "22:00")),
      ev("out", vn("2026-10-19", "06:00")),
    ]);
    // Giữa ca 02:00 ngày D+1 → trừ 30' vào D+1.
    assert.deepEqual(r.segments, [
      { calendarDate: "2026-10-18", minutes: 120 },
      { calendarDate: "2026-10-19", minutes: 330 },
    ]);
    const lateHalf = computeShift({ ...night, start: "18:00", end: "06:00" }, [
      ev("in", vn("2026-10-18", "18:00")),
      ev("out", vn("2026-10-18", "23:00")),
    ]);
    // Giữa ca 00:00 D+1 nhưng D+1 không có phút → trừ vào D.
    assert.deepEqual(lateHalf.segments, [{ calendarDate: "2026-10-18", minutes: 270 }]);
  });

  test("múi giờ có DST: ca 08:00–17:00 New York ngày đổi giờ vẫn tính đúng thời lượng thực", () => {
    // 2026-11-01: lùi giờ lúc 02:00 → ca đêm 22:00–06:00 dài 9 giờ thực.
    const ny: ShiftDefinition = {
      businessDate: "2026-10-31",
      start: "22:00",
      end: "06:00",
      breakMinutes: 0,
      tz: "America/New_York",
    };
    const b = shiftBounds(ny);
    assert.equal((b.end.getTime() - b.start.getTime()) / 3600_000, 9);
    const r = computeShift(ny, [ev("in", b.start), ev("out", b.end)]);
    assert.equal(r.presentMinutes, 540);
    assert.deepEqual(
      r.segments.map((s) => s.calendarDate),
      ["2026-10-31", "2026-11-01"],
    );
  });
});
