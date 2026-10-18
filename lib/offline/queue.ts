// Hàng chờ ngoại tuyến (SPEC-pwa) — logic THUẦN, không phụ thuộc IndexedDB/fetch để test bằng Node.
// Trạng thái hiển thị: pending "Đã lưu trên thiết bị" → (gửi 2xx) confirmed "Đã xác nhận" | needs_review "Chờ xác minh";
// lỗi tạm (mạng, 408, 429, 5xx) thử lại lùi luỹ thừa 1 s → 5 phút; lỗi 4xx khác → rejected, không thử lại.
// id của bản ghi chính là Idempotency-Key: gửi lại sau timeout không tạo bản ghi trùng ở server.

export type QueueState = "pending" | "confirmed" | "needs_review" | "rejected";
export type QueueKind = "attendance";

export interface QueueItem {
  id: string;
  userId: string;
  kind: QueueKind;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  nextAttemptAt: number;
  state: QueueState;
  lastError: string | null;
  reviewReason: string | null;
  serverId: string | null;
}

export interface QueueStore {
  all(): Promise<QueueItem[]>;
  put(item: QueueItem): Promise<void>;
  remove(id: string): Promise<void>;
}

export type ItemResult =
  | {
      id: string;
      ok: true;
      status: "accepted" | "needs_review";
      reviewReason?: string | null;
      eventId?: string;
    }
  | { id: string; ok: false; httpStatus: number; code: string; message: string };

/** Gửi một lô; ném lỗi khi hỏng cả request (mất mạng) — mọi bản ghi giữ pending để thử lại. */
export type SendBatch = (items: QueueItem[]) => Promise<ItemResult[]>;

export const MAX_BACKOFF_MS = 5 * 60_000;
export const BATCH_SIZE = 50;

export function backoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.max(0, attempts - 1));
}

export function isRetryable(httpStatus: number): boolean {
  return httpStatus === 0 || httpStatus === 408 || httpStatus === 429 || httpStatus >= 500;
}

export function newItem(
  userId: string,
  kind: QueueKind,
  payload: Record<string, unknown>,
  id: string,
  now: number = Date.now(),
): QueueItem {
  return {
    id,
    userId,
    kind,
    payload,
    createdAt: new Date(now).toISOString(),
    attempts: 0,
    nextAttemptAt: now,
    state: "pending",
    lastError: null,
    reviewReason: null,
    serverId: null,
  };
}

/** Lưu trước rồi mới gửi: dù tab đóng ngay, thao tác vẫn nằm trên thiết bị. */
export async function enqueue(store: QueueStore, item: QueueItem): Promise<void> {
  await store.put(item);
}

export interface FlushReport {
  sent: number;
  confirmed: number;
  needsReview: number;
  rejected: number;
  retried: number;
  networkError: boolean;
}

/** Gửi các bản ghi pending đến hạn (theo thứ tự tạo). `force` bỏ qua lùi thời gian (người dùng bấm Đồng bộ). */
export async function flush(
  store: QueueStore,
  send: SendBatch,
  now: number = Date.now(),
  force = false,
): Promise<FlushReport> {
  const report: FlushReport = {
    sent: 0,
    confirmed: 0,
    needsReview: 0,
    rejected: 0,
    retried: 0,
    networkError: false,
  };
  const due = (await store.all())
    .filter((i) => i.state === "pending" && (force || i.nextAttemptAt <= now))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  for (let i = 0; i < due.length; i += BATCH_SIZE) {
    const batch = due.slice(i, i + BATCH_SIZE);
    let results: ItemResult[];
    try {
      results = await send(batch);
    } catch (err) {
      report.networkError = true;
      for (const item of batch) {
        item.attempts++;
        item.nextAttemptAt = now + backoffMs(item.attempts);
        item.lastError = err instanceof Error ? err.message : "Mất kết nối";
        await store.put(item);
        report.retried++;
      }
      return report;
    }
    report.sent += batch.length;
    const byId = new Map(results.map((r) => [r.id, r]));
    for (const item of batch) {
      const r = byId.get(item.id);
      if (!r) {
        item.attempts++;
        item.nextAttemptAt = now + backoffMs(item.attempts);
        item.lastError = "Máy chủ không trả kết quả cho bản ghi này";
        report.retried++;
      } else if (r.ok) {
        item.state = r.status === "accepted" ? "confirmed" : "needs_review";
        item.reviewReason = r.reviewReason ?? null;
        item.serverId = r.eventId ?? null;
        item.lastError = null;
        if (item.state === "confirmed") report.confirmed++;
        else report.needsReview++;
      } else if (isRetryable(r.httpStatus)) {
        item.attempts++;
        item.nextAttemptAt = now + backoffMs(item.attempts);
        item.lastError = r.message;
        report.retried++;
      } else {
        item.state = "rejected";
        item.lastError = r.message;
        report.rejected++;
      }
      await store.put(item);
    }
  }
  return report;
}

export interface QueueSummary {
  pending: number;
  needsReview: number;
  rejected: number;
  lastConfirmedAt: string | null;
}

export function summarize(items: QueueItem[]): QueueSummary {
  return {
    pending: items.filter((i) => i.state === "pending").length,
    needsReview: items.filter((i) => i.state === "needs_review").length,
    rejected: items.filter((i) => i.state === "rejected").length,
    lastConfirmedAt:
      items
        .filter((i) => i.state === "confirmed")
        .map((i) => i.createdAt)
        .sort()
        .at(-1) ?? null,
  };
}

/** Bỏ bản ghi đã xong (xác nhận/từ chối) cũ hơn `keepMs` — bản pending không bao giờ bị xoá ở đây. */
export async function prune(
  store: QueueStore,
  now: number = Date.now(),
  keepMs = 7 * 86_400_000,
): Promise<number> {
  let n = 0;
  for (const i of await store.all()) {
    if (i.state !== "pending" && now - Date.parse(i.createdAt) > keepMs) {
      await store.remove(i.id);
      n++;
    }
  }
  return n;
}

/** Bộ nhớ trong (test, chế độ thiết bị dùng chung — không lưu bền). */
export function memoryStore(): QueueStore & { items: Map<string, QueueItem> } {
  const items = new Map<string, QueueItem>();
  return {
    items,
    all: async () => [...items.values()].map((i) => ({ ...i })),
    put: async (i) => void items.set(i.id, { ...i }),
    remove: async (id) => void items.delete(id),
  };
}
