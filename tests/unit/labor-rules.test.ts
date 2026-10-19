// Quy tắc ca/OT/nghỉ (D-031, RK-001): bảng ca biên cho trần OT, hệ số lương, nghỉ giữa ca/giữa hai ca/nghỉ tuần, phiên bản có hiệu lực.
// S-AT-10 (trần OT), S-AT-11 (hệ số trả lương), S-AT-12 (cảnh báo nghỉ), S-AT-13 (phiên bản hiệu lực).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  checkOtCeilings,
  LABOR_RULES_V1 as R,
  nightOverlapMinutes,
  otDayCapMinutes,
  payMultiplierPct,
  restViolations,
  rulesAt,
  type CeilingInput,
  type LaborRules,
} from "../../lib/attendance/labor-rules.ts";

const H = 60;
const vn = (d: string, hhmm: string) => new Date(`${d}T${hhmm}:00+07:00`);
const input = (
  o: Partial<{ d: [number, number]; m: [number, number]; y: [number, number]; sched: number }> = {},
): CeilingInput => ({
  day: { approved: (o.d ?? [0, 0])[0], requested: (o.d ?? [0, 0])[1] },
  month: { approved: (o.m ?? [0, 0])[0], requested: (o.m ?? [0, 0])[1] },
  year: { approved: (o.y ?? [0, 0])[0], requested: (o.y ?? [0, 0])[1] },
  scheduledDayMinutes: o.sched ?? 480,
});
const codes = (i: CeilingInput, r: LaborRules = R) => checkOtCeilings(r, i).violations.map((v) => v.code);

describe("S-AT-10 trần OT", () => {
  test("mặc định luật: 8h/ngày, 48h/tuần, OT ≤ 50%/ngày (4h), tổng ≤ 12h, ≤ 40h/tháng, ≤ 200h/năm", () => {
    assert.deepEqual(
      [
        R.normalMinutesDay,
        R.normalMinutesWeek,
        R.totalMaxMinutesDay,
        R.otMaxMinutesMonth,
        R.otMaxMinutesYear,
      ],
      [8 * H, 48 * H, 12 * H, 40 * H, 200 * H],
    );
    assert.equal(otDayCapMinutes(R, 480), 240);
    assert.equal(otDayCapMinutes(R, 600), 120, "ca 10h: còn 2h tới trần 12h");
    assert.equal(otDayCapMinutes(R, 800), 0, "vượt 12h: không âm");
  });
  test("ngày: đúng 4h ok, 4h01 vượt OT_LIMIT_DAY (đồng thời vượt tổng 12h nếu ca 8h? không: 12h01)", () => {
    assert.equal(checkOtCeilings(R, input({ d: [0, 240] })).ok, true);
    assert.deepEqual(codes(input({ d: [0, 241] })), ["OT_LIMIT_DAY", "OT_LIMIT_TOTAL_DAY"]);
    assert.deepEqual(codes(input({ d: [120, 120] })), [], "đã duyệt + đề nghị cộng dồn: đúng 4h");
    assert.deepEqual(codes(input({ d: [120, 121] })), ["OT_LIMIT_DAY", "OT_LIMIT_TOTAL_DAY"]);
  });
  test("tổng ngày đúng 12 giờ ok; ca ngắn vẫn bị chặn bởi 50%/ngày", () => {
    assert.deepEqual(codes(input({ sched: 480, d: [0, 240] })), []);
    assert.deepEqual(codes(input({ sched: 300, d: [0, 241] })), ["OT_LIMIT_DAY"]);
    assert.deepEqual(codes(input({ sched: 600, d: [0, 120] })), []);
    assert.deepEqual(codes(input({ sched: 600, d: [0, 121] })), ["OT_LIMIT_TOTAL_DAY"]);
  });
  test("tháng: đúng 40h ok, 40h01 (2401 phút) vượt", () => {
    assert.deepEqual(codes(input({ m: [2300, 100] })), []);
    assert.deepEqual(codes(input({ m: [2300, 101] })), ["OT_LIMIT_MONTH"]);
  });
  test("năm: 200h; 300h chỉ khi cờ ngành bật; đổi năm tách riêng (nơi gọi truyền tổng của đúng năm)", () => {
    assert.deepEqual(codes(input({ y: [11_900, 100] })), []);
    assert.deepEqual(codes(input({ y: [11_900, 101] })), ["OT_LIMIT_YEAR"]);
    const sector: LaborRules = { ...R, sectorYearCapAllowed: true };
    assert.deepEqual(codes(input({ y: [11_900, 101] }), sector), []);
    assert.deepEqual(codes(input({ y: [17_900, 101] }), sector), ["OT_LIMIT_YEAR"]);
    // sang năm mới: tổng năm mới = 0 + đề nghị → ok dù năm trước đã đầy
    assert.deepEqual(codes(input({ y: [0, 100] })), []);
  });
  test("trả mọi vi phạm đồng thời, kèm giới hạn và tổng", () => {
    const r = checkOtCeilings(R, input({ d: [0, 300], m: [2400, 300], y: [12_000, 300] }));
    assert.equal(r.ok, false);
    assert.deepEqual(
      r.violations.map((v) => [v.code, v.limit, v.total]),
      [
        ["OT_LIMIT_DAY", 240, 300],
        ["OT_LIMIT_TOTAL_DAY", 720, 780],
        ["OT_LIMIT_MONTH", 2400, 2700],
        ["OT_LIMIT_YEAR", 12_000, 12_300],
      ],
    );
  });
  test("0 phút: không vi phạm", () => assert.equal(checkOtCeilings(R, input()).ok, true));
});

