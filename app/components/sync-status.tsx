"use client";

import { useCallback, useEffect, useState } from "react";
import { flush, summarize, type QueueSummary } from "@/lib/offline/queue";
import { openQueue, removeForeignDatabases } from "./offline/idb-store";
import { sendBatch } from "./offline/sync-client";
import { useSession } from "./session-context";

/** Trạng thái đồng bộ + nút Đồng bộ; tự đồng bộ khi mở app, có mạng lại, trở lại foreground (SPEC-pwa). */
export function SyncStatus() {
  const { csrf, userId } = useSession();
  const [s, setS] = useState<QueueSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const sync = useCallback(
    async (force: boolean) => {
      try {
        const store = await openQueue(userId);
        await flush(store, sendBatch(csrf), Date.now(), force);
        setS(summarize(await store.all()));
        setErr(null);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Không đọc được dữ liệu trên thiết bị");
      }
    },
    [csrf, userId],
  );

  useEffect(() => {
    void removeForeignDatabases(userId);
    // Đồng bộ lần đầu sau khi gắn (không setState đồng bộ trong effect).
    const first = window.setTimeout(() => void sync(false), 0);
    const online = () => void sync(true);
    const visible = () => document.visibilityState === "visible" && void sync(false);
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [sync, userId]);

  return (
    <section className="card" aria-labelledby="dong-bo">
      <h2 id="dong-bo">Đồng bộ</h2>
      <p role="status" aria-live="polite">
        {s ? (
          <>
            Chờ gửi: <strong>{s.pending}</strong> · Chờ xác minh: {s.needsReview} · Bị từ chối: {s.rejected}
          </>
        ) : (
          "Đang kiểm tra…"
        )}
      </p>
      {err && (
        <p role="alert" className="err">
          {err}
        </p>
      )}
      <button className="btn" onClick={() => void sync(true)}>
        Đồng bộ
      </button>
    </section>
  );
}
