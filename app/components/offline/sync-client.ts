"use client";

import type { ItemResult, QueueItem, SendBatch } from "@/lib/offline/queue";

/** Gửi lô lên /api/app/sync. Mất mạng → ném lỗi (giữ pending). 401 → ném lỗi (phiên hết hạn, giữ bản ghi). */
export function sendBatch(csrf: string): SendBatch {
  return async (items: QueueItem[]): Promise<ItemResult[]> => {
    const res = await fetch("/api/app/sync", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({
        items: items.map((i) => ({ id: i.id, kind: i.kind, payload: i.payload, created_at: i.createdAt })),
      }),
    });
    if (res.status === 401) throw new Error("Phiên đăng nhập hết hạn — đăng nhập lại để gửi");
    if (!res.ok) throw new Error(`Máy chủ lỗi ${res.status}`);
    return ((await res.json()) as { results: ItemResult[] }).results;
  };
}
