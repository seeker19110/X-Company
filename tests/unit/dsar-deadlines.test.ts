// Hạn xử lý yêu cầu chủ thể theo loại (D-029, CMP-INTL-007) — hàm thuần: bảng hạn, ngày làm việc qua cuối tuần, gia hạn.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  computeDeadlines,
  dsarAnyOverdueSql,
  dsarConfig,
  extendedDueAt,
  isPastDue,
  KINDS,
  type DsarConfig,
  type RequestKind,
} from "../../lib/privacy/deadlines.ts";

const ENV = {
  APP_ORIGIN: "http://x.test",
  DATABASE_URL: "postgres://u:p@localhost/db",
  SESSION_SECRET: "x".repeat(40),
  QR_SIGNING_KEYS: `k1:${"y".repeat(40)}`,
};
const cfg = (over: Partial<DsarConfig> = {}): DsarConfig => ({ ...dsarConfig(ENV), ...over });
// Giờ VN = UTC+7. 2026-08-03 là Thứ Hai.
const vn = (date: string, hhmm = "10:00") => new Date(`${date}T${hhmm}:00+07:00`);

describe("bảng hạn theo loại", () => {
  test("mọi loại có hạn; 10/15/20 ngày lịch theo D-029", () => {
    const c = cfg();
    const t0 = vn("2026-08-03");
    const expected: Record<RequestKind, number> = {
      access: 10,
      rectify: 10,
      export: 10,
      withdraw_consent: 15,
      restrict: 15,
      object: 15,
      delete: 20,
    };
    assert.deepEqual([...KINDS].sort(), Object.keys(expected).sort());
    for (const k of KINDS)
      assert.equal(computeDeadlines(k, t0, c).dueAt.getTime() - t0.getTime(), expected[k] * 86_400_000, k);
  });

  test("hạn đổi theo cấu hình, không cần sửa mã", () => {
    const t0 = vn("2026-08-03");
    const c = cfg({ days: { ...cfg().days, delete: 30 } });
    assert.equal(computeDeadlines("delete", t0, c).dueAt.getTime() - t0.getTime(), 30 * 86_400_000);
  });
});

describe("hạn phản hồi = 2 ngày làm việc (bỏ T7, CN)", () => {
  const respond = (d: string, hhmm?: string, n = 2) =>
    computeDeadlines("access", vn(d, hhmm), cfg({ respondWorkdays: n })).respondDueAt;
  test("giữa tuần: Thứ Hai → Thứ Tư, Thứ Ba → Thứ Năm", () => {
    assert.equal(respond("2026-08-03").getTime(), vn("2026-08-05").getTime());
    assert.equal(respond("2026-08-04").getTime(), vn("2026-08-06").getTime());
  });
  test("qua cuối tuần: Thứ Năm → Thứ Hai; Thứ Sáu/T7/CN → Thứ Ba", () => {
    assert.equal(respond("2026-08-06").getTime(), vn("2026-08-10").getTime(), "Thứ Năm");
    assert.equal(respond("2026-08-07").getTime(), vn("2026-08-11").getTime(), "Thứ Sáu");
    assert.equal(respond("2026-08-08").getTime(), vn("2026-08-11").getTime(), "Thứ Bảy");
    assert.equal(respond("2026-08-09").getTime(), vn("2026-08-11").getTime(), "Chủ Nhật");
  });
  test("bội số ngày làm việc: 5 ngày làm việc = đúng một tuần; 10 = hai tuần", () => {
    assert.equal(respond("2026-08-03", "10:00", 5).getTime(), vn("2026-08-10").getTime());
    assert.equal(respond("2026-08-05", "10:00", 5).getTime(), vn("2026-08-12").getTime());
    assert.equal(respond("2026-08-07", "10:00", 5).getTime(), vn("2026-08-14").getTime());
    assert.equal(respond("2026-08-03", "10:00", 10).getTime(), vn("2026-08-17").getTime());
  });
  test("giờ sát nửa đêm tính theo ngày VN, không theo UTC (Thứ Sáu 23:30 VN = 16:30Z)", () => {
    assert.equal(respond("2026-08-07", "23:30").getTime(), vn("2026-08-11", "23:30").getTime());
  });
});

describe("gia hạn và quá hạn", () => {
  test("hạn mới = hạn cũ + số ngày cấu hình (không tính từ lúc bấm)", () => {
    const due = vn("2026-08-13");
    assert.equal(extendedDueAt(due, cfg()).getTime() - due.getTime(), 15 * 86_400_000);
    assert.equal(extendedDueAt(due, cfg({ extendDays: 7 })).getTime() - due.getTime(), 7 * 86_400_000);
  });
  test("quá hạn đúng ngày: đúng lúc hạn chưa quá, +1 ms là quá", () => {
    const due = vn("2026-08-13");
    assert.equal(isPastDue(due, due), false);
    assert.equal(isPastDue(due, new Date(due.getTime() + 1)), true);
    assert.equal(isPastDue(due, new Date(due.getTime() - 1)), false);
  });
  test("điều kiện SQL quá hạn dùng tham số đã cho cho cả hai vế", () => {
    const sql = dsarAnyOverdueSql("$7");
    assert.equal(sql.match(/\$7/g)!.length, 2);
    assert.match(sql, /due_at < \$7/);
    assert.match(sql, /respond_due_at < \$7/);
  });
});
