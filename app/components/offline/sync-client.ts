"use client";

import { t } from "@/lib/i18n/client-app";
import { SYNC_FETCH_TIMEOUT_MS } from "@/lib/nen/timeouts";
import {
  parseRetryAfter,
  RetryAfterError,
  type ItemResult,
  type QueueItem,
  type SendBatch,
} from "@/lib/offline/queue";

/** Gửi lô lên /api/app/sync. Mất mạng → ném lỗi (giữ pending). 401 → ném lỗi (phiên hết hạn, giữ bản ghi). */
export function sendBatch(csrf: string): SendBatch {
  return async (items: QueueItem[]): Promise<ItemResult[]> => {
    const res = await fetch("/api/app/sync", {
      method: "POST",
      credentials: "same-origin",
      signal: AbortSignal.timeout(SYNC_FETCH_TIMEOUT_MS), // hết hạn → ném lỗi, bản ghi giữ pending
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({
        items: items.map((i) => ({ id: i.id, kind: i.kind, payload: i.payload, created_at: i.createdAt })),
      }),
    });
    if (res.status === 401) throw new Error(t("syncClient.sessionExpired"));
    if (!res.ok) {
      const wait = parseRetryAfter(res.headers.get("retry-after"));
      if (wait !== undefined)
        throw new RetryAfterError(t("syncClient.serverError", { status: res.status }), wait);
      throw new Error(t("syncClient.serverError", { status: res.status }));
    }
    return ((await res.json()) as { results: ItemResult[] }).results;
  };
}
