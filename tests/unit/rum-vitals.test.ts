// T-056: CLS theo định nghĩa Core Web Vitals (cửa sổ phiên lớn nhất) và INP xấp xỉ — hàm thuần dùng ở rum-beacon.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { clsSessionWindow, slowestInteractionMs } from "../../lib/rum/vitals.pure.ts";

const s = (startTime: number, value: number, hadRecentInput = false) => ({
  startTime,
  value,
  hadRecentInput,
});
const close = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

describe("clsSessionWindow", () => {
  test("không shift → 0; chỉ toàn hadRecentInput → 0", () => {
    assert.equal(clsSessionWindow([]), 0);
    assert.equal(clsSessionWindow([s(100, 0.5, true), s(200, 0.2, true)]), 0);
  });
  test("một cửa sổ: cộng các shift liền nhau (< 1 s), bỏ hadRecentInput", () => {
    assert.ok(close(clsSessionWindow([s(0, 0.05), s(500, 0.03), s(900, 0.5, true), s(1300, 0.02)]), 0.1));
  });
  test("hai cửa sổ: chọn cửa sổ LỚN NHẤT, không cộng gộp", () => {
    // cửa sổ 1 = 0,1 + 0,05; khe 3 s; cửa sổ 2 = 0,2.
    assert.ok(close(clsSessionWindow([s(0, 0.1), s(200, 0.05), s(3200, 0.2)]), 0.2));
    assert.ok(close(clsSessionWindow([s(0, 0.2), s(5000, 0.1), s(5100, 0.05)]), 0.2));
  });
  test("khe đúng 1 s mở cửa sổ mới; 999 ms vẫn cùng cửa sổ", () => {
    assert.ok(close(clsSessionWindow([s(0, 0.1), s(1000, 0.1)]), 0.1));
    assert.ok(close(clsSessionWindow([s(0, 0.1), s(999, 0.1)]), 0.2));
  });
  test("cửa sổ dài đúng 5 s bị ngắt; 4999 ms chưa", () => {
    // các shift cách nhau 500 ms: shift ở 5000 cách đầu cửa sổ đúng 5 s → cửa sổ mới.
    const ev = (end: number) => Array.from({ length: end / 500 + 1 }, (_, i) => s(i * 500, 0.01));
    assert.ok(close(clsSessionWindow(ev(5000)), 0.1)); // 0..4500 = 10 shift; 5000 mở cửa sổ mới (0,01)
    assert.ok(close(clsSessionWindow([...ev(4500), s(4999, 0.01)]), 0.11));
  });
  test("không đòi thứ tự đầu vào", () => {
    assert.ok(close(clsSessionWindow([s(3200, 0.2), s(200, 0.05), s(0, 0.1)]), 0.2));
  });
});

describe("slowestInteractionMs", () => {
  test("không tương tác → undefined (không báo 0 giả)", () => {
    assert.equal(slowestInteractionMs([]), undefined);
    assert.equal(slowestInteractionMs([{ duration: 500, interactionId: 0, entryType: "event" }]), undefined);
  });
  test("lấy lớn nhất trong entry có interactionId; first-input tính cả khi interactionId = 0", () => {
    assert.equal(
      slowestInteractionMs([
        { duration: 40, interactionId: 3 },
        { duration: 90, interactionId: 4 },
        { duration: 999, interactionId: 0 },
      ]),
      90,
    );
    assert.equal(slowestInteractionMs([{ duration: 24, interactionId: 0, entryType: "first-input" }]), 24);
  });
  test("tương tác nhanh (< 40 ms) vẫn cho số đo (hạ ngưỡng 16 ms)", () => {
    assert.equal(slowestInteractionMs([{ duration: 16, interactionId: 1 }]), 16);
  });
});
