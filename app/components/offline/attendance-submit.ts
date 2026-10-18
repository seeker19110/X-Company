"use client";

// Chấm công qua hàng chờ: lưu trên thiết bị trước (id = Idempotency-Key) rồi đồng bộ ngay nếu có mạng.
import { flush, newItem } from "@/lib/offline/queue";
import { openQueue } from "./idb-store";
import { sendBatch } from "./sync-client";

export interface SubmitOutcome {
  state: "confirmed" | "needs_review" | "pending" | "rejected";
  reason?: string | null;
}

export async function submitAttendance(
  userId: string,
  csrf: string,
  input: { kind: "in" | "out" | "break_start" | "break_end"; source: "gps" | "qr" | "kiosk"; qr?: string },
): Promise<SubmitOutcome> {
  const store = await openQueue(userId);
  const item = newItem(
    userId,
    "attendance",
    { ...input, device_time: new Date().toISOString() },
    crypto.randomUUID(),
  );
  await store.put(item);
  await flush(store, sendBatch(csrf), Date.now(), true);
  const after = (await store.all()).find((i) => i.id === item.id);
  if (!after) return { state: "pending" };
  if (after.state === "confirmed") return { state: "confirmed" };
  if (after.state === "needs_review") return { state: "needs_review", reason: after.reviewReason };
  if (after.state === "rejected") return { state: "rejected", reason: after.lastError };
  return { state: "pending", reason: after.lastError };
}
