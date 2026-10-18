import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  backoffMs,
  flush,
  isRetryable,
  MAX_RETRY_AFTER_MS,
  memoryStore,
  newItem,
  nextDelayMs,
  parseRetryAfter,
  prune,
  RetryAfterError,
  summarize,
  type ItemResult,
  type QueueItem,
} from "../../lib/offline/queue.ts";

const U = "11111111-1111-4111-8111-111111111111";
const T0 = Date.parse("2026-10-18T01:00:00Z");
const item = (id: string, t = T0) => newItem(U, "attendance", { kind: "in" }, id, t);
const okAll = async (items: QueueItem[]): Promise<ItemResult[]> =>
  items.map((i) => ({ id: i.id, ok: true, status: "accepted" }));

describe("hàng chờ ngoại tuyến (T-021)", () => {
  test("lùi luỹ thừa 1 s → 5 phút; mã thử lại", () => {
    assert.deepEqual([1, 2, 3, 10, 30].map(backoffMs), [1000, 2000, 4000, 300_000, 300_000]);
    assert.deepEqual([0, 408, 429, 500, 503].map(isRetryable), [true, true, true, true, true]);
    assert.deepEqual([400, 401, 403, 409, 422].map(isRetryable), [false, false, false, false, false]);
  });

  test("S-PWA-01: lưu trên thiết bị (pending) → mất mạng giữ nguyên, tăng lần thử → có mạng → confirmed", async () => {
    const s = memoryStore();
    await s.put(item("a"));
    assert.deepEqual(summarize(await s.all()), {
      pending: 1,
      needsReview: 0,
      rejected: 0,
      lastConfirmedAt: null,
    });
    const r1 = await flush(
      s,
      async () => {
        throw new Error("Failed to fetch");
      },
      T0,
      false,
      () => 0.5, // jitter cố định để kiểm giá trị
    );
    assert.equal(r1.networkError, true);
    const after = (await s.all())[0]!;
    assert.equal(after.state, "pending");
    assert.equal(after.attempts, 1);
    assert.equal(after.nextAttemptAt, T0 + 750); // mốc 1 s, jitter ở giữa [0,5 s ; 1 s]
    // Chưa tới hạn lùi → không gửi; bấm Đồng bộ (force) → gửi ngay.
    let calls = 0;
    await flush(s, async (i) => (calls++, okAll(i)), T0 + 500);
    assert.equal(calls, 0);
    const r2 = await flush(s, okAll, T0 + 500, true);
    assert.equal(r2.confirmed, 1);
    assert.equal((await s.all())[0]!.state, "confirmed");
  });

  test("needs_review giữ lý do; lỗi 403 → rejected không thử lại; 503 → thử lại; thiếu kết quả → thử lại", async () => {
    const s = memoryStore();
    for (const id of ["r", "f", "x", "m"]) await s.put(item(id));
    const rep = await flush(
      s,
      async () => [
        { id: "r", ok: true, status: "needs_review", reviewReason: "CLOCK_SKEW", eventId: "e1" },
        {
          id: "f",
          ok: false,
          httpStatus: 403,
          code: "EMPLOYMENT_ENDED",
          message: "Hồ sơ nhân viên không còn hiệu lực",
        },
        { id: "x", ok: false, httpStatus: 503, code: "INTERNAL", message: "bận" },
      ],
      T0,
    );
    assert.deepEqual([rep.needsReview, rep.rejected, rep.retried], [1, 1, 2]);
    const by = new Map((await s.all()).map((i) => [i.id, i]));
    assert.deepEqual(
      [by.get("r")!.state, by.get("r")!.reviewReason, by.get("r")!.serverId],
      ["needs_review", "CLOCK_SKEW", "e1"],
    );
    assert.deepEqual(
      [by.get("f")!.state, by.get("f")!.lastError],
      ["rejected", "Hồ sơ nhân viên không còn hiệu lực"],
    );
    assert.equal(by.get("x")!.state, "pending");
    assert.equal(by.get("m")!.state, "pending");
    // Bản bị từ chối không gửi lại nữa.
    const sent: string[] = [];
    await flush(s, async (items) => (sent.push(...items.map((i) => i.id)), okAll(items)), T0, true);
    assert.deepEqual(sent.sort(), ["m", "x"]);
  });

  test("gửi theo thứ tự tạo, chia lô 50", async () => {
    const s = memoryStore();
    for (let i = 0; i < 120; i++) await s.put(item(`i${String(i).padStart(3, "0")}`, T0 + (119 - i) * 1000));
    const batches: string[][] = [];
    await flush(s, async (items) => (batches.push(items.map((i) => i.id)), okAll(items)), T0 + 1e6);
    assert.deepEqual(
      batches.map((b) => b.length),
      [50, 50, 20],
    );
    assert.equal(batches[0]![0], "i119", "cũ nhất trước");
  });

  test("dọn bản đã xong sau 7 ngày; bản pending không bao giờ bị dọn", async () => {
    const s = memoryStore();
    await s.put(item("old-done"));
    await s.put(item("old-pending"));
    await flush(s, async () => [{ id: "old-done", ok: true, status: "accepted" }], T0);
    const removed = await prune(s, T0 + 8 * 86_400_000);
    assert.equal(removed, 1);
    assert.deepEqual(
      (await s.all()).map((i) => i.id),
      ["old-pending"],
    );
  });

  describe("jitter + Retry-After (ARC-RES-002)", () => {
    test("jitter nằm trong [mốc/2, mốc], không vượt trần 5 phút, cận dưới/trên đúng", () => {
      for (const attempts of [1, 2, 5, 10, 50]) {
        const cap = backoffMs(attempts);
        assert.equal(nextDelayMs(attempts, { random: () => 0 }), Math.floor(cap / 2));
        assert.equal(
          nextDelayMs(attempts, { random: () => 0.999999 }),
          Math.floor(cap / 2 + 0.999999 * (cap / 2)),
        );
        for (let i = 0; i < 200; i++) {
          const d = nextDelayMs(attempts);
          assert.ok(d >= Math.floor(cap / 2) && d <= cap, `${d} ngoài [${cap / 2}, ${cap}]`);
        }
      }
      // Nhiều thiết bị cùng lỗi không thử lại cùng một mili giây.
      assert.ok(new Set(Array.from({ length: 50 }, () => nextDelayMs(8))).size > 1);
    });

    test("Retry-After: không bao giờ sớm hơn máy chủ yêu cầu; có trần 1 giờ; 0 → dùng jitter", () => {
      assert.ok(nextDelayMs(1, { retryAfterMs: 30_000, random: () => 0 }) >= 30_000);
      assert.ok(nextDelayMs(1, { retryAfterMs: 30_000, random: () => 0.99 }) <= 30_000 * 1.1 + 1);
      assert.ok(
        nextDelayMs(1, { retryAfterMs: 10 * 3_600_000, random: () => 0 }) <= MAX_RETRY_AFTER_MS + 5000,
      );
      assert.equal(nextDelayMs(1, { retryAfterMs: 0, random: () => 0 }), 500);
      assert.equal(nextDelayMs(1, { retryAfterMs: -5, random: () => 0 }), 500);
      assert.equal(nextDelayMs(1, { retryAfterMs: Number.NaN, random: () => 0 }), 500);
    });

    test("parseRetryAfter: giây, ngày HTTP, quá khứ, rỗng/rác/âm", () => {
      const now = Date.parse("2026-10-18T01:00:00Z");
      assert.equal(parseRetryAfter("120", now), 120_000);
      assert.equal(parseRetryAfter("0", now), 0);
      assert.equal(parseRetryAfter("99999999", now), MAX_RETRY_AFTER_MS);
      assert.equal(parseRetryAfter("Sun, 18 Oct 2026 01:01:00 GMT", now), 60_000);
      assert.equal(parseRetryAfter("Sun, 18 Oct 2026 00:00:00 GMT", now), 0);
      for (const bad of [null, undefined, "", "  ", "abc", "-5", "1e3", "Chờ một chút"])
        assert.equal(parseRetryAfter(bad, now), undefined, String(bad));
    });

    test("flush: 429 kèm retryAfterSec của bản ghi → hẹn lại không sớm hơn; 4xx khác không thử lại", async () => {
      const s = memoryStore();
      await s.put(item("a"));
      await s.put(item("b"));
      const send = async (): Promise<ItemResult[]> => [
        { id: "a", ok: false, httpStatus: 429, code: "RATE_LIMITED", message: "chậm", retryAfterSec: 90 },
        { id: "b", ok: false, httpStatus: 422, code: "VALIDATION", message: "sai" },
      ];
      const r = await flush(s, send, T0, false, () => 0);
      assert.deepEqual([r.retried, r.rejected], [1, 1]);
      const all = new Map((await s.all()).map((i) => [i.id, i]));
      assert.ok(all.get("a")!.nextAttemptAt >= T0 + 90_000);
      assert.equal(all.get("a")!.state, "pending");
      assert.equal(all.get("b")!.state, "rejected"); // 4xx: không retry
    });

    test("flush: bộ gửi ném RetryAfterError (429/503 cả request) → mọi bản ghi hẹn ≥ Retry-After", async () => {
      const s = memoryStore();
      await s.put(item("a"));
      const r = await flush(
        s,
        async () => {
          throw new RetryAfterError("Máy chủ lỗi 503", 45_000);
        },
        T0,
        false,
        () => 0,
      );
      assert.equal(r.networkError, true);
      assert.ok((await s.all())[0]!.nextAttemptAt >= T0 + 45_000);
    });
  });
});