describe("S-AT-11 hệ số trả lương (số nguyên %)", () => {
  test("thường 100; đêm 130; OT 150/200/300; OT đêm = OT + 30 + 20", () => {
    assert.equal(payMultiplierPct(R, { overtime: false, night: false }), 100);
    assert.equal(payMultiplierPct(R, { overtime: false, night: true }), 130);
    assert.equal(payMultiplierPct(R, { overtime: true, night: false }), 150);
    assert.equal(payMultiplierPct(R, { overtime: true, night: false, dayType: "weekly_rest" }), 200);
    assert.equal(payMultiplierPct(R, { overtime: true, night: false, dayType: "holiday" }), 300);
    assert.equal(payMultiplierPct(R, { overtime: true, night: true }), 200);
    assert.equal(payMultiplierPct(R, { overtime: true, night: true, dayType: "weekly_rest" }), 250);
    assert.equal(payMultiplierPct(R, { overtime: true, night: true, dayType: "holiday" }), 350);
    for (const o of [true, false])
      assert.ok(Number.isInteger(payMultiplierPct(R, { overtime: o, night: true })));
  });
});

describe("S-AT-12 cảnh báo nghỉ (không chặn)", () => {
  const span = (d1: string, t1: string, d2: string, t2: string, brk: number) => ({
    start: vn(d1, t1),
    end: vn(d2, t2),
    breakMinutes: brk,
  });
  test("giờ đêm 22h–6h: ca qua đêm 22:00–06:00 = 480 phút đêm", () => {
    assert.equal(nightOverlapMinutes(R, vn("2026-10-01", "22:00"), vn("2026-10-02", "06:00")), 480);
    assert.equal(nightOverlapMinutes(R, vn("2026-10-01", "08:00"), vn("2026-10-01", "17:00")), 0);
    assert.equal(nightOverlapMinutes(R, vn("2026-10-01", "20:00"), vn("2026-10-01", "23:00")), 60);
  });
  test("nghỉ giữa ca: ca ngày 30', ca đêm 45', ca ngắn dưới 6h không bắt buộc", () => {
    assert.deepEqual(restViolations(R, [span("2026-10-01", "08:00", "2026-10-01", "17:00", 30)]), []);
    const v = restViolations(R, [span("2026-10-01", "08:00", "2026-10-01", "17:00", 29)]);
    assert.deepEqual(
      v.map((x) => [x.code, x.actual, x.required]),
      [["BREAK_TOO_SHORT", 29, 30]],
    );
    const night = restViolations(R, [span("2026-10-01", "22:00", "2026-10-02", "06:00", 30)]);
    assert.deepEqual(
      night.map((x) => [x.code, x.required]),
      [["BREAK_TOO_SHORT", 45]],
      "ca đêm cần 45'",
    );
    assert.deepEqual(restViolations(R, [span("2026-10-01", "22:00", "2026-10-02", "06:00", 45)]), []);
    assert.deepEqual(
      restViolations(R, [span("2026-10-01", "08:00", "2026-10-01", "13:59", 0)]),
      [],
      "dưới 6 giờ",
    );
    assert.equal(
      restViolations(R, [span("2026-10-01", "08:00", "2026-10-01", "14:00", 0)]).length,
      1,
      "đúng 6 giờ",
    );
  });
  test("nghỉ giữa hai ca: đúng 12h ok, 11h59 cảnh báo; ca qua đêm", () => {
    const ok = restViolations(R, [
      span("2026-10-01", "08:00", "2026-10-01", "12:00", 0),
      span("2026-10-02", "00:00", "2026-10-02", "04:00", 0),
    ]);
    assert.deepEqual(ok, []);
    const bad = restViolations(R, [
      span("2026-10-01", "14:00", "2026-10-01", "22:00", 30),
      span("2026-10-02", "09:59", "2026-10-02", "13:00", 0),
    ]);
    assert.deepEqual(
      bad.map((x) => [x.code, x.actual]),
      [["REST_BETWEEN_SHIFTS", 719]],
    );
    const overnight = restViolations(R, [
      span("2026-10-01", "22:00", "2026-10-02", "06:00", 45),
      span("2026-10-02", "14:00", "2026-10-02", "18:00", 0),
    ]);
    assert.deepEqual(
      overnight.map((x) => [x.code, x.actual]),
      [["REST_BETWEEN_SHIFTS", 480]],
    );
  });
  test("nghỉ tuần ≥ 24h liên tục: làm 7 ngày liền cảnh báo; nghỉ đủ một ngày thì không", () => {
    const days = (n: number, skip: number[] = []) =>
      Array.from({ length: n }, (_, i) => i)
        .filter((i) => !skip.includes(i))
        .map((i) =>
          span(
            `2026-10-${String(1 + i).padStart(2, "0")}`,
            "08:00",
            `2026-10-${String(1 + i).padStart(2, "0")}`,
            "12:00",
            0,
          ),
        );
    const seven = restViolations(R, days(9));
    assert.ok(seven.some((x) => x.code === "WEEKLY_REST"));
    assert.deepEqual(
      restViolations(R, days(9, [6])).filter((x) => x.code === "WEEKLY_REST"),
      [],
    );
    assert.deepEqual(restViolations(R, days(3)), [], "chưa đủ dữ liệu 7 ngày: không kết luận");
    assert.deepEqual(restViolations(R, []), []);
  });
});

describe("S-AT-13 phiên bản có ngày hiệu lực", () => {
  const v2: LaborRules = {
    ...R,
    effectiveFrom: "2027-01-01",
    otMaxMinutesMonth: 30 * H,
    source: "nội quy công ty",
  };
  const versions = [R, v2];
  test("tra theo ngày: đúng ngày hiệu lực dùng bản mới; kỳ cũ giữ bản cũ; trước bản đầu dùng bản đầu", () => {
    assert.equal(rulesAt("2026-12-31", versions).otMaxMinutesMonth, 2400);
    assert.equal(rulesAt("2027-01-01", versions).otMaxMinutesMonth, 1800);
    assert.equal(rulesAt("2020-01-01", versions).effectiveFrom, "2021-01-01");
    assert.deepEqual(codes(input({ m: [1700, 101] }), rulesAt("2027-06-01", versions)), ["OT_LIMIT_MONTH"]);
    assert.deepEqual(codes(input({ m: [1700, 101] }), rulesAt("2026-06-01", versions)), []);
  });
});
